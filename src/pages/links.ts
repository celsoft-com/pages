import { API_PREFIX } from "../api/handler";
import { listAssets } from "../assets/service";
import { listCollections, MANIFEST_PATH, normalizeCollectionPath } from "../data/service";
import { DOCS_PREFIX } from "../docs/handler";
import { ROOT_BUNDLE, normalizeAssetPath, normalizePath } from "./path";
import { getPage, listPages } from "./service";

export interface BrokenLink {
  path: string;
  line: number;
  link: string;
}

export interface LinkReport {
  pages: number;
  links: number;
  broken: BrokenLink[];
}

// Only what a page wrote out whole: a markdown link, an href, a src, and a quoted /data or /assets
// URL, which is how a script fetches a collection. A URL assembled from pieces cannot be found here,
// which is why the report counts what it looked at.
const LINK = /\]\((\/[^)\s]*)|\b(?:href|src)=["'](\/[^"']*)["']|["'`](\/(?:data|assets)\/[^"'`\s]*)["'`]/g;

// Routes the app answers itself. Matched on a segment boundary, like the router. Built per call
// rather than at load, because the API handler imports the tool registry that imports this.
function served(path: string): boolean {
  const exact = ["/", ROOT_BUNDLE, "/mcp", "/favicon.ico", "/robots.txt", "/_unlock"];
  const prefixes = ["/admin", "/oauth", "/.well-known", DOCS_PREFIX, API_PREFIX];
  return exact.includes(path) || prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function pathOf(link: string): string | null {
  if (link.startsWith("//")) return null;
  const bare = link.split("#")[0].split("?")[0];
  try {
    return decodeURIComponent(bare) || "/";
  } catch {
    return bare || "/";
  }
}

export async function checkLinks(): Promise<LinkReport> {
  const [summaries, assets, collections] = await Promise.all([listPages(), listAssets(), listCollections()]);
  const pages = new Set(summaries.map((page) => page.path));
  const assetKeys = new Set(assets.flatMap((asset) => [asset.key, ...(asset.path ? [asset.path] : [])]));
  const collectionPaths = new Set(collections.map((collection) => collection.path));

  const resolves = (path: string): boolean => {
    if (served(path)) return true;
    if (path.startsWith("/assets/")) {
      const rest = path.slice("/assets".length);
      return assetKeys.has(rest.slice(1)) || assetKeys.has(normalizeAssetPath(rest));
    }
    if (path.startsWith("/data/")) {
      const target = normalizeCollectionPath(path.slice("/data".length));
      return target === MANIFEST_PATH || collectionPaths.has(target);
    }
    return pages.has(normalizePath(path));
  };

  const broken: BrokenLink[] = [];
  let links = 0;
  for (const summary of summaries) {
    const page = await getPage(summary.path);
    if (!page) continue;
    for (const [index, text] of page.body.split("\n").entries())
      for (const match of text.matchAll(LINK)) {
        const link = match[1] ?? match[2] ?? match[3];
        const path = pathOf(link);
        if (path === null) continue;
        links += 1;
        if (!resolves(path)) broken.push({ path: page.path, line: index + 1, link });
      }
  }
  return { pages: summaries.length, links, broken };
}
