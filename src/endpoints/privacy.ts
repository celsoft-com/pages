import { endpoint, EndpointError } from "@celsoft/platform";
import { z } from "zod";
import { bundleContents } from "../inventory";
import {
  closedBy,
  mintShare,
  privatePaths,
  revokeShares,
  setPrivate,
  setPublic,
  sharesOf,
} from "../privacy";
import { atPath, requirePath, site, urlFor } from "./shared";

const PRIVACY =
  "A private path is closed to the public and opened only by a share link. It covers a path and everything at or " +
  "under it, the same folder rule as a bundle, so making /trip private closes the page at /trip, every page under " +
  "it, /data/trip/*.json and every asset under /assets/trip/. To everyone without a link those all answer exactly " +
  "as if nothing were published there, so a private path never reveals that it exists, and it drops out of the " +
  "contents at /, the index of collections and what templates list. Privacy does not nest: a path inside a private " +
  "path cannot be a second scope, and a path above one cannot close over it. / cannot be private; make /root " +
  "private to close the home page. A share link carries its secret in the URL fragment, after #link=, which " +
  "browsers never send to a server, so the link appears in no server log and no Referer header, and a chat or mail " +
  "app that previews links cannot open it. Anyone holding a link is in, so it is only as private as the channel it " +
  "is sent through, and it opens in a browser with JavaScript on. Revoke a link with revoke_share and it stops " +
  "working on the holder's next request.";

const SHARE = z.object({
  label: z.string().describe("Who it is for. The link itself is not stored and cannot be listed."),
  created: z.string().describe("When it was minted, ISO 8601"),
  expires: z.string().nullable().describe("When it stops working, or null for never"),
});

const LABEL = z
  .string()
  .trim()
  .min(1, "label is required")
  .max(100)
  .describe('Who this link is for, for example "Dana" or "the builders". Unique per path.');

