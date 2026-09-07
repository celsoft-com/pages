import { readCookie } from "../auth/session";
import { getOwner } from "../auth/setup";
import { sha256Hex, sign, verify } from "../crypto/hmac";
import type { PrivateScope } from "../types";
import { getPrivacy, privateScope } from "./service";

// Long and rolling, so someone who reads the page even occasionally never has to find the original
// link again. Expiry is a backstop; revocation is what actually takes access away.
const TTL_MS = 1000 * 60 * 60 * 24 * 90;

// One cookie per private path, named after the path, so a visitor can hold links to several
// private paths at once without one grant overwriting another. The name is not signed, which is
// why the path is inside the signed payload: a grant cannot be replayed against another scope.
async function cookieName(path: string): Promise<string> {
  return `pg_${(await sha256Hex(path)).slice(0, 12)}`;
}

// Path=/ is required, not lax: the page is at /trip but its data is at /data/trip/*.json and its
// images at /assets/trip/*, and all three are gated.
export async function grantCookie(scopePath: string, shareId: string): Promise<string | null> {
  const owner = await getOwner();
  if (!owner) return null;
  const expires = Date.now() + TTL_MS;
  const signature = await sign(owner.sessionKey, `${scopePath}.${shareId}.${expires}`);
  const value = encodeURIComponent(`${shareId}.${expires}.${signature}`);
  return `${await cookieName(scopePath)}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.floor(
    TTL_MS / 1000,
  )}`;
}

async function validGrant(request: Request, scope: PrivateScope): Promise<string | null> {
  const raw = readCookie(request, await cookieName(scope.path));
  if (!raw) return null;

  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [shareId, expires, signature] = parts;
  if (!(Number(expires) > Date.now())) return null;

  // Checked against the stored list on every request, so revoking a link takes effect on the next
  // one rather than whenever the cookie happens to expire.
  if (!scope.shares.some((s) => s.id === shareId)) return null;

  const owner = await getOwner();
  if (!owner) return null;
  return (await verify(owner.sessionKey, `${scope.path}.${shareId}.${expires}`, signature)) ? shareId : null;
}

export interface Access {
  // null when nothing private covers the path. A caller uses this to pick cache headers: a public
  // response is durable at the edge, a private one must never be stored anywhere.
  scope: PrivateScope | null;
  open: boolean;
  cookie?: string;
}

const PUBLIC: Access = { scope: null, open: true };

export async function accessTo(request: Request, path: string): Promise<Access> {
  const scope = privateScope(await getPrivacy(), path);
  if (!scope) return PUBLIC;

  const shareId = await validGrant(request, scope);
  if (!shareId) return { scope, open: false };

  return { scope, open: true, cookie: (await grantCookie(scope.path, shareId)) ?? undefined };
}

// A hash-keyed asset names its own bytes and sits at no path, so no scope can contain it. That is
// why an asset uploaded into a private path is stored under its path key and gets no hash alias.
export async function accessToAsset(request: Request, path: string | undefined): Promise<Access> {
  return path ? accessTo(request, path) : PUBLIC;
}
