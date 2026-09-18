import { escapeHtml, layout } from "../render/theme";
import type { PageSummary } from "../types";
import { ROOT_BUNDLE } from "./path";

// The site root is a list of what is published, not a page somebody wrote. It lists public pages
// only: showing a private one to whoever holds its share link would make this response vary by
// cookie, and it is a public response, durable at the edge, so the next visitor would get their
// copy of it. A link holder reaches their page by the link, which is the whole of how that works.

// A page at / or /root is a stored resource nothing serves: / is the contents itself, and /root
// redirects to it. Listing either would be a link back to this page.
export function listable(pages: PageSummary[]): PageSummary[] {
  return pages.filter((page) => page.path !== "/" && page.path !== ROOT_BUNDLE);
}

export function contentsHtml(input: {
  siteTitle: string;
  siteDescription?: string;
  pages: PageSummary[];
}): string {
  const list = input.pages.length
    ? `<ul class="index">${input.pages
        .map(
          (page) =>
            `<li><a href="${escapeHtml(page.path)}">${escapeHtml(page.title)}</a>` +
            `<span>${escapeHtml(page.path)}</span></li>`,
        )
        .join("")}</ul>`
    : "<p>Nothing is published yet.</p>";

  return layout({
    title: input.siteTitle,
    siteTitle: input.siteTitle,
    siteDescription: input.siteDescription,
    content: `<h1>Contents</h1>${list}`,
  });
}

// A browser asks again whenever the cache says to, so the tag has to change when the list does:
// a page published, unpublished, renamed or made private all move one of these two numbers.
export function contentsEtag(pages: PageSummary[]): string {
  return `${pages.length}-${pages.reduce((latest, page) => Math.max(latest, page.updatedAt), 0)}`;
}
