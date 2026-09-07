import { describeBuild } from "../build";
import { escapeHtml } from "../render/theme";

const STYLES = `
:root {
  color-scheme: light dark;
  --bg: #f6f6f4; --panel: #ffffff; --fg: #1b1b19; --muted: #6c6c66;
  --rule: #e2e2dd; --accent: #2f5fd0; --accent-fg: #ffffff;
  --ok: #1c7c4a; --warn: #9a6b12; --bad: #b23636; --code-bg: #f0f0ec;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #131317; --panel: #1c1c21; --fg: #e9e9e5; --muted: #9a9a94;
    --rule: #2c2c33; --accent: #7fa5ff; --accent-fg: #10131c;
    --ok: #62c48d; --warn: #d8ab4e; --bad: #f08a8a; --code-bg: #23232b;
  }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.confirm { display: inline; }
body { margin: 0; background: var(--bg); color: var(--fg);
  font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
.wrap { max-width: 54rem; margin: 0 auto; padding: 1.5rem 1.25rem 5rem; }
.narrow { max-width: 26rem; margin: 4rem auto; padding: 0 1.25rem; }
header.admin { display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap;
  border-bottom: 1px solid var(--rule); padding-bottom: .85rem; margin-bottom: 1.75rem; }
header.admin strong { font-size: 1rem; }
header.admin nav { display: flex; gap: 1rem; flex-wrap: wrap; margin-left: auto; }
header.admin nav a { color: var(--muted); text-decoration: none; font-size: .9rem; }
header.admin nav a[aria-current] , header.admin nav a:hover { color: var(--accent); }
h1 { font-size: 1.4rem; margin: 0 0 .35rem; }
h2 { font-size: 1.05rem; margin: 2rem 0 .6rem; }
p.lede { color: var(--muted); margin: 0 0 1.5rem; }
.panel { background: var(--panel); border: 1px solid var(--rule); border-radius: 10px;
  padding: 1.1rem 1.2rem; margin-bottom: 1.1rem; }
label { display: block; font-size: .85rem; font-weight: 560; margin: 0 0 .3rem; }
label .hint { display: block; font-weight: 400; color: var(--muted); margin-top: .15rem; }
input[type=text], input[type=password], input[type=file], select, textarea {
  width: 100%; padding: .55rem .65rem; font: inherit; color: var(--fg);
  background: var(--bg); border: 1px solid var(--rule); border-radius: 7px; }
textarea { min-height: 22rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .875rem; }
.field { margin-bottom: 1rem; }
button, .button { font: inherit; font-weight: 560; padding: .55rem 1rem; border-radius: 7px;
  border: 1px solid transparent; background: var(--accent); color: var(--accent-fg);
  cursor: pointer; text-decoration: none; display: inline-block; }
button.secondary, .button.secondary { background: transparent; color: var(--fg); border-color: var(--rule); }
button.danger, .button.danger { background: transparent; color: var(--bad); border-color: var(--rule); }
/* An armed control is the question, so it stops looking like the thing it was and reads as the
   commit it now is. */
button.armed, .button.armed { background: var(--bad); color: var(--panel); border-color: var(--bad); }
.row { display: flex; gap: .6rem; align-items: center; flex-wrap: wrap; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: .6rem .5rem; border-bottom: 1px solid var(--rule); vertical-align: top; }
th { font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
td.actions { text-align: right; white-space: nowrap; }
/* A table row gets one kind of control: a text action. Buttons in a narrow cell wrap into a
   ragged stack and read as three different sizes of the same thing. */
table button, table .button { padding: .32rem .7rem; font-size: .85rem; white-space: nowrap; }
button.link { background: transparent; border: 0; padding: 0; font-size: .85rem; font-weight: 500;
  color: var(--accent); text-decoration: underline; cursor: pointer; white-space: nowrap; }
a.link { font-size: .85rem; font-weight: 500; white-space: nowrap; }

code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85rem;
  background: var(--code-bg); padding: .12em .35em; border-radius: 4px; word-break: break-all; }
.notice { border-radius: 8px; padding: .7rem .9rem; margin-bottom: 1.1rem; font-size: .9rem;
  border: 1px solid var(--rule); background: var(--panel); }
.notice.ok { border-color: var(--ok); color: var(--ok); }
.notice.bad { border-color: var(--bad); color: var(--bad); }
.notice.warn { border-color: var(--warn); color: var(--warn); }
.pill { font-size: .75rem; padding: .15rem .5rem; border-radius: 99px; border: 1px solid var(--rule); color: var(--muted); }
.pill.ok { color: var(--ok); border-color: var(--ok); }
.pill.warn { color: var(--warn); border-color: var(--warn); }
.pill.bad { color: var(--bad); border-color: var(--bad); }
.chip { display: inline-flex; align-items: center; gap: .2rem; font-size: .8rem; color: var(--muted);
  padding: .1rem .25rem .1rem .55rem; border-radius: 99px; border: 1px solid var(--rule); }
.chip form { display: inline; }
.chip button { background: transparent; color: var(--muted); border: 0; padding: 0 .25rem;
  font-weight: 400; font-size: .8rem; line-height: 1; }
.chip button:hover { color: var(--bad); }
.muted { color: var(--muted); }
.small { font-size: .85rem; }
ol.steps { padding-left: 1.2rem; color: var(--muted); font-size: .9rem; }
ol.steps li { margin-bottom: .3rem; }
footer.build { margin-top: 2.5rem; padding-top: .85rem; border-top: 1px solid var(--rule);
  color: var(--muted); font-size: .78rem; }
`;

