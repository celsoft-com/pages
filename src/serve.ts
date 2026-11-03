import { EndpointError, page, route } from "@celsoft/platform";
import { z } from "zod";
import { findAsset } from "./assets/service";
import { docsPage } from "./docs/pages";
import { favicon } from "./favicon";
import { getCollection, manifest, MANIFEST_PATH, normalizeCollectionPath } from "./data/service";
import { contentsHtml, listable } from "./pages/contents";
import { normalizeAssetPath, normalizePath, ROOT_BUNDLE } from "./pages/path";
import { getPage, listPages, previewOf } from "./pages/service";
import { type PagesApp, pointsFor, SITE_POINT } from "./pages-app";
import { publicOnly } from "./privacy";
import { loadChrome } from "./render/chrome";
import { renderMarkdown } from "./render/markdown";
import { expandFences, templateInput } from "./render/template";
import { layout } from "./render/theme";
import { assetFile } from "./store";
import type { Page } from "./types";

export const CACHE = { seconds: 3600 };
const REST = z.object({ path: z.string() });

// Every route is gated where its path sits: by the private path at or above it, or by the site.
const at = (normalize: (raw: string) => string, level: "read" | "write" = "read") => ({
  point: ({ path }: { path: string }) => pointsFor(normalize(path)),
  level,
});

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
    "/": route(
      { access: { point: () => pointsFor(ROOT_BUNDLE), level: "read" }, cache: CACHE },
      async (_params, app) => {
        const stored = await getPage(app, ROOT_BUNDLE);
        if (stored) return rendered(app, stored);
        const { chrome } = await loadChrome(app, templateInput(null));
        return contentsHtml({ chrome, pages: listable(await publicOnly(app, await listPages(app), (p) => p.path)) });
      },
    ),
  },
});

const pages = page({
  path: "/p",
  routes: {
    "/*path": route({ params: REST, access: at(normalizePath), cache: CACHE }, async ({ path: raw }, app) => {
      const path = normalizePath(raw);
      // The home page is served at /, so it has one URL, not two.
      if (path === ROOT_BUNDLE) return new Response(null, { status: 301, headers: { location: "/" } });
      const stored = await getPage(app, path);
      if (!stored) throw notFound(`/p${path}`);
      return rendered(app, stored);
    }),
  },
});

// The index of every collection belongs to no path, so only the site gates it.
const dataPath = (raw: string) => (normalizeCollectionPath(raw) === MANIFEST_PATH ? "/" : normalizeCollectionPath(raw));

// Collection /a/b is served at /data/a/b.json as a bare array of its items, in collection order.
const data = page({
  path: "/data",
  routes: {
    "/*path": route({ params: REST, access: at(dataPath), cache: CACHE }, async ({ path: raw }, app) => {
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
    "/*path": route({ params: REST, access: at(normalizeAssetPath), cache: CACHE }, async ({ path: raw }, app) => {
      const asset = await findAsset(app, raw);
      if (!asset) throw notFound(`/assets/${raw}`);
      return app.files.response(assetFile(asset.key));
    }),
  },
});

// The working copy, with chrome and templates, at the page's path under /preview. It is a route of its
// own because a handler cannot tell who is asking: only someone who may write the page gets past the
// gate, and the answer is never kept, so readers of /p never meet a draft or learn that one exists.
const preview = page({
  path: "/preview",
  routes: {
    "/*path": route({ params: REST, access: at(normalizePath, "write") }, async ({ path: raw }, app) => {
      const stored = await getPage(app, normalizePath(raw));
      if (!stored) throw notFound(`/preview/${raw}`);
      return rendered(app, previewOf(stored));
    }),
  },
});

// The icon sits in the /root folder, so it is gated where the home page is.
const icon = page({
  path: "/favicon.ico",
  routes: {
    "/": route({ access: { point: () => pointsFor(ROOT_BUNDLE), level: "read" }, cache: CACHE }, (_params, app) =>
      favicon(app),
    ),
  },
});

// The software's own documentation, the same on every site and readable by anyone the site is.
const SLUG = z.object({ slug: z.string() });
const docs = page({
  path: "/docs",
  routes: {
    "/": route({ access: { point: () => SITE_POINT, level: "read" }, cache: CACHE }, (_params, app) => docsPage(app, "")),
    "/:slug": route({ params: SLUG, access: { point: () => SITE_POINT, level: "read" }, cache: CACHE }, ({ slug }, app) =>
      docsPage(app, slug),
    ),
  },
});

export const servedPages = [home, pages, data, assets, preview, icon, docs];
