export interface NavItem {
  path: string;
  title: string;
}

export interface LayoutOptions {
  title: string;
  siteTitle: string;
  siteDescription?: string;
  nav: NavItem[];
  currentPath: string;
  content: string;
}

const STYLES = `
:root {
  color-scheme: light dark;
  --bg: #fdfdfc;
  --fg: #1c1c1a;
  --muted: #6b6b66;
  --rule: #e4e4e0;
  --accent: #2f5fd0;
  --code-bg: #f2f2ee;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16161a;
    --fg: #e8e8e4;
    --muted: #9a9a94;
    --rule: #2c2c32;
    --accent: #8fb0ff;
    --code-bg: #21212a;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 46rem; margin: 0 auto; padding: 2.5rem 1.25rem 5rem; }
header.site { border-bottom: 1px solid var(--rule); padding-bottom: 1rem; margin-bottom: 2.5rem; }
header.site a.brand { font-weight: 620; font-size: 1.05rem; color: var(--fg); text-decoration: none; }
header.site p { margin: .35rem 0 0; color: var(--muted); font-size: .9rem; }
nav.site { margin-top: .9rem; display: flex; flex-wrap: wrap; gap: .9rem; }
nav.site a { color: var(--muted); text-decoration: none; font-size: .9rem; }
nav.site a:hover, nav.site a[aria-current] { color: var(--accent); }
main h1, main h2, main h3 { line-height: 1.25; margin: 2rem 0 .75rem; }
main h1 { font-size: 1.9rem; margin-top: 0; }
main h2 { font-size: 1.35rem; }
main h3 { font-size: 1.1rem; }
main p, main ul, main ol, main blockquote { margin: 0 0 1.1rem; }
main a { color: var(--accent); }
main img { max-width: 100%; height: auto; border-radius: 6px; }
main pre {
  background: var(--code-bg);
  padding: .9rem 1rem;
  border-radius: 8px;
  overflow-x: auto;
  font-size: .875rem;
}
main code { background: var(--code-bg); padding: .12em .35em; border-radius: 4px; font-size: .9em; }
main pre code { background: none; padding: 0; }
main blockquote {
  border-left: 3px solid var(--rule);
  margin-left: 0;
  padding-left: 1rem;
  color: var(--muted);
}
main table { width: 100%; border-collapse: collapse; margin-bottom: 1.1rem; display: block; overflow-x: auto; }
main th, main td { border: 1px solid var(--rule); padding: .5rem .65rem; text-align: left; }
ul.index { list-style: none; padding: 0; }
ul.index li { padding: .7rem 0; border-bottom: 1px solid var(--rule); }
ul.index a { font-weight: 560; text-decoration: none; }
ul.index span { display: block; color: var(--muted); font-size: .85rem; }
footer.site { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--rule); color: var(--muted); font-size: .8rem; }
`;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function layout(options: LayoutOptions): string {
  const nav = options.nav
    .map(
      (item) =>
        `<a href="${escapeHtml(item.path)}"${
          item.path === options.currentPath ? ' aria-current="page"' : ""
        }>${escapeHtml(item.title)}</a>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
${options.siteDescription ? `<meta name="description" content="${escapeHtml(options.siteDescription)}">` : ""}
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
<header class="site">
<a class="brand" href="/">${escapeHtml(options.siteTitle)}</a>
${options.siteDescription ? `<p>${escapeHtml(options.siteDescription)}</p>` : ""}
${nav ? `<nav class="site">${nav}</nav>` : ""}
</header>
<main>${options.content}</main>
<footer class="site">Published with <a href="https://github.com/seanodell/pages">pages</a></footer>
</div>
</body>
</html>`;
}