// The one press-to-arm swap for every screen: hide the control, show the question it stands in
// front of, and put the caret on it so a second press or a keyboard Enter commits. A screen that
// arrived already armed through the query has no control to swap back to, so its cancel link is
// left to navigate.
const CONFIRM_SCRIPT = `<script>document.addEventListener("click",function(e){
var arm=e.target.closest("a[data-arm]");
if(arm){e.preventDefault();var box=arm.closest(".confirm");arm.hidden=true;
var form=box.querySelector("form");form.hidden=false;form.querySelector("button").focus();return}
var cancel=e.target.closest("a[data-cancel]");
if(!cancel)return;
var back=cancel.closest(".confirm").querySelector("a[data-arm]");
if(!back)return;
e.preventDefault();cancel.closest("form").hidden=true;back.hidden=false});</script>`;

const NAV = [
  { href: "/admin", label: "Pages" },
  { href: "/admin/assets", label: "Assets" },
  { href: "/admin/data", label: "Data" },
  { href: "/admin/connections", label: "Connections" },
  { href: "/admin/settings", label: "Settings" },
];

export function page(options: {
  title: string;
  body: string;
  current?: string;
  chrome?: boolean;
  narrow?: boolean;
  head?: string;
}): Response {
  const nav = options.chrome === false
    ? ""
    : `<header class="admin"><strong>${escapeHtml(options.title)}</strong><nav>${NAV.map(
        (item) =>
          `<a href="${item.href}"${item.href === options.current ? ' aria-current="page"' : ""}>${item.label}</a>`,
      ).join("")}<a href="/" target="_blank" rel="noopener">View site &#8599;</a></nav></header>`;

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<link rel="icon" href="/favicon.ico">
<title>${escapeHtml(options.title)}</title>
<style>${STYLES}</style>
${options.head ?? ""}
</head><body>
<div class="${options.narrow ? "narrow" : "wrap"}">${nav}${options.body}${
    options.chrome === false ? "" : `<footer class="build">${escapeHtml(describeBuild())}</footer>`
  }</div>
${CONFIRM_SCRIPT}
</body></html>`;

  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

// A question the app asks itself. Both states are rendered here, in the same place in the row: the
// control, and the armed control saying what the press will do. Pressing swaps them in place, so
// the question is asked where the answer is given, nothing is drawn over the row being acted on,
// and nothing is reloaded to ask it. The swap is one delegated listener in `page`; the armed state
// also rides in the query as `?confirm=<token>` so the arm link works with no script at all, which
// is what keeps a delete from going through unasked, and lets a test read either state.
export function confirmAction(input: {
  here: string;
  token: string;
  armed: string | null;
  action: string;
  fields: Record<string, string>;
  label: string;
  confirm: string;
  cancel?: string;
  className?: string;
}): string {
  const { here, token, armed, action, fields, label, confirm } = input;

  const hidden = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`)
    .join("");

  const arm = `<a class="button ${input.className ?? "danger"}" href="${escapeHtml(
    withConfirm(here, token),
  )}" data-arm>${escapeHtml(label)}</a>`;

  const question = `<form method="post" action="${action}" style="display:inline"${
    armed === token ? "" : " hidden"
  }>${hidden}
<button class="danger armed" type="submit">${escapeHtml(confirm)}</button>
<a class="link" href="${escapeHtml(withConfirm(here, null))}" style="margin-left:.6rem" data-cancel>${escapeHtml(
    input.cancel ?? "Cancel",
  )}</a></form>`;

  return `<span class="confirm">${armed === token ? "" : arm}${question}</span>`;
}

// Merged into whatever query the screen already carries, and its fragment kept, so an armed
// control on the page editor comes back to the panel it sits in.
function withConfirm(here: string, token: string | null): string {
  const url = new URL(here, "https://admin.invalid");
  if (token) url.searchParams.set("confirm", token);
  else url.searchParams.delete("confirm");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function notice(kind: "ok" | "bad" | "warn", message: string): string {
  return `<div class="notice ${kind}">${escapeHtml(message)}</div>`;
}

export function redirect(location: string, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 303, headers: { location, ...headers } });
}

export { escapeHtml };
