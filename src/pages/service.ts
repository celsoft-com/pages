import { encodeKey, stores } from "../store";
import type { ContentType, Page, PageSummary } from "../types";
import { normalizePath } from "./path";

export async function getPage(path: string): Promise<Page | null> {
  const stored = await stores.pages().get(encodeKey(normalizePath(path)), { type: "json" });
  return (stored as Page | null) ?? null;
}

// Bumped whenever PageSummary gains a field. Metadata written under an older number is not trusted
// or patched up: the blob is read and the summary derived, which is slower and always right.
const SUMMARY_VERSION = 1;

function summarize(page: Page): PageSummary & { v: number } {
  return {
    v: SUMMARY_VERSION,
    path: page.path,
    contentType: page.contentType,
    title: page.title,
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
      const page = (await stores.pages().get(blob.key, { type: "json" })) as Page | null;
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
}): Promise<Page> {
  const path = normalizePath(input.path);
  const existing = await getPage(path);
  const now = Date.now();
  const page: Page = {
    path,
    contentType: input.contentType,
    title: input.title,
    body: input.body,
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
}): Promise<{ page: Page; replaced: number; lines: number[] }> {
  const path = normalizePath(input.path);
  const page = await getPage(path);
  if (!page) throw new Error(`No page exists at ${path}`);
  if (input.find === "") throw new Error("find must not be empty");

  const occurrences = page.body.split(input.find).length - 1;
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

  const body = input.all ? page.body.split(input.find).join(input.replace) : page.body.replace(input.find, input.replace);
  const lines: number[] = [];
  let cursor = 0;
  for (let n = 0; n < (input.all ? occurrences : 1); n++) {
    const at = page.body.indexOf(input.find, cursor);
    lines.push(page.body.slice(0, at).split("\n").length);
    cursor = at + input.find.length;
  }

  const saved = await savePage({ path, contentType: page.contentType, title: page.title, body });
  return { page: saved, replaced: input.all ? occurrences : 1, lines };
}
