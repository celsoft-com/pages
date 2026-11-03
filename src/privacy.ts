import { EndpointError } from "@celsoft/platform";
import { contains } from "./bundle";
import { type PagesApp, pointsFor, SITE_POINT } from "./pages-app";

// A private path is a control point of its own, path:<path>, and nothing else: the points are the
// record of which paths are private, so pages keeps no table of them.
const PREFIX = "path:";

export const pointOf = (path: string) => `${PREFIX}${path}`;

const pathOf = (point: string) => point.slice(PREFIX.length);

// Every private path the caller can see, sorted. The owner sees them all.
export async function privatePaths(app: PagesApp): Promise<string[]> {
  return (await app.access.points({ prefix: PREFIX })).map(pathOf);
}

// The private path closing this one from above, if any. A path's gate is the first existing point
// of its chain, so the ancestors are the chain between the path's own point and the site.
export function closedBy(privates: readonly string[], path: string): string | null {
  return privates.find((scope) => scope !== path && contains(scope, path)) ?? null;
}

// The private path gating this one: its own scope or the one above it.
export function scopeOf(privates: readonly string[], path: string): string | null {
  return privates.find((scope) => contains(scope, path)) ?? null;
}

function refuseRoot(path: string): void {
  if (path === "/")
    throw new EndpointError(
      400,
      "/ cannot be private: it would close the whole site, and / is not a bundle. Make /root private to close the " +
        "home page.",
    );
}

export async function setPrivate(app: PagesApp, path: string): Promise<{ created: boolean }> {
  refuseRoot(path);
  const privates = await privatePaths(app);
  if (privates.includes(path)) return { created: false };

  // Nested scopes would leave a visitor needing two links for one page, or one link silently opening
  // a narrower scope somebody closed on purpose. Neither is worth having, so neither exists.
  const above = closedBy(privates, path);
  if (above)
    throw new EndpointError(
      400,
      `${above} is already private and privacy does not nest, so ${path} cannot be a separate scope. Share ` +
        `${above} instead, or make it public first.`,
    );
  const below = await app.access.points({ prefix: `${pointOf(path)}/` });
  if (below.length > 0)
    throw new EndpointError(
      400,
      `${below.map(pathOf).join(", ")} ${below.length === 1 ? "is" : "are"} already private and privacy does not ` +
        `nest, so ${path} cannot close over ${below.length === 1 ? "it" : "them"}. Make ${below.length === 1 ? "it" : "them"} public first.`,
    );

  await app.access.create(pointOf(path), {
    parent: SITE_POINT,
    inherit: false,
    grants: [{ to: { owner: true }, level: "manage" }],
  });
  return { created: true };
}

// Reopening ends every link on the path, because those links exist only to open something closed.
export async function setPublic(app: PagesApp, path: string): Promise<{ revoked: string[] } | null> {
  refuseRoot(path);
  if (!(await privatePaths(app)).includes(path)) return null;
  const links = await app.access.links(pointOf(path));
  await app.access.remove(pointOf(path));
  return { revoked: links.map((link) => link.label ?? link.id) };
}

export interface ShareSummary {
  label: string;
  created: string;
  expires: string | null;
}

const summarize = (link: { label: string | null; id: string; createdAt: Date; expiresAt: Date | null }) => ({
  label: link.label ?? link.id,
  created: link.createdAt.toISOString(),
  expires: link.expiresAt?.toISOString() ?? null,
});

export async function sharesOf(app: PagesApp, path: string): Promise<ShareSummary[]> {
  return (await app.access.links(pointOf(path))).map(summarize);
}

// Labels are unique per path so revoking by label can never take the wrong link away.
export async function mintShare(
  app: PagesApp,
  path: string,
  label: string,
): Promise<{ token: string; share: ShareSummary; closed: boolean }> {
  const { created } = await setPrivate(app, path);
  const existing = await app.access.links(pointOf(path));
  if (existing.some((link) => link.label === label))
    throw new EndpointError(
      400,
      `${path} already has a share labelled "${label}". Revoke that one first, or use another label.`,
    );
  const { id, token } = await app.access.link(pointOf(path), "read", { label });
  const minted = (await app.access.links(pointOf(path))).find((link) => link.id === id);
  if (!minted) throw new Error(`the share link ${id} on ${path} was minted but is not listed`);
  return { token, share: summarize(minted), closed: created };
}

export async function revokeShares(
  app: PagesApp,
  path: string,
  label: string | undefined,
): Promise<{ revoked: string[]; remaining: number }> {
  const links = await app.access.links(pointOf(path));
  const gone = label === undefined ? links : links.filter((link) => link.label === label);
  for (const link of gone) await app.access.revokeLink(pointOf(path), link.id);
  return { revoked: gone.map((link) => link.label ?? link.id), remaining: links.length - gone.length };
}

// What everyone may read, in order: each path is checked at the first existing point of its chain,
// as a visitor's request is. A listing served to every visitor is one copy, so it can only ever show
// what a stranger may see; a link holder reaches their page by the link.
export async function publicOnly<T>(app: PagesApp, items: readonly T[], pathOf: (item: T) => string): Promise<T[]> {
  const entries = items.map((item) => pointsFor(pathOf(item)));
  const kept = new Set(await app.access.asEveryone().filter(entries, "read"));
  return items.filter((_, i) => kept.has(entries[i]));
}
