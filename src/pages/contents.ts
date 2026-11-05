import { escapeHtml, layout } from "../render/theme";
import type { Chrome } from "../render/chrome";
import type { PageSummary } from "../types";
import { ROOT_BUNDLE } from "./path";

// Without a home page of its own, the site root is a directory of its top-level pages. The server
// renders the public ones only: the response is one cached copy for every visitor, so it can never
// depend on who is asking. The browser then asks DIRECTORY_API which entries this viewer may open
// and adds the private ones, so a signed-in owner or a link holder sees their pages and a stranger
// never sees a page they would get a 404 on.
export const DIRECTORY_API = "/api/public/directory";

// A page at / or /root is a stored resource nothing serves: / is the directory itself, and /root
// redirects to it. Listing either would be a link back to this page.
export function listable(pages: PageSummary[]): PageSummary[] {
  return pages.filter((page) => page.path !== "/" && page.path !== ROOT_BUNDLE);
}

// The pages no other page sits above, at whatever depth: /tutorial when it exists, and otherwise each
// /tutorial/x, so a page is never reachable only through a parent that is not there.
// Pages under /root are the home page's own chrome and templates, never addresses to list, whether
// or not a home page is stored above them.
const inHomeBundle = (path: string) => path.startsWith(`${ROOT_BUNDLE}/`);

export function topLevel(pages: PageSummary[]): PageSummary[] {
  const listed = listable(pages).filter((page) => !inHomeBundle(page.path));
  const paths = new Set(listed.map((page) => page.path));
  return listed.filter((page) => {
    const segments = page.path.split("/").filter(Boolean);
    return !segments.slice(0, -1).some((_, i) => paths.has(`/${segments.slice(0, i + 1).join("/")}`));
  });
}

const entry = (page: { path: string; title: string }) =>
  `<li data-path="${escapeHtml(page.path)}"><a href="/p${escapeHtml(page.path)}">${escapeHtml(page.title)}</a>` +
  `<span>${escapeHtml(page.path)}</span></li>`;

// Adds, in path order, each entry the viewer may open that the public list left out, marked private.
const ADD_PRIVATE = `<script>
(async () => {
  const list = document.querySelector("ul.index");
  let pages;
  try {
    const res = await fetch(${JSON.stringify(DIRECTORY_API)}, { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return;
    ({ pages } = await res.json());
  } catch { return; }
  const shown = new Set([...list.children].map((li) => li.dataset.path));
  for (const page of pages) {
    if (shown.has(page.path)) continue;
    const li = document.createElement("li");
    li.dataset.path = page.path;
    const a = document.createElement("a");
    a.href = "/p" + page.path;
    a.textContent = page.title;
    const span = document.createElement("span");
    span.textContent = page.path + (page.private ? " · private" : "");
    li.append(a, span);
    const after = [...list.children].find((other) => other.dataset.path > page.path);
    list.insertBefore(li, after ?? null);
  }
  if (list.children.length) {
    list.hidden = false;
    document.querySelector("p.empty")?.remove();
  }
})();
</script>`;

export function contentsHtml(input: { chrome: Chrome; pages: PageSummary[] }): string {
  const list =
    `<ul class="index"${input.pages.length ? "" : " hidden"}>${input.pages.map(entry).join("")}</ul>` +
    (input.pages.length ? "" : `<p class="empty">Nothing is published yet.</p>`);

  return layout({
    title: input.chrome.site.title,
    chrome: input.chrome,
    content: `<h1>Contents</h1>${list}${ADD_PRIVATE}`,
  });
}
