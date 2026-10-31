import { EndpointError, page, route } from "@celsoft/platform";
import { z } from "zod";
import { findAsset } from "./assets/service";
import { getCollection, manifest, MANIFEST_PATH, normalizeCollectionPath } from "./data/service";
import { contentsHtml, listable } from "./pages/contents";
import { normalizePath, ROOT_BUNDLE } from "./pages/path";
import { getPage, listPages } from "./pages/service";
import { SITE_POINT, type PagesApp } from "./pages-app";
import { loadChrome } from "./render/chrome";
import { renderMarkdown } from "./render/markdown";
import { expandFences, templateInput } from "./render/template";
import { layout } from "./render/theme";
import { assetFile } from "./store";
import type { Page } from "./types";

// Every path is read through the site point until private paths give each one its own.
const READ = { point: () => SITE_POINT, level: "read" } as const;
export const CACHE = { seconds: 3600 };
const REST = z.object({ path: z.string() });

const notFound = (path: string) => new EndpointError(404, `Nothing is published at ${path}.`);

// Markdown is themed and runs its templates; HTML is served exactly as written.
async function rendered(app: PagesApp, stored: Page): Promise<string> {
  if (stored.contentType === "html") return stored.body;
  const { chrome, context } = await loadChrome(app, templateInput(stored));
  const content = await expandFences(stored.body, context, renderMarkdown);
  return layout({ title: stored.title, chrome, content });
}

// The page at /root is the home page; without one, / is the contents of the site.
const home = page({
  path: "/",
  routes: {
    "/": route({ access: READ, cache: CACHE }, async (_params, app) => {
      const stored = await getPage(app, ROOT_BUNDLE);
      if (stored) return rendered(app, stored);
      const { chrome } = await loadChrome(app, templateInput(null));
      return contentsHtml({ chrome, pages: listable(await listPages(app)) });
    }),
  },
});

const pages = page({
  path: "/p",
  routes: {
    "/*path": route({ params: REST, access: READ, cache: CACHE }, async ({ path: raw }, app) => {
      const path = normalizePath(raw);
      // The home page is served at /, so it has one URL, not two.
      if (path === ROOT_BUNDLE) return new Response(null, { status: 301, headers: { location: "/" } });
      const stored = await getPage(app, path);
      if (!stored) throw notFound(`/p${path}`);
      return rendered(app, stored);
    }),
  },
});

// Collection /a/b is served at /data/a/b.json as a bare array of its items, in collection order.
const data = page({
  path: "/data",
  routes: {
    "/*path": route({ params: REST, access: READ, cache: CACHE }, async ({ path: raw }, app) => {
      if (!/\.json$/i.test(raw)) throw notFound(`/data/${raw}`);
      const path = normalizeCollectionPath(raw);
      const headers = { "access-control-allow-origin": "*" };
      if (path === MANIFEST_PATH) return Response.json(await manifest(app), { headers });
      const collection = await getCollection(app, path);
      if (!collection) throw notFound(`/data/${raw}`);
      return Response.json(collection.items, { headers });
    }),
  },
});

const assets = page({
  path: "/assets",
  routes: {
    "/*path": route({ params: REST, access: READ, cache: CACHE }, async ({ path: raw }, app) => {
      const asset = await findAsset(app, raw);
      if (!asset) throw notFound(`/assets/${raw}`);
      return app.files.response(assetFile(asset.key));
    }),
  },
});

export const servedPages = [home, pages, data, assets];
