import { renderMarkdown } from "../render/markdown";
import { escapeHtml, layout, type NavItem } from "../render/theme";
import { getSettings } from "../settings";
import type { Page } from "../types";
import { ROOT_BUNDLE, normalizePath } from "./path";
import { getPage, listPages } from "./service";

async function chrome(currentPath: string) {
  const [settings, pages] = await Promise.all([getSettings(), listPages()]);
  const nav: NavItem[] = pages
    .filter((p) => p.path !== "/" && p.path !== ROOT_BUNDLE && p.path.split("/").length === 2)
    .slice(0, 8)
    .map((p) => ({ path: p.path, title: p.title }));
  return { settings, pages, nav, currentPath };
}

function html(body: string, status = 200, etag?: string): Response {
  const headers: Record<string, string> = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "public, max-age=60",
  };
  if (etag) headers.etag = `"${etag}"`;
  return new Response(body, { status, headers });
}

async function renderPage(page: Page): Promise<string> {
  const site = await chrome(page.path);
  return layout({
    title: page.title,
    siteTitle: site.settings.title,
    siteDescription: site.settings.description || undefined,
    nav: site.nav,
    currentPath: page.path,
    content: renderMarkdown(page.body),
  });
}

async function renderIndex(): Promise<string> {
  const site = await chrome("/");
  const items = site.pages.filter((p) => p.path !== "/" && p.path !== ROOT_BUNDLE);
  const content = items.length
    ? `<ul class="index">${items
        .map(
          (p) =>
            `<li><a href="${escapeHtml(p.path)}">${escapeHtml(p.title)}</a><span>${escapeHtml(
              p.path,
            )}</span></li>`,
        )
        .join("")}</ul>`
    : `<p>No pages published yet. Connect Claude to this site and ask it to publish one.</p>`;

  // Reached only when the /root bundle has no page, so say what would replace this listing.
  const hint = `<p class="muted">This listing stands in for a home page. Ask Claude to publish one at <code>${escapeHtml(
    ROOT_BUNDLE,
  )}</code> and it will be served here.</p>`;

  return layout({
    title: site.settings.title,
    siteTitle: site.settings.title,
    siteDescription: site.settings.description || undefined,
    nav: site.nav,
    currentPath: "/",
    content: content + hint,
  });
}

async function renderNotFound(path: string): Promise<string> {
  const site = await chrome(path);
  return layout({
    title: "Not found",
    siteTitle: site.settings.title,
    siteDescription: site.settings.description || undefined,
    nav: site.nav,
    currentPath: path,
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
    if (path === "/") return html(await renderIndex());
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
