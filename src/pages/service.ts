import { EndpointError } from "@celsoft/platform";
import { asc, eq } from "drizzle-orm";
import type { PagesApp } from "../pages-app";
import { pageSummaries } from "../schema";
import { pageFile } from "../store";
import type { ContentType, Page, PageDraft, PageMeta, PageSummary } from "../types";
import { HOME_IS_AT_ROOT, HOME_IS_GENERATED, ROOT_BUNDLE, normalizePath } from "./path";

// What to say when a page is not there. At /root the answer is what / is serving instead.
export function noPageAt(path: string): string {
  return path === ROOT_BUNDLE ? HOME_IS_GENERATED : `No page exists at ${path}`;
}

// A file written before a field existed still comes back carrying it. Every page read goes
// through here, so a new field is defaulted once.
function hydratePage(stored: Page | null): Page | null {
  return stored ? { ...stored, meta: stored.meta ?? {}, draft: stored.draft ?? null } : null;
}

export async function getPage(app: PagesApp, path: string): Promise<Page | null> {
  return hydratePage(await app.files.getJson<Page>(pageFile(normalizePath(path))));
}

// path and title are fields of the page itself, and a second copy of either in meta would be two
// answers to one question. A key is also a CSS class and a template name, so it stays an identifier.
const META_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const PAGE_FIELDS = ["path", "title"];

export function validateMeta(raw: unknown): PageMeta {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new EndpointError(400, "meta must be an object of string values");
  const meta: PageMeta = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!META_KEY.test(key))
      throw new EndpointError(400, `meta key "${key}" must start with a letter and hold only letters, digits, - and _`);
    if (PAGE_FIELDS.includes(key))
      throw new EndpointError(400, `meta cannot hold "${key}": it is a field of the page itself`);
    if (typeof value !== "string") throw new EndpointError(400, `meta.${key} must be a string`);
    meta[key] = value;
  }
  return meta;
}

export function mergeMeta(existing: PageMeta, raw: unknown): PageMeta {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new EndpointError(400, "meta must be an object of string or null values");
  const entries = Object.entries(raw);
  const removed = entries.filter(([, value]) => value === null).map(([key]) => key);
  const set = validateMeta(Object.fromEntries(entries.filter(([, value]) => value !== null)));
  const merged = { ...existing, ...set };
  for (const key of removed) delete merged[key];
  return merged;
}

