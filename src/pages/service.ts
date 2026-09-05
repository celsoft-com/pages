import type { ContentType, Env, Page } from "../types";
import { normalizePath } from "./path";

export async function getPage(env: Env, path: string): Promise<Page | null> {
  return env.DB.prepare("SELECT * FROM pages WHERE path = ?")
    .bind(normalizePath(path))
    .first<Page>();
}

export async function listPages(env: Env): Promise<Page[]> {
  const { results } = await env.DB.prepare(
    "SELECT path, owner_id, content_type, title, '' AS body, created_at, updated_at FROM pages ORDER BY path",
  ).all<Page>();
  return results;
}

export async function savePage(
  env: Env,
  input: {
    path: string;
    ownerId: string;
    contentType: ContentType;
    title: string;
    body: string;
  },
): Promise<Page> {
  const path = normalizePath(input.path);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO pages (path, owner_id, content_type, title, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       content_type = excluded.content_type,
       title = excluded.title,
       body = excluded.body,
       updated_at = excluded.updated_at`,
  )
    .bind(path, input.ownerId, input.contentType, input.title, input.body, now, now)
    .run();
  const page = await getPage(env, path);
  if (!page) throw new Error(`page write failed for ${path}`);
  return page;
}

export async function deletePage(env: Env, path: string): Promise<boolean> {
  const result = await env.DB.prepare("DELETE FROM pages WHERE path = ?")
    .bind(normalizePath(path))
    .run();
  return (result.meta.changes ?? 0) > 0;
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
