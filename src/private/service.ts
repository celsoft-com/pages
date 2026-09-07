import { contains } from "../bundle";
import { sha256Hex } from "../crypto/hmac";
import { randomBytes, toBase64 } from "../crypto/random";
import { stores } from "../store";
import type { Privacy, PrivateScope, Share } from "../types";

const KEY = "privacy";

// One blob holds every private path and every live share, so a request answers both questions
// with one read: is this path private, and is the token in this cookie still valid. Splitting them
// would make revocation cost a second read, and revocation is the whole point.
export async function getPrivacy(): Promise<Privacy> {
  const stored = (await stores.site().get(KEY, { type: "json" })) as Partial<Privacy> | null;
  return { scopes: stored?.scopes ?? [] };
}

async function savePrivacy(privacy: Privacy): Promise<void> {
  await stores.site().setJSON(KEY, { scopes: privacy.scopes.sort((a, b) => a.path.localeCompare(b.path)) });
}

// At most one scope covers a path, because setPrivate refuses to nest one inside another. Matching
// is segment-wise through contains(), so /trip is not the scope of /tripwire.
export function privateScope(privacy: Privacy, path: string): PrivateScope | null {
  return privacy.scopes.find((scope) => contains(scope.path, path)) ?? null;
}

function urlSafe(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// 256 bits, so the only way in is to hold the link. Nothing rate limits the unlock endpoint
// because there is nothing to guess.
export function shareToken(): string {
  return urlSafe(randomBytes(32));
}

export async function setPrivate(path: string): Promise<PrivateScope> {
  const privacy = await getPrivacy();
  const existing = privacy.scopes.find((scope) => scope.path === path);
  if (existing) return existing;

  // Nested scopes would leave a visitor needing two tokens for one page, or one token silently
  // opening a narrower scope somebody set deliberately. Neither is worth having, so neither exists.
  const clash = privacy.scopes.find((scope) => contains(scope.path, path) || contains(path, scope.path));
  if (clash)
    throw new Error(
      `${clash.path} is already private and privacy does not nest, so ${path} cannot be a separate scope. ` +
        `Share ${clash.path} instead, or make it public first.`,
    );

  const scope: PrivateScope = { path, createdAt: Date.now(), shares: [] };
  privacy.scopes = [...privacy.scopes, scope];
  await savePrivacy(privacy);
  return scope;
}

export async function setPublic(path: string): Promise<PrivateScope | null> {
  const privacy = await getPrivacy();
  const scope = privacy.scopes.find((s) => s.path === path);
  if (!scope) return null;
  privacy.scopes = privacy.scopes.filter((s) => s.path !== path);
  await savePrivacy(privacy);
  return scope;
}

export async function mintShare(path: string, label: string): Promise<{ token: string; share: Share }> {
  await setPrivate(path);
  const privacy = await getPrivacy();
  const scope = privacy.scopes.find((s) => s.path === path)!;

  // Labels are unique per scope so revoking by label cannot take the wrong link away.
  if (scope.shares.some((s) => s.label === label))
    throw new Error(`${path} already has a share labelled "${label}". Revoke that one first, or use another label.`);

  const token = shareToken();
  const share: Share = {
    id: urlSafe(randomBytes(6)),
    hash: await sha256Hex(token),
    label,
    createdAt: Date.now(),
  };
  scope.shares = [...scope.shares, share];
  await savePrivacy(privacy);
  return { token, share };
}

export async function revokeShares(path: string, label?: string): Promise<Share[]> {
  const privacy = await getPrivacy();
  const scope = privacy.scopes.find((s) => s.path === path);
  if (!scope) return [];

  const gone = label === undefined ? scope.shares : scope.shares.filter((s) => s.label === label);
  if (gone.length === 0) return [];

  scope.shares = scope.shares.filter((s) => !gone.includes(s));
  await savePrivacy(privacy);
  return gone;
}

export async function findShare(token: string): Promise<{ scope: PrivateScope; share: Share } | null> {
  const hash = await sha256Hex(token);
  for (const scope of (await getPrivacy()).scopes) {
    const share = scope.shares.find((s) => s.hash === hash);
    if (share) return { scope, share };
  }
  return null;
}

// Written on unlock only. Stamping it on every request would be a blob write per page view, and
// the useful question is when a link was last redeemed, not when the holder last refreshed.
export async function markShareUsed(path: string, shareId: string): Promise<void> {
  const privacy = await getPrivacy();
  const share = privacy.scopes.find((s) => s.path === path)?.shares.find((s) => s.id === shareId);
  if (!share) return;
  share.lastUsedAt = Date.now();
  await savePrivacy(privacy);
}