// Prose only: code, tags, template tags and markdown punctuation are not read, so they are not counted.
export function countWords(body: string): number {
  const prose = body
    .replace(/^(```|~~~)[\s\S]*?^\1[ \t]*$/gm, " ")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>|\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\}/g, " ")
    .replace(/\]\([^)]*\)/g, "]");
  return prose.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
}

function summarize(page: Page): PageSummary {
  return {
    path: page.path,
    contentType: page.contentType,
    title: page.title,
    meta: page.meta,
    hasDraft: page.draft !== null,
    words: countWords(page.body),
    updatedAt: page.updatedAt,
  };
}

// The only way a page file is written, transfer.ts included. Its summary row follows it so
// listPages can answer from one query without opening every page, and it cannot drift from the
// file because nothing else writes either.
export async function writePageFile(app: PagesApp, page: Page): Promise<void> {
  await app.files.putJson(pageFile(page.path), page);
  const summary = summarize(page);
  await app.db
    .insert(pageSummaries)
    .values({ path: page.path, summary })
    .onConflictDoUpdate({ target: pageSummaries.path, set: { summary } });
}

export async function removePageFile(app: PagesApp, path: string): Promise<void> {
  await app.files.delete(pageFile(path));
  await app.db.delete(pageSummaries).where(eq(pageSummaries.path, path));
}

export async function listPages(app: PagesApp): Promise<PageSummary[]> {
  const rows = await app.db
    .select({ summary: pageSummaries.summary })
    .from(pageSummaries)
    .orderBy(asc(pageSummaries.path));
  return rows.map((row) => row.summary);
}

export async function savePage(
  app: PagesApp,
  input: {
    path: string;
    contentType: ContentType;
    title: string;
    body: string;
    // Left out, the page keeps what it had: an edit to the body is not a decision about its meta.
    meta?: PageMeta;
  },
): Promise<Page> {
  const path = normalizePath(input.path);
  if (path === "/") throw new EndpointError(400, HOME_IS_AT_ROOT);
  const existing = await getPage(app, path);
  const now = Date.now();
  const page: Page = {
    path,
    contentType: input.contentType,
    title: input.title,
    body: input.body,
    meta: input.meta ?? existing?.meta ?? {},
    // A direct write to the live page leaves a working copy alone: it is somebody's unpublished work.
    draft: existing?.draft ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await writePageFile(app, page);
  return page;
}

export async function deletePage(app: PagesApp, path: string): Promise<boolean> {
  const normalized = normalizePath(path);
  if (!(await getPage(app, normalized))) return false;
  await removePageFile(app, normalized);
  return true;
}

export function deriveTitle(body: string, path: string): string {
  const heading = body.match(/^#\s+(.+)$/m) ?? body.match(/<h1[^>]*>(.*?)<\/h1>/i);
  if (heading) return heading[1].replace(/<[^>]+>/g, "").trim();
  const titleTag = body.match(/<title[^>]*>(.*?)<\/title>/i);
  if (titleTag) return titleTag[1].trim();
  if (path === "/") return "Home";
  const last = path.split("/").filter(Boolean).pop() ?? "Untitled";
  return last.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface PageMatch {
  path: string;
  lines: { line: number; text: string }[];
  more: number;
}

const MATCH_CAP = 10;

export async function findInPages(app: PagesApp, patterns: RegExp[]): Promise<PageMatch[]> {
  if (patterns.length === 0) return [];
  const found: PageMatch[] = [];
  for (const summary of await listPages(app)) {
    const page = await getPage(app, summary.path);
    if (!page) continue;
    const hits = page.body
      .split("\n")
      .map((text, index) => ({ line: index + 1, text }))
      .filter((entry) => patterns.some((pattern) => pattern.test(entry.text)))
      .map((entry) => ({ line: entry.line, text: entry.text.trim().slice(0, 200) }));
    if (hits.length > 0)
      found.push({ path: page.path, lines: hits.slice(0, MATCH_CAP), more: Math.max(0, hits.length - MATCH_CAP) });
  }
  return found;
}

export interface PageSlice {
  page: Page;
  lines: { line: number; text: string }[];
  total: number;
  more: number;
}

const SLICE_CAP = 200;

// Reading a whole page to change one line of it costs the body twice, once in and once back out.
export function slicePage(page: Page, options: { find?: string; offset?: number; limit?: number }): PageSlice {
  const all = page.body.split("\n").map((text, index) => ({ line: index + 1, text }));
  const matched = options.find
    ? all.filter((entry) => entry.text.toLowerCase().includes(options.find!.toLowerCase()))
    : all.slice(Math.max(0, (options.offset ?? 1) - 1));
  const limit = Math.max(1, Math.min(options.limit ?? SLICE_CAP, SLICE_CAP));
  return { page, lines: matched.slice(0, limit), total: all.length, more: Math.max(0, matched.length - limit) };
}

export async function editPage(
  app: PagesApp,
  input: {
    path: string;
    find: string;
    replace: string;
    all: boolean;
    // Edits the working copy, starting one from the live page if there is none yet.
    draft?: boolean;
  },
): Promise<{ page: Page; replaced: number; lines: number[] }> {
  const path = normalizePath(input.path);
  const page = await getPage(app, path);
  if (!page) throw new EndpointError(400, noPageAt(path));
  if (input.find === "") throw new EndpointError(400, "find must not be empty");
  const source = input.draft ? workingCopy(page).body : page.body;

  const occurrences = source.split(input.find).length - 1;
  if (occurrences === 0)
    throw new EndpointError(
      400,
      `Nothing in ${path} matches that text exactly. Read the part you are editing with get_page, ` +
        `passing find or offset and limit, and copy the snippet from what it returns.`,
    );
  if (occurrences > 1 && !input.all)
    throw new EndpointError(
      400,
      `That text appears ${occurrences} times in ${path}. Pass a longer snippet that appears once, ` +
        `or all: true to replace every occurrence.`,
    );

  const body = input.all ? source.split(input.find).join(input.replace) : source.replace(input.find, input.replace);
  const lines: number[] = [];
  let cursor = 0;
  for (let n = 0; n < (input.all ? occurrences : 1); n++) {
    const at = source.indexOf(input.find, cursor);
    lines.push(source.slice(0, at).split("\n").length);
    cursor = at + input.find.length;
  }

  const saved = input.draft
    ? await saveDraft(app, path, { body })
    : await savePage(app, { path, contentType: page.contentType, title: page.title, body });
  return { page: saved, replaced: input.all ? occurrences : 1, lines };
}

// The working copy as it stands, or the live page when none has been started, which is what the
// first draft edit starts from.
export function workingCopy(page: Page): PageDraft {
  return (
    page.draft ?? {
      contentType: page.contentType,
      title: page.title,
      body: page.body,
      meta: page.meta,
      updatedAt: page.updatedAt,
    }
  );
}

// What a preview renders: the page with its working copy in place of the live fields.
export function previewOf(page: Page): Page {
  const { contentType, title, body, meta, updatedAt } = workingCopy(page);
  return { ...page, contentType, title, body, meta, updatedAt };
}

export async function saveDraft(
  app: PagesApp,
  path: string,
  fields: Partial<Omit<PageDraft, "updatedAt">>,
): Promise<Page> {
  const normalized = normalizePath(path);
  const page = await getPage(app, normalized);
  if (!page)
    throw new EndpointError(
      400,
      `${noPageAt(normalized)}. A working copy is kept for a published page; publish_page it first.`,
    );
  const next: Page = { ...page, draft: { ...workingCopy(page), ...fields, updatedAt: Date.now() } };
  await writePageFile(app, next);
  return next;
}

export async function publishDraft(app: PagesApp, path: string): Promise<Page> {
  const normalized = normalizePath(path);
  const page = await getPage(app, normalized);
  if (!page) throw new EndpointError(400, noPageAt(normalized));
  if (!page.draft)
    throw new EndpointError(
      400,
      `${normalized} has no working copy to publish. Its live page is already what readers see.`,
    );
  const { contentType, title, body, meta } = page.draft;
  const next: Page = { ...page, contentType, title, body, meta, draft: null, updatedAt: Date.now() };
  await writePageFile(app, next);
  return next;
}

export async function discardDraft(app: PagesApp, path: string): Promise<boolean> {
  const normalized = normalizePath(path);
  const page = await getPage(app, normalized);
  if (!page) throw new EndpointError(400, noPageAt(normalized));
  if (!page.draft) return false;
  await writePageFile(app, { ...page, draft: null });
  return true;
}
