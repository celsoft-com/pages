import { endpoint } from "@celsoft/platform";
import { z } from "zod";
import { site } from "./shared";

const REDIRECTS =
  "A redirect sends a browser from an address nothing answers to another one, so links into moved content keep " +
  "working. It is read only when no page, collection, file or platform route answers the address, so it can never " +
  "hide anything that is there.";

const REDIRECT = z.object({
  from: z.string().describe("The address it answers, such as /essay/x"),
  to: z.string().describe("Where it sends the browser: a path on this site or an https:// address"),
  status: z.number().describe("301, 302, 307 or 308"),
  prefix: z.boolean().describe("True when it also moves every address below from, keeping the rest"),
});

export const redirectEndpoints = {
  list_redirects: endpoint(
    {
      serve: ["api", "mcp"],
      method: "GET",
      path: "/api/v1/list_redirects",
      description: `List every redirect the site keeps. ${REDIRECTS}`,
      access: { point: site, level: "read" },
      input: z.object({}),
      output: z.object({ redirects: z.array(REDIRECT) }),
    },
    async (_input, app) => ({ redirects: await app.redirects.list() }),
  ),

  set_redirect: endpoint(
    {
      serve: ["api", "mcp"],
      method: "POST",
      path: "/api/v1/set_redirect",
      description:
        `Send one address, or with prefix every address below it, to another. ${REDIRECTS} Setting it again for ` +
        "the same from replaces it. / and /api/ cannot be redirected, and a redirect that would loop is refused.",
      access: { point: site, level: "manage" },
      input: z.object({
        from: z.string().describe("The address to answer, such as /essay/x"),
        to: z.string().describe("Where to send the browser, such as /p/essay/x or an https:// address"),
        prefix: z.boolean().optional().describe("Also move every address below from, keeping the rest. Default false."),
        status: z
          .union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)])
          .optional()
          .describe("301 unless given: permanent, so browsers and search engines remember it"),
      }),
      output: REDIRECT,
    },
    async ({ from, to, prefix, status }, app) => {
      await app.redirects.set(from, to, { prefix: prefix ?? false, status: status ?? 301 });
      return { from, to, status: status ?? 301, prefix: prefix ?? false };
    },
  ),

  remove_redirect: endpoint(
    {
      serve: ["api", "mcp"],
      method: "POST",
      path: "/api/v1/remove_redirect",
      description: `Stop redirecting an address, so it answers 404 again unless something is published there. ${REDIRECTS}`,
      access: { point: site, level: "manage" },
      input: z.object({ from: z.string().describe("The address the redirect answers") }),
      output: z.object({ from: z.string(), removed: z.boolean().describe("False when there was no redirect from it") }),
    },
    async ({ from }, app) => {
      const had = (await app.redirects.list()).some((r) => r.from === from);
      if (had) await app.redirects.remove(from);
      return { from, removed: had };
    },
  ),
};
