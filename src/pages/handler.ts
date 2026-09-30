import { contentHeaders, privateHeaders } from "../cache";
import { accessTo, accessToScope, type Access } from "../private/gate";
import { getPrivacy, privateScope } from "../private/service";
import { UNLOCK_HEAD } from "../private/unlock";
import { renderMarkdown } from "../render/markdown";
import { escapeHtml, layout } from "../render/theme";
import { loadChrome } from "../render/chrome";
import type { Page } from "../types";
import { contentsEtag, contentsHtml, listable } from "./contents";
import { ROOT_BUNDLE, normalizePath } from "./path";
import { getPage, listPages } from "./service";

function html(body: string, access: Access, etag: string): Response {
  const headers: Record<string, string> = {
    "content-type": "text/html; charset=utf-8",
    ...(access.scope ? privateHeaders() : contentHeaders()),
    etag: `"${etag}"`,
  };
  if (access.cookie) headers["set-cookie"] = access.cookie;
  return new Response(body, { headers });
}

// The one answer for a path nobody may see, whether that is because nothing is published there or
// because it is private and this visitor holds no grant. Both cases return this exact document, so
// the 404 says nothing about whether the path exists. It also carries the unlock script, which is
// how a share link works at all: the fragment holding the token never reaches the server, so the
// script that reads it has to arrive in the response a stranger gets.
async function closed(path: string): Promise<Response> {
  const body = layout({
    title: "Not found",
    chrome: await loadChrome(),
    head: UNLOCK_HEAD,
    content: `<h1>Not found</h1><p>Nothing is published at <code>${escapeHtml(path)}</code>.</p>`,
  });
  return new Response(body, {
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8", ...privateHeaders() },
  });
}

// A page stored at /root is the home page; without one, / is the contents of the site, generated on
// every request. Either is closed and opened through the /root scope: / itself can never be one,
// because a scope holds everything at or under its path and that would be the site.
async function home(request: Request): Promise<Response> {
  const privacy = await getPrivacy();
  const access = await accessToScope(request, privateScope(privacy, ROOT_BUNDLE));
  if (!access.open) return closed("/");

  const stored = await getPage(ROOT_BUNDLE);
  if (stored) return served(stored, access);

  const chrome = await loadChrome();
  const pages = listable(await listPages()).filter((page) => !privateScope(privacy, page.path));
  const body = contentsHtml({ chrome, pages });
  return html(body, access, `${contentsEtag(pages)}-${chrome.tag}`);
}

export async function handlePage(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);

  // The home page is served at /, so it has one URL, not two.
  if (path === ROOT_BUNDLE) return new Response(null, { status: 301, headers: { location: "/" } });

  if (path === "/") return home(request);

  // Before the page is read, so a stranger's request costs one blob read and reveals nothing.
  const access = await accessTo(request, path);
  if (!access.open) return closed(path);

  const page = await getPage(path);
  if (!page) return closed(path);
  return served(page, access);
}

async function served(page: Page, access: Access): Promise<Response> {
  if (page.contentType === "html") return html(page.body, access, String(page.updatedAt));
  const chrome = await loadChrome();
  const body = layout({ title: page.title, chrome, content: renderMarkdown(page.body) });
  return html(body, access, `${page.updatedAt}-${chrome.tag}`);
}
