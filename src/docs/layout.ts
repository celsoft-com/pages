import { describeBuild } from "../build";
import { escapeHtml } from "../render/theme";

// The docs have their own chrome rather than the site theme or the admin's: the themed layout is
// the owner's site and reads their title and description, and this is the software's own reference,
// the same on every deploy. It is the one screen here with a sidebar, because a reference is read
// by jumping between its sections rather than from the top.
const STYLES = `
:root {
  color-scheme: light dark;
  --bg: #fdfdfc; --panel: #ffffff; --fg: #1c1c1a; --muted: #6b6b66;
  --rule: #e4e4e0; --accent: #2f5fd0; --code-bg: #f2f2ee; --read: #1c7c4a; --write: #9a6b12;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16161a; --panel: #1c1c21; --fg: #e8e8e4; --muted: #9a9a94;
    --rule: #2c2c32; --accent: #8fb0ff; --code-bg: #21212a; --read: #62c48d; --write: #d8ab4e;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.shell { display: flex; align-items: flex-start; gap: 2.5rem; max-width: 74rem; margin: 0 auto; padding: 0 1.25rem; }
nav.docs {
  width: 15rem; flex: none; position: sticky; top: 0; align-self: flex-start;
  max-height: 100vh; overflow-y: auto; padding: 2rem 0 3rem;
}
nav.docs a.brand { display: block; font-weight: 620; color: var(--fg); text-decoration: none; margin-bottom: 1.25rem; }
nav.docs ul { list-style: none; margin: 0; padding: 0; }
nav.docs li { margin: 0; }
nav.docs a { display: block; padding: .25rem 0; color: var(--muted); text-decoration: none; font-size: .92rem; }
nav.docs a:hover { color: var(--accent); }
nav.docs a[aria-current] { color: var(--accent); font-weight: 560; }
nav.docs ul ul a { padding-left: .9rem; font-size: .88rem; }
nav.docs .out { margin-top: 1.5rem; border-top: 1px solid var(--rule); padding-top: .75rem; }
main.docs { flex: 1; min-width: 0; max-width: 48rem; padding: 2rem 0 5rem; }
main.docs h1 { font-size: 1.9rem; line-height: 1.2; margin: 0 0 .6rem; }
main.docs h2 { font-size: 1.3rem; margin: 2.4rem 0 .7rem; padding-top: .4rem; }
main.docs h3 { font-size: 1.05rem; margin: 2rem 0 .5rem; }
main.docs h4 { font-size: .9rem; margin: 1.3rem 0 .4rem; color: var(--muted); font-weight: 560; }
main.docs p, main.docs ul, main.docs ol { margin: 0 0 1.1rem; }
main.docs a { color: var(--accent); }
main.docs img { max-width: 100%; height: auto; }
main.docs pre {
  background: var(--code-bg); padding: .9rem 1rem; border-radius: 8px; overflow-x: auto;
  font-size: .85rem; line-height: 1.55;
}
main.docs code { background: var(--code-bg); padding: .12em .35em; border-radius: 4px; font-size: .88em;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
main.docs pre code { background: none; padding: 0; }
main.docs blockquote { border-left: 3px solid var(--rule); margin-left: 0; padding-left: 1rem; color: var(--muted); }
table { width: 100%; border-collapse: collapse; margin: 0 0 1.2rem; font-size: .9rem; }
th, td { text-align: left; padding: .45rem .55rem; border-bottom: 1px solid var(--rule); vertical-align: top; }
th { font-size: .74rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); font-weight: 560; }
td.name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85rem; white-space: nowrap; }
td.type { color: var(--muted); font-size: .82rem; white-space: nowrap; }
td.need { color: var(--muted); font-size: .82rem; white-space: nowrap; }
.tool { border-top: 1px solid var(--rule); padding-top: 1.6rem; margin-top: 2.4rem; }
.tool h2 { margin-top: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 1.15rem; }
.tool h2 a { color: inherit; text-decoration: none; }
.pill { font-size: .72rem; padding: .1rem .5rem; border-radius: 99px; border: 1px solid var(--rule);
  color: var(--muted); vertical-align: middle; margin-left: .5rem; font-family: inherit; font-weight: 500; }
.pill.read { color: var(--read); border-color: var(--read); }
.pill.write { color: var(--write); border-color: var(--write); }
.endpoint { color: var(--muted); font-size: .85rem; margin: 0 0 1rem; }
/* One call, two transports, switched in place. Radios rather than script, so the tabs work with
   nothing running; the script only keeps every set on the page in step with the last one touched. */
.calls { margin: 0 0 1.2rem; }
.calls input { position: absolute; opacity: 0; width: 0; height: 0; }
.calls label {
  display: inline-block; padding: .3rem .1rem; margin-right: 1.1rem; cursor: pointer;
  font-size: .85rem; font-weight: 560; color: var(--muted); border-bottom: 2px solid transparent;
}
.calls input:checked + label { color: var(--fg); border-bottom-color: var(--accent); }
.calls input:focus-visible + label { outline: 2px solid var(--accent); outline-offset: 2px; }
.calls .call { display: none; margin-top: .6rem; }
.calls input.mcp:checked ~ .call.mcp { display: block; }
.calls input.rest:checked ~ .call.rest { display: block; }
ul.tools { list-style: none; padding: 0; }
ul.tools li { padding: .45rem 0; border-bottom: 1px solid var(--rule); display: flex; gap: .75rem; align-items: baseline; }
ul.tools a { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85rem; text-decoration: none; }
ul.tools span { color: var(--muted); font-size: .85rem; }
footer.docs { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--rule); color: var(--muted); font-size: .8rem; }
@media (max-width: 55rem) {
  .shell { display: block; padding: 0 1rem; }
  nav.docs { width: auto; position: static; max-height: none; padding: 1.5rem 0 .5rem; border-bottom: 1px solid var(--rule); }
  nav.docs ul { display: flex; flex-wrap: wrap; gap: 0 1rem; }
  nav.docs ul ul { width: 100%; }
  nav.docs ul ul a { padding-left: 0; }
  main.docs { padding-top: 1.5rem; }
}
`;

