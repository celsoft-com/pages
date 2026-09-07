import { contentHeaders, privateHeaders } from "../cache";
import { accessTo, type Access } from "../private/gate";
import { UNLOCK_HEAD } from "../private/unlock";
import { renderMarkdown } from "../render/markdown";
import { escapeHtml, layout } from "../render/theme";
import { getSettings } from "../settings";
import type { Page } from "../types";
import { ROOT_BUNDLE, normalizePath } from "./path";
import { getPage } from "./service";

function html(body: string, access: Access, etag: string): Response {
  const headers: Record<string, string> = {
    "content-type": "text/html; charset=utf-8",
    ...(access.scope ? privateHeaders() : contentHeaders()),
    etag: `"${etag}"`,
  };
  if (access.cookie) headers["set-cookie"] = access.cookie;
  return new Response(body, { headers });
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

// The one answer for a path nobody may see, whether that is because nothing is published there or
// because it is private and this visitor holds no grant. Both cases return this exact document, so
// the 404 says nothing about whether the path exists. It also carries the unlock script, which is
// how a share link works at all: the fragment holding the token never reaches the server, so the
// script that reads it has to arrive in the response a stranger gets.
async function closed(path: string): Promise<Response> {
  const settings = await getSettings();
  const body = layout({
    title: "Not found",
    siteTitle: settings.title,
    siteDescription: settings.description || undefined,
    head: UNLOCK_HEAD,
    content: `<h1>Not found</h1><p>Nothing is published at <code>${escapeHtml(path)}</code>.</p>`,
  });
  return new Response(body, {
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8", ...privateHeaders() },
  });
}

export async function handlePage(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);

  // The home page lives in its own bundle and is served at /, so it has one URL, not two.
  if (path === ROOT_BUNDLE) return new Response(null, { status: 301, headers: { location: "/" } });

  // / serves the /root page and nothing else. A page stored at / is an ordinary resource nobody serves.
  const target = path === "/" ? ROOT_BUNDLE : path;

  // Before the page is read, so a stranger's request costs one blob read and reveals nothing.
  const access = await accessTo(request, target);
  if (!access.open) return closed(path);

  const page = await getPage(target);
  if (!page) return closed(path);

  if (page.contentType === "html") return html(page.body, access, String(page.updatedAt));
  return html(await renderPage(page), access, String(page.updatedAt));
}
