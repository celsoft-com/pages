import { endpoint } from "@celsoft/platform";
import { z } from "zod";
import { DIRECTORY_API, topLevel } from "../pages/contents";
import { listPages } from "../pages/service";
import { pointsFor } from "../pages-app";

export const directoryEndpoints = {
  directory: endpoint(
    {
      serve: ["api"],
      method: "GET",
      path: DIRECTORY_API,
      description:
        "The site's top-level pages this caller may open, for the directory at / to add the private ones to " +
        "its public list. Each page is checked as /p checks it, so it never names a page that would be a 404 " +
        "for this caller: signed out with no link, only public pages; the owner, everything; a share link, " +
        "its own path.",
      access: "anon",
      input: z.object({}),
      output: z.object({
        pages: z.array(
          z.object({
            path: z.string(),
            title: z.string(),
            private: z.boolean().describe("True when a stranger signed out could not open it"),
          }),
        ),
      }),
    },
    async (_input, app) => {
      const pages = topLevel(await listPages(app));
      const points = pages.map((page) => pointsFor(page.path));
      const [mine, everyone] = await Promise.all([
        app.access.filter(points, "read"),
        app.access.asEveryone().filter(points, "read"),
      ]);
      const open = new Set(mine);
      const shared = new Set(everyone);
      return {
        pages: pages.flatMap((page, i) =>
          open.has(points[i]) ? [{ path: page.path, title: page.title, private: !shared.has(points[i]) }] : [],
        ),
      };
    },
  ),
};