export const privacyEndpoints = {
  set_privacy: endpoint(
    {
      serve: ["api", "mcp"],
      method: "POST",
      path: "/api/v1/set_privacy",
      description:
        "Close a path to the public, or reopen it. " +
        PRIVACY +
        " Making a path private takes it away from everyone but the owner immediately; call share_path to mint the " +
        "link that opens it. Making it public again revokes every share on it, because those links exist only to " +
        "open something closed, and reopens everything under it to anyone.",
      access: { point: atPath(), level: "manage" },
      input: z.object({
        path: z.string().describe("The path to close or reopen, for example /trip"),
        private: z.boolean().describe("true closes the path, false reopens it"),
      }),
      output: z.object({
        path: z.string(),
        private: z.boolean(),
        url: z.string(),
        closed: z
          .object({ pages: z.number(), collections: z.number(), assets: z.number() })
          .optional()
          .describe("What closing it took away from the public. Absent unless it was just closed."),
        revoked: z
          .array(z.string())
          .optional()
          .describe("Labels of the share links reopening killed. Absent unless it was just reopened."),
        note: z.string(),
      }),
    },
    async ({ path: raw, private: closing }, app) => {
      const path = requirePath(raw);
      const url = urlFor(app, path);
      if (closing) {
        const { created } = await setPrivate(app, path);
        if (!created) return { path, private: true, url, note: `${path} was already private.` };
        const held = await bundleContents(app, path);
        return {
          path,
          private: true,
          url,
          closed: { pages: held.pages.length, collections: held.collections.length, assets: held.assets.length },
          note: "Nobody but the owner can reach any of it until you call share_path to mint a link.",
        };
      }
      const reopened = await setPublic(app, path);
      if (!reopened) {
        const above = closedBy(await privatePaths(app), path);
        if (above)
          throw new EndpointError(
            400,
            `${path} has no privacy of its own: it is private because ${above} is. Reopen ${above} instead.`,
          );
        return { path, private: false, url, note: `${path} was already public.` };
      }
      return {
        path,
        private: false,
        url,
        revoked: reopened.revoked,
        note: "Everything at or under this path is public again, and every share link on it is dead.",
      };
    },
  ),

  share_path: endpoint(
    {
      serve: ["api", "mcp"],
      method: "POST",
      path: "/api/v1/share_path",
      description:
        "Return a link that opens a private path, and make the path private if it is not already. " +
        PRIVACY +
        " Mint one link per recipient and label it with who it is for: revoke_share takes a label, so one " +
        "recipient's link can be killed without disturbing anybody else's. The link is returned once and cannot be " +
        "shown again, because only its hash is stored; losing it means minting another. Give the whole link to the " +
        "owner exactly as returned, fragment and all: everything after the # is the secret, and a link with that " +
        "part trimmed opens nothing.",
      access: { point: atPath(), level: "manage" },
      input: z.object({
        path: z.string().describe("The path to share, for example /trip"),
        label: LABEL,
      }),
      output: z.object({
        path: z.string(),
        label: z.string(),
        link: z.string().describe("The whole link, fragment included. Shown once: only a hash is stored."),
        created: z.string().describe("When it was minted, ISO 8601"),
        closed: z.boolean().describe("True when this call also made the path private"),
        note: z.string(),
      }),
    },
    async ({ path: raw, label }, app) => {
      const path = requirePath(raw);
      const { token, share, closed } = await mintShare(app, path, label);
      return {
        path,
        label: share.label,
        link: `${urlFor(app, path)}#link=${token}`,
        created: share.created,
        closed,
        note: "Shown once. Only a hash is stored, so this link cannot be printed again.",
      };
    },
  ),

  list_shares: endpoint(
    {
      serve: ["api", "mcp"],
      method: "GET",
      path: "/api/v1/list_shares",
      description:
        "List every private path with its share links: who each is for, when it was minted and when it expires. " +
        "Pass a path for just that one. The links themselves are not stored and cannot be listed, only their " +
        "labels, so this answers who has access and not what to send them. When a link was last used is not " +
        "kept. A path with no shares is closed to everyone but the owner, which is a normal state for something " +
        "still being written.",
      access: { point: site, level: "manage" },
      input: z.object({ path: z.string().optional().describe("One private path, or leave out for all") }),
      output: z.object({
        private: z
          .array(z.object({ path: z.string(), url: z.string(), shares: z.array(SHARE) }))
          .describe("Every private path, or the one you named. Empty when the path you named is not a scope."),
        closed_by: z
          .string()
          .optional()
          .describe("When the path you named is private because a path above it is: that path, whose shares open it"),
        note: z.string().optional(),
      }),
    },
    async ({ path: raw }, app) => {
      const privates = await privatePaths(app);
      const wanted = raw === undefined ? null : requirePath(raw);
      if (wanted && !privates.includes(wanted)) {
        const above = closedBy(privates, wanted);
        return above
          ? {
              private: [],
              closed_by: above,
              note: `${wanted} is private because ${above} is. Its shares are listed under that path.`,
            }
          : { private: [], note: `${wanted} is public.` };
      }
      const paths = wanted ? [wanted] : privates;
      return {
        private: await Promise.all(
          paths.map(async (path) => ({ path, url: urlFor(app, path), shares: await sharesOf(app, path) })),
        ),
      };
    },
  ),

  revoke_share: endpoint(
    {
      serve: ["api", "mcp"],
      method: "POST",
      path: "/api/v1/revoke_share",
      description:
        "Kill a share link. Pass a label to revoke that one recipient's link, or leave it out to revoke every link " +
        "on the path. It stops working on the holder's next request, because every request checks the link " +
        "against the stored list. The path stays private, so revoking the last link leaves it closed to everyone " +
        "but the owner rather than quietly publishing it; call set_privacy with private false to reopen it.",
      access: { point: atPath(), level: "manage" },
      input: z.object({
        path: z.string().describe("The private path, for example /trip"),
        label: z.string().trim().min(1).optional().describe("Revoke only the link with this label"),
      }),
      output: z.object({
        path: z.string(),
        revoked: z.array(z.string()).describe("Labels killed. Empty when there was nothing to revoke."),
        remaining: z.number().describe("Links still open on the path"),
        note: z.string(),
      }),
    },
    async ({ path: raw, label }, app) => {
      const path = requirePath(raw);
      const privates = await privatePaths(app);
      if (!privates.includes(path)) {
        const above = closedBy(privates, path);
        throw new EndpointError(
          400,
          above
            ? `${path} has no links of its own: it is private because ${above} is. Revoke on ${above}.`
            : `${path} is not private, so it has no share links.`,
        );
      }
      const { revoked, remaining } = await revokeShares(app, path, label);
      const note =
        revoked.length === 0
          ? label
            ? `${path} has no share labelled "${label}".`
            : `${path} has no share links to revoke.`
          : remaining === 0
            ? `${path} is still private and now has no working links, so nobody but the owner can reach it.`
            : `${remaining} other link${remaining === 1 ? "" : "s"} still open ${path}.`;
      return { path, revoked, remaining, note };
    },
  ),
};