export interface NavItem {
  href: string;
  label: string;
  children?: NavItem[];
}

function navHtml(items: NavItem[], here: string): string {
  const entry = (item: NavItem): string =>
    `<li><a href="${item.href}"${item.href === here ? ' aria-current="page"' : ""}>${escapeHtml(item.label)}</a>${
      item.children ? `<ul>${item.children.map(entry).join("")}</ul>` : ""
    }</li>`;
  return `<ul>${items.map(entry).join("")}</ul>`;
}

// The tabs are radios and already work without this. It exists so that choosing REST on one call
// chooses it on every call down the page, rather than fourteen times on the way down.
const TABS_SCRIPT = `<script>document.addEventListener("change",function(e){
var picked=e.target;if(!picked.matches(".calls input"))return;
var which=picked.classList.contains("rest")?"rest":"mcp";
document.querySelectorAll(".calls input."+which).forEach(function(input){input.checked=true})});</script>`;

export function docsLayout(options: { title: string; here: string; nav: NavItem[]; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.ico">
<title>${escapeHtml(options.title)} · pages docs</title>
<style>${STYLES}</style>
</head>
<body>
<div class="shell">
<nav class="docs">
<a class="brand" href="/docs">pages documentation</a>
${navHtml(options.nav, options.here)}
<div class="out"><ul><li><a href="/">View site</a></li><li><a href="/admin">Admin</a></li></ul></div>
</nav>
<main class="docs">
${options.body}
<footer class="docs">Generated from this deploy's own code. ${escapeHtml(describeBuild())}</footer>
</main>
</div>
${TABS_SCRIPT}
</body>
</html>`;
}
