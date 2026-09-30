import { Drop, Liquid } from "liquidjs";
import { getCollection, normalizeCollectionPath } from "../data/service";
import { getPrivacy, privateScope } from "../private/service";
import { listable } from "../pages/contents";
import { normalizePath } from "../pages/path";
import { getPage, listPages } from "../pages/service";
import type { Page, PageSummary, Privacy } from "../types";
import { escapeHtml } from "./theme";

// What a template may see, and for whom. scope is the private scope the response is served under,
// or null for a public one: a public response is cached at the edge for everyone, so it may read
// only public pages and collections, while a page inside a private scope may also read what shares
// that scope with it. The same rule as the contents list, applied to every read a template makes.
export interface TemplateScope {
  page: Page | null;
  privacy: Privacy;
}

function scopeOf(input: TemplateScope): string | null {
  return input.page ? (privateScope(input.privacy, input.page.path)?.path ?? null) : null;
}

function visible(input: TemplateScope, path: string): boolean {
  const covering = privateScope(input.privacy, path);
  return covering === null || covering.path === scopeOf(input);
}

function pageValue(page: Page | PageSummary) {
  return {
    path: page.path,
    title: page.title,
    format: page.contentType,
    updated: new Date(page.updatedAt).toISOString(),
    meta: page.meta,
  };
}

// Read on first use and once per render, so a template that never touches site.pages costs no list.
class SiteDrop extends Drop {
  private cached: Promise<ReturnType<typeof pageValue>[]> | null = null;

  constructor(
    private readonly input: TemplateScope,
    readonly title: string,
    readonly description: string,
  ) {
    super();
  }

  get pages() {
    this.cached ??= listPages().then((all) =>
      listable(all)
        .filter((page) => visible(this.input, page.path))
        .map(pageValue),
    );
    return this.cached;
  }
}

// collections["/trip/items"] is the served contract, the item array in collection order, read only
// when a template names it. A collection this response may not see answers as one that is missing.
class CollectionsDrop extends Drop {
  private readonly cache = new Map<string, Promise<unknown[] | undefined>>();

  constructor(private readonly input: TemplateScope) {
    super();
  }

  liquidMethodMissing(key: string | number) {
    const path = normalizeCollectionPath(String(key));
    if (!this.cache.has(path))
      this.cache.set(
        path,
        visible(this.input, path) ? getCollection(path).then((found) => found?.items) : Promise.resolve(undefined),
      );
    return this.cache.get(path);
  }
}

// Every limit is generous for a page and finite for a loop nobody meant to write: a template runs on
// the request path, and one that never finishes takes the site down with it.
function engine(input: TemplateScope): Liquid {
  const named = async (file: string): Promise<Page | null> => {
    const path = normalizePath(file);
    return visible(input, path) ? getPage(path) : null;
  };
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
  input: TemplateScope;
  site: { title: string; description: string };
}

// A template that fails renders its error where its output would have gone, so one bad fence costs
// its own block and not the page around it, and whoever looks at the page sees why.
export async function renderTemplate(source: string, context: TemplateContext): Promise<string> {
  try {
    return await engine(context.input).parseAndRender(source, {
      page: context.input.page ? pageValue(context.input.page) : null,
      site: new SiteDrop(context.input, context.site.title, context.site.description),
      collections: new CollectionsDrop(context.input),
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

export async function templateInput(page: Page | null): Promise<TemplateScope> {
  return { page, privacy: await getPrivacy() };
}
