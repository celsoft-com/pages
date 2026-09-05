import { getSettings, SETTING } from "../settings";
import { renderMarkdown } from "../render/markdown";
import { escapeHtml, layout, type NavItem } from "../render/theme";
import type { Env, Page } from "../types";
import { normalizePath } from "./path";
import { getPage, listPages } from "./service";

const RENDER_CACHE_TTL = 60 * 60 * 24 * 7;

async function siteChrome(env: Env) {
  const [settings, pages] = await Promise.all([getSettings(env), listPages(env)]);
  const nav: NavItem[] = pages
    .filter((p) => p.path !== "/" && p.path.split("/").length === 2)
    .slice(0, 8)
    .map((p) => ({ path: p.path, title: p.title }));
  return {
    siteTitle: settings[SETTING.siteTitle] || "Pages",
    siteDescription: settings[SETTING.siteDescription] || undefined,
    nav,
    pages,
  };
}

async function renderPage(env: Env, page: Page): Promise<string> {
  const cacheKey = `render:${page.path}:${page.updated_at}`;
  const cached = await env.CACHE_KV.get(cacheKey);
  if (cached) return cached;

  const chrome = await siteChrome(env);
  const html = layout({
    title: page.title,
    siteTitle: chrome.siteTitle,
    siteDescription: chrome.siteDescription,
    nav: chrome.nav,
    currentPath: page.path,
    content: renderMarkdown(page.body),
  });
  await env.CACHE_KV.put(cacheKey, html, { expirationTtl: RENDER_CACHE_TTL });
  return html;
}

async function renderIndex(env: Env): Promise<string> {
  const chrome = await siteChrome(env);
  const items = chrome.pages.filter((p) => p.path !== "/");
  const content = items.length
    ? `<ul class="index">${items
        .map(
          (p) =>
            `<li><a href="${escapeHtml(p.path)}">${escapeHtml(p.title)}</a><span>${escapeHtml(
              p.path,
            )}</span></li>`,
        )
        .join("")}</ul>`
    : `<p>No pages published yet. Connect Claude to this site's MCP endpoint and ask it to publish one.</p>`;

  return layout({
    title: chrome.siteTitle,
    siteTitle: chrome.siteTitle,
    siteDescription: chrome.siteDescription,
    nav: chrome.nav,
    currentPath: "/",
    content,
  });
}

async function renderNotFound(env: Env, path: string): Promise<string> {
  const chrome = await siteChrome(env);
  return layout({
    title: "Not found",
    siteTitle: chrome.siteTitle,
    siteDescription: chrome.siteDescription,
    nav: chrome.nav,
    currentPath: path,
    content: `<h1>Not found</h1><p>Nothing is published at <code>${escapeHtml(path)}</code>.</p>`,
  });
}

export async function handlePage(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);
  const page = await getPage(env, path);

  if (!page) {
    if (path === "/") {
      return new Response(await renderIndex(env), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" },
      });
    }
    return new Response(await renderNotFound(env, path), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  if (page.content_type === "html") {
    return new Response(page.body, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=60",
        etag: `"${page.updated_at}"`,
      },
    });
  }

  return new Response(await renderPage(env, page), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=60",
      etag: `"${page.updated_at}"`,
    },
  });
}
