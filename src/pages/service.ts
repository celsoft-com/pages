import { decodeKey, encodeKey, stores } from "../store";
import type { ContentType, Page, PageSummary } from "../types";
import { ROOT_BUNDLE, normalizePath } from "./path";

export async function getPage(path: string): Promise<Page | null> {
  const stored = await stores.pages().get(encodeKey(normalizePath(path)), { type: "json" });
  return (stored as Page | null) ?? null;
}

export async function listPages(): Promise<PageSummary[]> {
  const { blobs } = await stores.pages().list();
  const summaries = await Promise.all(
    blobs.map(async (blob) => {
      const page = (await stores.pages().get(blob.key, { type: "json" })) as Page | null;
      if (!page) return null;
      return {
        path: page.path,
        contentType: page.contentType,
        title: page.title,
        updatedAt: page.updatedAt,
      } satisfies PageSummary;
    }),
  );
  return summaries.filter((p): p is PageSummary => p !== null).sort((a, b) => a.path.localeCompare(b.path));
}

// Ownership needs page paths, not pages. Blob keys already encode the path, so this is one
// list() rather than the one GET per page that listPages costs.
export async function pagePaths(): Promise<string[]> {
  const { blobs } = await stores.pages().list();
  return blobs.map((blob) => decodeKey(blob.key));
}

export async function savePage(input: {
  path: string;
  contentType: ContentType;
  title: string;
  body: string;
}): Promise<Page> {
  const path = normalizePath(input.path);
  if (path === "/")
    throw new Error(
      `/ is not a page path: it would sit above every bundle on the site. Publish the home page at ${ROOT_BUNDLE}, ` +
        `which is served at /.`,
    );
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
  await stores.pages().setJSON(encodeKey(path), page);
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
