import { listAssets } from "../assets/service";
import { listCollections, MANIFEST_PATH, normalizeCollectionPath } from "../data/service";
import type { PagesApp } from "../pages-app";
import { normalizeAssetPath, normalizePath, ROOT_BUNDLE } from "./path";
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

function pathOf(link: string): string | null {
  if (link.startsWith("//")) return null;
  const bare = link.split("#")[0].split("?")[0];
  try {
    return decodeURIComponent(bare) || "/";
  } catch {
    return bare || "/";
  }
}

// The lines a reader's links are on, numbered from 1. In markdown, a code block other than a pages fence
// and an inline code span are prose about links, such as an example URL, and a reader follows neither.
function* linesToRead(body: string, format: string): Generator<[number, string]> {
  let fence: string | null = null;
  for (const [index, line] of body.split("\n").entries()) {
    if (format !== "markdown") {
      yield [index, line];
      continue;
    }
    const opens = /^\s*```(\S*)/.exec(line);
    if (opens) {
      fence = fence === null ? opens[1] || "code" : null;
      continue;
    }
    if (fence !== null && fence !== "pages") continue;
    yield [index, fence === "pages" ? line : line.replace(/`[^`]*`/g, "")];
  }
}

const under = (prefix: string, path: string) => (path.startsWith(`${prefix}/`) ? path.slice(prefix.length) : null);

export async function checkLinks(app: PagesApp): Promise<LinkReport> {
  const [summaries, assets, collections] = await Promise.all([listPages(app), listAssets(app), listCollections(app)]);
  const pages = new Set(summaries.map((page) => page.path));
  const assetKeys = new Set(assets.flatMap((asset) => [asset.key, ...(asset.path ? [asset.path] : [])]));
  const collectionPaths = new Set(collections.map((collection) => collection.path));

  // The platform knows every route, screen and file; the claims under /p, /preview, /data and
  // /assets answer any path, so whether something is stored there is the app's question.
  const resolves = (path: string): boolean => {
    const answer = app.routes.serves(path);
    if (answer !== "page") return answer !== null;
    // /p/root always answers, with a redirect to the home page at /.
    const live = under("/p", path);
    if (live !== null && normalizePath(live) === ROOT_BUNDLE) return true;
    const page = live ?? under("/preview", path);
    if (page !== null) return pages.has(normalizePath(page));
    const asset = under("/assets", path);
    if (asset !== null) return assetKeys.has(asset.slice(1)) || assetKeys.has(normalizeAssetPath(asset));
    const data = under("/data", path);
    if (data !== null) {
      // A prefix a script adds file names to, such as const BASE = "/data/trip/", stands for the
      // collections under it, so it resolves while any is there.
      if (data.endsWith("/")) {
        const prefix = normalizePath(data);
        return [...collectionPaths].some((path) => path.startsWith(prefix === "/" ? "/" : `${prefix}/`));
      }
      const target = normalizeCollectionPath(data);
      return /\.json$/i.test(data) && (target === MANIFEST_PATH || collectionPaths.has(target));
    }
    return true;
  };

  const broken: BrokenLink[] = [];
  let links = 0;
  for (const summary of summaries) {
    const page = await getPage(app, summary.path);
    if (!page) continue;
    for (const [index, text] of linesToRead(page.body, page.contentType))
      for (const match of text.matchAll(LINK)) {
        const link = match[1] ?? match[2] ?? match[3];
        // A link a template completes, such as /p/{{ kind }}, is not written out whole.
        if (/\{\{|\{%/.test(link)) continue;
        const path = pathOf(link);
        if (path === null) continue;
        links += 1;
        if (!resolves(path)) broken.push({ path: page.path, line: index + 1, link });
      }
  }
  return { pages: summaries.length, links, broken };
}
