import { encodeKey, stores } from "../store";
import type { ContentType, Page, PageDraft, PageMeta, PageSummary } from "../types";
import { HOME_IS_AT_ROOT, HOME_IS_GENERATED, ROOT_BUNDLE, normalizePath } from "./path";

// What to say when a page is not there. At /root the answer is what / is serving instead.
export function noPageAt(path: string): string {
  return path === ROOT_BUNDLE ? HOME_IS_GENERATED : `No page exists at ${path}`;
}

// A blob written before a field existed still comes back carrying it. Every page read goes
// through here, listPages' fallback included, so a new field is defaulted once.
function hydratePage(stored: Page | null): Page | null {
  return stored ? { ...stored, meta: stored.meta ?? {}, draft: stored.draft ?? null } : null;
}

export async function getPage(path: string): Promise<Page | null> {
  const stored = await stores.pages().get(encodeKey(normalizePath(path)), { type: "json" });
  return hydratePage(stored as Page | null);
}

// path and title are fields of the page itself, and a second copy of either in meta would be two
// answers to one question. A key is also a CSS class and a template name, so it stays an identifier.
const META_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const PAGE_FIELDS = ["path", "title"];

export function validateMeta(raw: unknown): PageMeta {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new Error("meta must be an object of string values");
  const meta: PageMeta = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!META_KEY.test(key))
      throw new Error(`meta key "${key}" must start with a letter and hold only letters, digits, - and _`);
    if (PAGE_FIELDS.includes(key)) throw new Error(`meta cannot hold "${key}": it is a field of the page itself`);
    if (typeof value !== "string") throw new Error(`meta.${key} must be a string`);
    meta[key] = value;
  }
  return meta;
}

export function mergeMeta(existing: PageMeta, raw: unknown): PageMeta {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new Error("meta must be an object of string or null values");
  const entries = Object.entries(raw);
  const removed = entries.filter(([, value]) => value === null).map(([key]) => key);
  const set = validateMeta(Object.fromEntries(entries.filter(([, value]) => value !== null)));
  const merged = { ...existing, ...set };
  for (const key of removed) delete merged[key];
  return merged;
}

// Bumped whenever PageSummary gains a field. Metadata written under an older number is not trusted
// or patched up: the blob is read and the summary derived, which is slower and always right.
const SUMMARY_VERSION = 3;

function summarize(page: Page): PageSummary & { v: number } {
  return {
    v: SUMMARY_VERSION,
    path: page.path,
    contentType: page.contentType,
    title: page.title,
    meta: page.meta,
    hasDraft: page.draft !== null,
    updatedAt: page.updatedAt,
  };
}

// Netlify caps blob metadata at 2 KB and rejects the whole write past it, so a long title or a big
// refs map must not be able to fail a save. Over the limit the summary is simply not written, and a
// missing summary is a miss like any other: the blob is read.
const METADATA_LIMIT = 1800;

function metadataFor(summary: Record<string, unknown>): Record<string, unknown> | undefined {
  return JSON.stringify(summary).length <= METADATA_LIMIT ? summary : undefined;
}

// The only way a page blob is written, transfer.ts included. The summary rides along as metadata so
// listPages can answer without reading every page body, and it cannot drift from the blob because
// nothing else writes one.
export async function writePageBlob(key: string, page: Page): Promise<void> {
  await stores.pages().setJSON(key, page, { metadata: metadataFor({ ...summarize(page) }) });
}

export async function listPages(): Promise<PageSummary[]> {
  const { blobs } = await stores.pages().list();
  const summaries = await Promise.all(
    blobs.map(async (blob) => {
      const found = await stores.pages().getMetadata(blob.key);
      const summary = found?.metadata as unknown as (PageSummary & { v?: number }) | undefined;
      if (summary?.v === SUMMARY_VERSION) {
        const { v: _version, ...rest } = summary;
        return rest satisfies PageSummary;
      }
      const page = hydratePage((await stores.pages().get(blob.key, { type: "json" })) as Page | null);
      if (!page) return null;
      const { v: _v, ...rest } = summarize(page);
      return rest satisfies PageSummary;
    }),
  );
  return summaries.filter((p): p is PageSummary => p !== null).sort((a, b) => a.path.localeCompare(b.path));
}

export async function savePage(input: {
  path: string;
  contentType: ContentType;
  title: string;
  body: string;
  // Left out, the page keeps what it had: an edit to the body is not a decision about its meta.
  meta?: PageMeta;
}): Promise<Page> {
  const path = normalizePath(input.path);
  if (path === "/") throw new Error(HOME_IS_AT_ROOT);
  const existing = await getPage(path);
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
  await writePageBlob(encodeKey(path), page);
  return page;
}

export async function deletePage(path: string): Promise<boolean> {
  const normalized = normalizePath(path);
  if (!(await getPage(normalized))) return false;
  await stores.pages().delete(encodeKey(normalized));
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

export async function findInPages(patterns: RegExp[]): Promise<PageMatch[]> {
  if (patterns.length === 0) return [];
  const found: PageMatch[] = [];
  for (const summary of await listPages()) {
    const page = await getPage(summary.path);
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

export async function editPage(input: {
  path: string;
  find: string;
  replace: string;
  all: boolean;
  // Edits the working copy, starting one from the live page if there is none yet.
  draft?: boolean;
}): Promise<{ page: Page; replaced: number; lines: number[] }> {
  const path = normalizePath(input.path);
  const page = await getPage(path);
  if (!page) throw new Error(noPageAt(path));
  if (input.find === "") throw new Error("find must not be empty");
  const source = input.draft ? workingCopy(page).body : page.body;

  const occurrences = source.split(input.find).length - 1;
  if (occurrences === 0)
    throw new Error(
      `Nothing in ${path} matches that text exactly. Read the part you are editing with get_page, ` +
        `passing find or offset and limit, and copy the snippet from what it returns.`,
    );
  if (occurrences > 1 && !input.all)
    throw new Error(
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
    ? await saveDraft(path, { body })
    : await savePage({ path, contentType: page.contentType, title: page.title, body });
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
  path: string,
  fields: Partial<Omit<PageDraft, "updatedAt">>,
): Promise<Page> {
  const normalized = normalizePath(path);
  const page = await getPage(normalized);
  if (!page) throw new Error(`${noPageAt(normalized)}. A working copy is kept for a published page; publish_page it first.`);
  const next: Page = { ...page, draft: { ...workingCopy(page), ...fields, updatedAt: Date.now() } };
  await writePageBlob(encodeKey(normalized), next);
  return next;
}

export async function publishDraft(path: string): Promise<Page> {
  const normalized = normalizePath(path);
  const page = await getPage(normalized);
  if (!page) throw new Error(noPageAt(normalized));
  if (!page.draft) throw new Error(`${normalized} has no working copy to publish. Its live page is already what readers see.`);
  const { contentType, title, body, meta } = page.draft;
  const next: Page = { ...page, contentType, title, body, meta, draft: null, updatedAt: Date.now() };
  await writePageBlob(encodeKey(normalized), next);
  return next;
}

export async function discardDraft(path: string): Promise<boolean> {
  const normalized = normalizePath(path);
  const page = await getPage(normalized);
  if (!page) throw new Error(noPageAt(normalized));
  if (!page.draft) return false;
  await writePageBlob(encodeKey(normalized), { ...page, draft: null });
  return true;
}
