import { contentHeaders } from "../cache";
import { renderMarkdown } from "../render/markdown";
import { escapeHtml, layout } from "../render/theme";
import { getSettings } from "../settings";
import type { Page } from "../types";
import { ROOT_BUNDLE, normalizePath } from "./path";
import { getPage } from "./service";

function html(body: string, status = 200, etag?: string): Response {
  const headers: Record<string, string> = {
    "content-type": "text/html; charset=utf-8",
    ...contentHeaders(),
  };
  if (etag) headers.etag = `"${etag}"`;
  return new Response(body, { status, headers });
}

async function renderPage(page: Page): Promise<string> {
  const settings = await getSettings();
  return layout({
    title: page.title,
    siteTitle: settings.title,
    siteDescription: settings.description || undefined,
    content: renderMarkdown(page.body),
  });
}

async function renderNotFound(path: string): Promise<string> {
  const settings = await getSettings();
  return layout({
    title: "Not found",
    siteTitle: settings.title,
    siteDescription: settings.description || undefined,
    content: `<h1>Not found</h1><p>Nothing is published at <code>${escapeHtml(path)}</code>.</p>`,
  });
}

export async function handlePage(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);

  // The home page lives in its own bundle and is served at /, so it has one URL, not two.
  if (path === ROOT_BUNDLE) return new Response(null, { status: 301, headers: { location: "/" } });

  // / serves the /root page and nothing else. A page stored at / is an ordinary resource nobody serves.
  const page = await getPage(path === "/" ? ROOT_BUNDLE : path);

  if (!page) {
    return new Response(await renderNotFound(path), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  if (page.contentType === "html") {
    return html(page.body, 200, String(page.updatedAt));
  }

  return html(await renderPage(page), 200, String(page.updatedAt));
}
