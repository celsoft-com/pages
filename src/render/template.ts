import { Drop, Liquid } from "liquidjs";
import { getCollection, normalizeCollectionPath } from "../data/service";
import { listable } from "../pages/contents";
import { normalizePath } from "../pages/path";
import { buildStamp, describeBuild } from "../build";
import { countWords, getPage, listPages } from "../pages/service";
import type { PagesApp } from "../pages-app";
import { publicOnly } from "../privacy";
import type { Page, PageSummary } from "../types";
import { escapeHtml } from "./theme";

// The page a template renders for, or null for chrome rendered around something that is not one.
export interface TemplateScope {
  page: Page | null;
}

// minutes is a reading time at a steady 230 words a minute, at least one; a page that wants another
// figure sets its own in meta and prints that instead.
function pageValue(page: Page | PageSummary) {
  const words = "words" in page ? page.words : countWords(page.body);
  return {
    path: page.path,
    title: page.title,
    format: page.contentType,
    updated: new Date(page.updatedAt).toISOString(),
    words,
    minutes: Math.max(1, Math.ceil(words / 230)),
    meta: page.meta,
  };
}

// The deploy serving this render, as the admin and the docs already print it.
function buildValue() {
  const stamp = buildStamp();
  return {
    description: describeBuild(stamp),
    commit: stamp.commit,
    branch: stamp.branch,
    built: stamp.builtAt,
  };
}

// Read on first use and once per render, so a template that never touches site.pages costs no list.
class SiteDrop extends Drop {
  private cached: Promise<ReturnType<typeof pageValue>[]> | null = null;

  constructor(
    private readonly app: PagesApp,
    readonly title: string,
    readonly description: string,
  ) {
    super();
  }

  get pages() {
    this.cached ??= listPages(this.app)
      .then((all) => publicOnly(this.app, listable(all), (page) => page.path))
      .then((pages) => pages.map(pageValue));
    return this.cached;
  }
}

// collections["/trip/items"] is the served contract, the item array in collection order, read only
// when a template names it. A collection this response may not see answers as one that is missing.
class CollectionsDrop extends Drop {
  private readonly cache = new Map<string, Promise<unknown[] | undefined>>();

  constructor(private readonly app: PagesApp) {
    super();
  }

  liquidMethodMissing(key: string | number) {
    const path = normalizeCollectionPath(String(key));
    if (!this.cache.has(path))
      this.cache.set(
        path,
        publicOnly(this.app, [path], (p) => p).then(async ([open]) =>
          open === undefined ? undefined : (await getCollection(this.app, path))?.items,
        ),
      );
    return this.cache.get(path);
  }
}

// Every limit is generous for a page and finite for a loop nobody meant to write: a template runs on
// the request path, and one that never finishes takes the site down with it.
function engine(app: PagesApp): Liquid {
  const named = (file: string): Promise<Page | null> => getPage(app, normalizePath(file));
  return new Liquid({
    fs: {
      exists: async (file) => (await named(file)) !== null,
      existsSync: () => false,
      readFile: async (file) => (await named(file))?.body ?? "",
      readFileSync: () => "",
      resolve: (_dir, file) => file,
      contains: async () => true,
      containsSync: () => true,
    },
    root: ["/"],
    extname: "",
    relativeReference: false,
    outputEscape: "escape",
    strictFilters: true,
    ownPropertyOnly: true,
    parseLimit: 1e6,
    renderLimit: 2000,
    memoryLimit: 5e7,
  });
}

export interface TemplateContext {
  app: PagesApp;
  input: TemplateScope;
  site: { title: string; description: string };
}

// A template that fails renders its error where its output would have gone, so one bad fence costs
// its own block and not the page around it, and whoever looks at the page sees why.
export async function renderTemplate(source: string, context: TemplateContext): Promise<string> {
  try {
    return await engine(context.app).parseAndRender(source, {
      page: context.input.page ? pageValue(context.input.page) : null,
      site: new SiteDrop(context.app, context.site.title, context.site.description),
      collections: new CollectionsDrop(context.app),
      build: buildValue(),
    });
  } catch (error) {
    return `<pre class="pages-error">Template error: ${escapeHtml((error as Error).message)}</pre>`;
  }
}

const FENCE = /^```pages[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm;

// A fence renders to HTML before markdown runs, and markdown must not see that HTML: a rendered list
// indented or broken across lines would be read as a code block or a paragraph. Each fence becomes a
// comment marked leaves alone, and the output is put back once marked is done.
export async function expandFences(
  markdown: string,
  context: TemplateContext,
  render: (source: string) => string,
): Promise<string> {
  const outputs: string[] = [];
  const marked = markdown.replace(FENCE, (_whole, source: string) => {
    outputs.push(source);
    return `<!--pages-fence-${outputs.length - 1}-->`;
  });
  const rendered = await Promise.all(outputs.map((source) => renderTemplate(source, context)));
  return render(marked).replace(/<!--pages-fence-(\d+)-->/g, (_whole, index: string) => rendered[Number(index)]);
}

export function templateInput(page: Page | null): TemplateScope {
  return { page };
}
