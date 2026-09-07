import { assetUrlFor, deleteAsset, listAssets, putAsset } from "../assets/service";
import {
  deleteCollection,
  getCollection,
  isValidId,
  listCollections,
  normalizeCollectionPath,
  saveCollection,
} from "../data/service";
import { verifySecret } from "../auth/password";
import { checkRateLimit, clearFailures, clientBucket, recordFailure } from "../auth/ratelimit";
import { clearSessionCookie, createSessionCookie, getSessionOwner } from "../auth/session";
import { changePassword, completeSetup, getOwner, isSetupComplete } from "../auth/setup";
import { completeAuthorize, parseAuthorize } from "../oauth/server";
import { listGrants, revokeGrant } from "../oauth/store";
import { deletePage, deriveTitle, getPage, listPages, savePage } from "../pages/service";
import { isValidPath, normalizePath, ROOT_BUNDLE } from "../pages/path";
import { bundleContents } from "../inventory";
import {
  privacyChanges,
  restOfBundle,
  runTransfer,
  staleReferences,
  touchesHomePage,
  type Scope,
  type Transfer,
} from "../transfer";
import { getPrivacy, mintShare, privateScope, revokeShares, setPrivate, setPublic } from "../private/service";
import { getSettings, saveSettings } from "../settings";
import type { Item, Owner, PrivateScope } from "../types";
import { confirmAction, escapeHtml, notice, page, redirect } from "./ui";

function flash(url: URL): string {
  const ok = url.searchParams.get("ok");
  const bad = url.searchParams.get("error");
  if (ok) return notice("ok", ok);
  if (bad) return notice("bad", bad);
  return "";
}

// Merged into whatever query the path already carries, and any fragment kept: a caller passing
// /admin/pages/edit?path=%2Ftrip#access otherwise gets a second ? and a broken URL.
function back(path: string, params: Record<string, string>): Response {
  const url = new URL(path, "https://admin.invalid");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return redirect(`${url.pathname}${url.search}${url.hash}`);
}

// Where a form says to go when it is done. Anything not an admin path is ignored rather than
// followed: a redirect target taken from a request body is an open redirect if it is trusted.
function returnTo(raw: string | undefined): string {
  if (!raw || !raw.startsWith("/admin") || raw.startsWith("/admin//")) return "/admin";
  return raw;
}

async function form(request: Request): Promise<Record<string, string>> {
  const data = await request.formData();
  const out: Record<string, string> = {};
  for (const [key, value] of data.entries()) if (typeof value === "string") out[key] = value;
  return out;
}

// ---------- setup ----------

function setupScreen(error?: string): Response {
  return page({
    title: "Set up this site",
    chrome: false,
    narrow: true,
    body: `
<h1>Set up this site</h1>
<p class="lede">Pick an admin password. It protects this dashboard and authorizes Claude when you connect it.</p>
${error ? notice("bad", error) : ""}
<form method="post" class="panel">
  <input type="text" name="username" value="admin" autocomplete="username"
    readonly hidden aria-hidden="true" tabindex="-1" style="display:none">
  <div class="field">
    <label for="password">Admin password<span class="hint">At least 12 characters.</span></label>
    <input id="password" name="password" type="password" autocomplete="new-password" required minlength="12">
  </div>
  <div class="field">
    <label for="confirm">Confirm password</label>
    <input id="confirm" name="confirm" type="password" autocomplete="new-password" required minlength="12">
  </div>
  <button type="submit">Create site</button>
</form>`,
  });
}

async function handleSetup(request: Request): Promise<Response> {
  if (await isSetupComplete()) return redirect("/admin/login");
  if (request.method !== "POST") return setupScreen();

  const body = await form(request);
  if ((body.password ?? "").length < 12) return setupScreen("Password must be at least 12 characters.");
  if (body.password !== body.confirm) return setupScreen("Passwords do not match.");

  const { owner, recovery } = await completeSetup(body.password);
  const response = page({
    title: "Save your recovery code",
    chrome: false,
    narrow: true,
    body: `
<h1>Save your recovery code</h1>
<p class="lede">This is shown once. It is the only way back in if you forget your password.</p>
<div class="panel"><p class="mono" style="font-size:1.1rem">${escapeHtml(recovery)}</p></div>
<a class="button" href="/admin">I have saved it</a>`,
  });

  const headers = new Headers(response.headers);
  headers.append("set-cookie", await createSessionCookie(owner));
  return new Response(response.body, { headers });
}

// ---------- login ----------

function loginScreen(error?: string): Response {
  return page({
    title: "Sign in",
    chrome: false,
    narrow: true,
    body: `
<h1>Sign in</h1>
${error ? notice("bad", error) : ""}
<form method="post" class="panel">
  <input type="text" name="username" value="admin" autocomplete="username"
    readonly hidden aria-hidden="true" tabindex="-1" style="display:none">
  <div class="field">
    <label for="password">Admin password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
  </div>
  <button type="submit">Sign in</button>
</form>
<p class="small muted">Lost your password? Sign in with your recovery code, then set a new one in Settings.</p>`,
  });
}

async function handleLogin(request: Request, next: string): Promise<Response> {
  if (!(await isSetupComplete())) return redirect("/admin/setup");
  if (request.method !== "POST") return loginScreen();

  const bucket = clientBucket(request);
  if (!(await checkRateLimit(bucket)))
    return loginScreen("Too many attempts. Try again in fifteen minutes.");

  const body = await form(request);
  const owner = await getOwner();
  if (!owner) return redirect("/admin/setup");

  const okPassword = await verifySecret(body.password ?? "", owner.passwordHash, owner.passwordSalt);
  const okRecovery = okPassword
    ? false
    : await verifySecret((body.password ?? "").trim().toUpperCase(), owner.recoveryHash, owner.recoverySalt);

  if (!okPassword && !okRecovery) {
    await recordFailure(bucket);
    return loginScreen("Incorrect password.");
  }

  await clearFailures(bucket);
  return redirect(
    okRecovery ? "/admin/settings?ok=Signed+in+with+recovery+code.+Set+a+new+password." : next,
    { "set-cookie": await createSessionCookie(owner) },
  );
}

// ---------- pages ----------

function checklist(steps: { done: boolean; title: string; body: string }[]): string {
  if (steps.every((step) => step.done)) return "";
  return `<div class="panel">
<h2 style="margin-top:0">Getting started</h2>
<ol class="steps" style="color:inherit">${steps
    .map(
      (step) =>
        `<li style="margin-bottom:.7rem${step.done ? ";opacity:.5" : ""}">
<strong>${step.done ? "&#10003; " : ""}${escapeHtml(step.title)}</strong>
<div class="small muted">${step.body}</div></li>`,
    )
    .join("")}</ol></div>`;
}

function when(at: number | undefined): string {
  return at ? new Date(at).toISOString().slice(0, 10) : "never";
}

// Privacy is a property of the page's own path, so it lives in the page's row. A scope covers
// everything at or under its path, so a page inside another page's private path says so and offers
// no control of its own: privacy does not nest, and two switches for one state is how an owner
// ends up believing something is closed when it is not.
// One line, one text action. A page's row says what the state is and links to the screen that
// changes it; three buttons in a narrow cell wrap into a stack and read as clutter, and the
// management they offered is all on that screen anyway.
// A page's access is managed in its editor, alongside its content. A private path with no page
// has no editor, so it gets its own screen.
function manageHref(path: string, hasPage: boolean): string {
  return hasPage
    ? `/admin/pages/edit?path=${encodeURIComponent(path)}#access`
    : `/admin/pages/access?path=${encodeURIComponent(path)}`;
}

function accessCell(
  path: string,
  own: PrivateScope | undefined,
  covering: PrivateScope | null,
  hasPage: boolean,
): string {
  if (covering)
    return `<span class="pill warn">Private</span>
<span class="small muted">via <span class="mono">${escapeHtml(covering.path)}</span></span>`;

  if (!own)
    return `<form method="post" action="/admin/pages/private" class="row" style="gap:.5rem">
<input type="hidden" name="path" value="${escapeHtml(path)}">
<input type="hidden" name="return" value="/admin">
<span class="pill">Public</span>
<button class="link" type="submit">Make private</button></form>`;

  const count = own.shares.length;
  return `<div class="row" style="gap:.5rem">
<span class="pill warn">Private</span>
<a class="link" href="${manageHref(own.path, hasPage)}">${
    count === 0 ? "Add a link" : `${count} link${count === 1 ? "" : "s"}`
  }</a></div>${
    count === 0
      ? '<div class="small muted">Nobody can reach it.</div>'
      : `<div class="small muted">${own.shares.map((share) => escapeHtml(share.label)).join(", ")}</div>`
  }`;
}

async function pagesScreen(url: URL): Promise<Response> {
  const [pages, grants, privacy] = await Promise.all([listPages(), listGrants(), getPrivacy()]);
  const origin = `${url.protocol}//${url.host}`;
  const armed = url.searchParams.get("confirm");

  const guide = checklist([
    {
      done: grants.length > 0,
      title: "Connect Claude",
      body: `Add a custom connector in Claude pointing at <code>${escapeHtml(origin)}/mcp</code>, then sign in with your admin password. <a href="/admin/connections">Connections</a>`,
    },
    {
      done: pages.length > 0,
      title: "Publish your first page",
      body: 'Ask Claude to publish a page, or <a href="/admin/pages/edit">write one here</a>.',
    },
  ]);

  const rows = pages.length
    ? pages
        .map((p) => {
          const own = privacy.scopes.find((scope) => scope.path === p.path);
          return `<tr>
<td><a href="/admin/pages/edit?path=${encodeURIComponent(p.path)}">${escapeHtml(p.title)}</a>
<div class="small"><span class="muted mono">${escapeHtml(p.path)}</span></div></td>
<td><span class="pill">${p.contentType}</span></td>
<td>${accessCell(p.path, own, own ? null : privateScope(privacy, p.path), true)}</td>
<td class="actions">
<a class="button secondary" href="${escapeHtml(p.path)}" target="_blank" rel="noopener">View</a>
${confirmAction({
            here: "/admin",
            token: `delete:${p.path}`,
            armed,
            action: "/admin/pages/delete",
            fields: { path: p.path },
            label: "Delete",
            confirm: `Delete ${p.path} for good`,
            cancel: "Keep it",
          })}
</td></tr>`;
        })
        .join("")
    : `<tr><td colspan="4" class="muted">Nothing published yet.</td></tr>`;

  // A private path with no page of its own still has to be manageable here, or the only way to
  // reopen it is through Claude.
  const orphans = privacy.scopes.filter((scope) => !pages.some((p) => p.path === scope.path));

  return page({
    title: "Pages",
    current: "/admin",
    body: `${flash(url)}${guide}
<div class="row" style="justify-content:space-between">
<h1>Pages</h1><a class="button" href="/admin/pages/edit">New page</a></div>
<div class="panel"><table>
<thead><tr><th>Page</th><th>Format</th><th>Access</th><th></th></tr></thead>
<tbody>${rows}</tbody></table></div>
${
      orphans.length
        ? `<h2>Private paths with no page</h2>
<div class="panel"><table><tbody>${orphans
            .map(
              (scope) => `<tr><td class="mono">${escapeHtml(scope.path)}</td>
<td>${accessCell(scope.path, scope, null, false)}</td></tr>`,
            )
            .join("")}</tbody></table></div>`
        : ""
    }`,
  });
}

// One rendering of everything about a path's access, so the page editor and the screen for a
// private path with no page cannot drift apart. Minting has to render its link rather than
// redirect with it, so the caller passes the GET this screen sits at and the response rewrites its
// history entry to it: a POST left in history means a refresh offers to submit it again.
function accessPanel(input: {
  path: string;
  own: PrivateScope | undefined;
  covering: PrivateScope | null;
  here: string;
  armed: string | null;
  minted?: { label: string; link: string };
}): string {
  const { path, own, covering, here, armed, minted } = input;
  // Every control here arms through the panel's own anchor, so answering the question lands back
  // on the question.
  const anchor = `${here}#access`;

  if (covering)
    return `<h2 id="access">Access</h2>
<div class="panel"><div class="row"><span class="pill warn">Private</span>
<span>Closed because <span class="mono">${escapeHtml(covering.path)}</span> is private.</span></div>
<div class="small muted" style="margin-top:.5rem">A private path covers everything at or under it, and privacy does not nest, so its links are managed there. <a href="/admin/pages/edit?path=${encodeURIComponent(
      covering.path,
    )}#access">Open ${escapeHtml(covering.path)}</a></div></div>`;

  if (!own)
    return `<h2 id="access">Access</h2>
<div class="panel"><div class="row"><span class="pill">Public</span>
<span>Anyone with the URL can read this.</span></div>
<form method="post" action="/admin/pages/private" style="margin-top:.7rem">
<input type="hidden" name="path" value="${escapeHtml(path)}">
<input type="hidden" name="return" value="${escapeHtml(`${here}#access`)}">
<button class="secondary" type="submit">Make private</button></form>
<div class="small muted" style="margin-top:.5rem">Closes this path and everything under it: the pages, the data served under <code>/data</code> and the assets. Only a link you send will open it.</div></div>`;

  const rows = own.shares.length
    ? own.shares
        .map(
          (share) => `<tr>
<td>${escapeHtml(share.label)}</td>
<td class="small muted">created ${when(share.createdAt)}</td>
<td class="small muted">last opened ${when(share.lastUsedAt)}</td>
<td class="actions">${confirmAction({
            here: anchor,
            token: `revoke:${share.label}`,
            armed,
            action: "/admin/pages/revoke",
            fields: { path: own.path, label: share.label, return: anchor },
            label: "Revoke",
            confirm: `Revoke ${share.label}, that link stops opening it`,
          })}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="4" class="muted">No links yet, so nobody can reach it.</td></tr>`;

  return `<h2 id="access">Access</h2>
<div class="panel">
<div class="row"><span class="pill warn">Private</span>
<span>Closed to the public. Only these links open it.</span></div>
<div class="small muted" style="margin-top:.5rem">Covers <span class="mono">${escapeHtml(own.path)}</span> and everything under it. Anyone holding a link is in, so a link is only as private as the way you send it.</div>
${
    minted
      ? `<div class="notice ok" style="margin-top:.8rem"><strong>${escapeHtml(minted.label)}</strong>
<p class="mono" style="word-break:break-all;margin:.5rem 0">${escapeHtml(minted.link)}</p>
<div class="row"><button class="secondary" type="button" data-copy="${escapeHtml(minted.link)}">Copy link</button>
<span class="small muted">Copy it now. Only a hash is stored, so it cannot be shown again.</span></div>
<div class="small muted" style="margin-top:.4rem">Send the whole thing. Everything after the <code>#</code> is the secret, it never reaches a server log, and a link without it opens nothing.</div></div>
<script>history.replaceState(null,"",${JSON.stringify(here)});</script>`
      : ""
  }
<table style="margin-top:.8rem">
<thead><tr><th>Link</th><th>Created</th><th>Used</th><th></th></tr></thead>
<tbody>${rows}</tbody></table>
<form method="post" action="/admin/pages/share" style="margin-top:.8rem">
<div class="field">
<label for="label">Name this link<span class="hint">Just for you, so you can tell links apart when you revoke one. For example Dana, or builders.</span></label>
<input id="label" name="label" required>
</div>
<input type="hidden" name="path" value="${escapeHtml(own.path)}">
<button type="submit">Create link</button>
</form>
<div class="row" style="margin-top:.8rem">${confirmAction({
    here: anchor,
    token: "public",
    armed,
    action: "/admin/pages/public",
    fields: { path: own.path, return: anchor },
    label: "Make public",
    confirm: own.shares.length
      ? `Open ${own.path} to everyone and break ${own.shares.length} link${
          own.shares.length === 1 ? "" : "s"
        }`
      : `Open ${own.path} to everyone`,
    className: "secondary",
    cancel: "Leave it private",
  })}
<span class="small muted">Reopens everything under it and kills every link above.</span></div>
</div>
<script>document.addEventListener("click",function(e){var b=e.target.closest("[data-copy]");if(!b)return;
navigator.clipboard.writeText(b.getAttribute("data-copy")).then(function(){var was=b.textContent;b.textContent="Copied";
setTimeout(function(){b.textContent=was},1500)})});</script>`;
}

// A private path with no page of its own has no editor to live in, so it gets this. Anything with
// a page is redirected to that page, because two screens for one path is how they drift.
async function pathAccessScreen(url: URL, minted?: { label: string; link: string }): Promise<Response> {
  const path = normalizePath(url.searchParams.get("path") ?? "");
  const privacy = await getPrivacy();
  const own = privacy.scopes.find((scope) => scope.path === path);
  if (!own) return back("/admin", { error: `${path} is not private, so it has no links.` });
  if (await getPage(path)) return redirect(`/admin/pages/edit?path=${encodeURIComponent(path)}#access`);

  return page({
    title: `Access ${path}`,
    current: "/admin",
    body: `${flash(url)}
<div class="row" style="justify-content:space-between">
<h1><span class="mono">${escapeHtml(path)}</span></h1>
<a class="button secondary" href="/admin">Back to pages</a></div>
<p class="lede">No page is published at this path, but it is private, so whatever is under it needs a link.</p>
${accessPanel({
      path,
      own,
      covering: null,
      here: `/admin/pages/access?path=${encodeURIComponent(path)}`,
      armed: url.searchParams.get("confirm"),
      minted,
    })}`,
  });
}

async function pageEditor(url: URL, minted?: { label: string; link: string }): Promise<Response> {
  const path = url.searchParams.get("path");
  const existing = path ? await getPage(path) : null;

  // Access belongs to a path, so there is nothing to show until the page has one.
  let access = "";
  if (existing) {
    const privacy = await getPrivacy();
    const own = privacy.scopes.find((scope) => scope.path === existing.path);
    access = accessPanel({
      path: existing.path,
      own,
      covering: own ? null : privateScope(privacy, existing.path),
      here: `/admin/pages/edit?path=${encodeURIComponent(existing.path)}`,
      armed: url.searchParams.get("confirm"),
      minted,
    });
  }

  return page({
    title: existing ? `Edit ${existing.path}` : "New page",
    current: "/admin",
    body: `${flash(url)}
<h1>${existing ? "Edit page" : "New page"}</h1>
${access}
${existing ? "<h2>Content</h2>" : ""}
<form method="post" action="/admin/pages/save" class="panel">
${
      existing
        ? `<input type="hidden" name="path" value="${escapeHtml(existing.path)}">
<div class="field">
  <label>Path<span class="hint">A path is moved, not retyped: its collections and files live under it.</span></label>
  <div class="row" style="justify-content:space-between">
  <span class="mono">${escapeHtml(existing.path)}</span>
  <a class="link" href="/admin/pages/move?path=${encodeURIComponent(existing.path)}">Move or rename</a></div>
</div>`
        : `<div class="field">
  <label for="path">Path<span class="hint">Lowercase, for example /about. Use / for the home page.</span></label>
  <input id="path" name="path" type="text" required value="" placeholder="/about">
</div>`
    }
<div class="field">
  <label for="title">Title<span class="hint">Leave blank to use the first heading.</span></label>
  <input id="title" name="title" type="text" value="${escapeHtml(existing?.title ?? "")}">
</div>
<div class="field">
  <label for="format">Format<span class="hint">Markdown is wrapped in the site theme. HTML is served exactly as written.</span></label>
  <select id="format" name="format">
    <option value="markdown"${existing?.contentType === "markdown" ? " selected" : ""}>Markdown</option>
    <option value="html"${existing?.contentType === "html" ? " selected" : ""}>HTML</option>
  </select>
</div>
<div class="field">
  <label for="content">Content</label>
  <textarea id="content" name="content" required>${escapeHtml(existing?.body ?? "")}</textarea>
</div>
<div class="row"><button type="submit">Save</button>
<a class="button secondary" href="/admin">Cancel</a></div>
</form>`,
  });
}

// A save writes the page at the path it is already at. It never renames: retyping the path used
// to write a new page and delete the old one, which stranded the collections and assets under the
// old path, lost the page's own createdAt, and reported none of it. Renaming is a move, and a move
// goes through the transfer engine like every other one.
async function savePageForm(request: Request): Promise<Response> {
  const body = await form(request);
  const path = normalizePath(body.path ?? "");
  if (!isValidPath(path)) return back("/admin/pages/edit", { error: `Path "${body.path}" is not usable.` });
  if (path === "/")
    return back("/admin/pages/edit", {
      error: `/ is not a page path. Publish the home page at ${ROOT_BUNDLE}, which is served at /.`,
    });

  await savePage({
    path,
    contentType: body.format === "html" ? "html" : "markdown",
    title: body.title?.trim() || deriveTitle(body.content ?? "", path),
    body: body.content ?? "",
  });

  return back("/admin", { ok: `Saved ${path}` });
}

// ---------- moving a page ----------

// Changing a path is a move, and what moves with it is the whole question: a page's collections
// are served under /data<path> and its files under /assets<path>, so moving the page alone leaves
// them answering at the old URLs while the page that names them has gone. The bundle is therefore
// the default, and the other choice says out loud what it leaves behind. Both run the same
// transfer engine the MCP tools use, so ids, revs and reference declarations survive exactly.
function inventoryTable(entries: { kind: string; path: string }[]): string {
  return `<table><tbody>${entries
    .map(
      (entry) =>
        `<tr><td style="width:6rem"><span class="pill">${escapeHtml(entry.kind)}</span></td>
<td class="mono">${escapeHtml(entry.path)}</td></tr>`,
    )
    .join("")}</tbody></table>`;
}

function countPhrase(entries: { kind: string; path: string }[]): string {
  const counts = [
    { kind: "other page", n: entries.filter((entry) => entry.kind === "page").length },
    { kind: "collection", n: entries.filter((entry) => entry.kind === "collection").length },
    { kind: "asset", n: entries.filter((entry) => entry.kind === "asset").length },
  ]
    .filter((entry) => entry.n > 0)
    .map(({ kind, n }) => `${n} ${kind}${n === 1 ? "" : "s"}`);
  if (counts.length === 0) return "nothing else";
  if (counts.length === 1) return counts[0];
  return `${counts.slice(0, -1).join(", ")} and ${counts[counts.length - 1]}`;
}

async function movePageScreen(url: URL): Promise<Response> {
  const path = normalizePath(url.searchParams.get("path") ?? "");
  const existing = await getPage(path);
  if (!existing) return back("/admin", { error: `No page exists at ${path}, so there is nothing to move.` });

  // / is not a bundle: it would hold the whole site. A page stored there can only move alone.
  const bundled = path !== "/";
  const contents = bundled ? await bundleContents(path) : null;
  const alsoHere = contents
    ? [
        ...contents.pages.filter((p) => p.path !== path).map((p) => ({ kind: "page", path: p.path })),
        ...contents.collections.map((c) => ({ kind: "collection", path: c.path })),
        ...contents.assets.map((a) => ({ kind: "asset", path: a.path! })),
      ]
    : [];

  const choices = bundled
    ? `<div class="field">
<label style="font-weight:400"><input type="radio" name="scope" value="bundle" checked>
<strong>Move everything at this path</strong>
<span class="hint">The page, plus ${escapeHtml(countPhrase(alsoHere))} at or under
<span class="mono">${escapeHtml(path)}</span>. Every URL changes together, so the page goes on finding what it
fetches.</span></label>
<label style="font-weight:400;margin-top:.7rem"><input type="radio" name="scope" value="page">
<strong>Move only the page</strong>
<span class="hint">${
        alsoHere.length === 0
          ? "Nothing else is at this path, so this is the same move."
          : `Everything else at this path stays behind at its old URL: ${escapeHtml(countPhrase(alsoHere))}, listed
below. The page goes on fetching them there.`
      }</span></label>
</div>`
    : `<input type="hidden" name="scope" value="page">
<div class="notice warn">This page sits at <span class="mono">/</span>, which is not a bundle: it would hold every
page, collection and file on the site. Only the page can move.</div>`;

  return page({
    title: `Move ${path}`,
    current: "/admin",
    body: `${flash(url)}
<h1>Move page</h1>
<p class="lede">At <span class="mono">${escapeHtml(path)}</span>. Nothing is copied and no page content is rewritten:
a page hardcodes the URLs it fetches, so whatever still names the old path is listed for you to edit afterwards.</p>
${
      path === ROOT_BUNDLE
        ? `<div class="notice warn">${escapeHtml(ROOT_BUNDLE)} is the page a browser gets at <span class="mono">/</span>.
Move it and the site root has no home page until you publish one here again.</div>`
        : ""
    }
<form method="post" action="/admin/pages/move" class="panel">
<input type="hidden" name="from" value="${escapeHtml(path)}">
<div class="field">
  <label for="to">New path<span class="hint">Lowercase, for example /travel/trip.</span></label>
  <input id="to" name="to" type="text" required value="${escapeHtml(path)}" placeholder="/travel/trip">
</div>
${choices}
<div class="field"><label style="font-weight:400"><input type="checkbox" name="overwrite" value="1">
Replace whatever is already at the new path
<span class="hint">Left off, an occupied path refuses the move and nothing changes.</span></label></div>
<div class="row"><button type="submit">Move</button>
<a class="button secondary" href="/admin/pages/edit?path=${encodeURIComponent(path)}">Cancel</a></div>
</form>
${
      alsoHere.length > 0
        ? `<h2>Also at this path</h2>
<div class="panel">${inventoryTable(alsoHere)}</div>`
        : ""
    }`,
  });
}

// A move never edits a page, so the one thing the owner has to be told is which lines still name
// the path that has gone. That does not survive a redirect, so the POST renders its own result and
// rewrites its history entry to the editor at the new path: a POST left in history means a refresh
// offers to submit it again.
async function moveResult(transfer: Transfer): Promise<Response> {
  const [stale, rest, privacy] = await Promise.all([
    staleReferences(transfer),
    restOfBundle(transfer),
    privacyChanges(transfer),
  ]);
  const moved = transfer.resources.find((r) => r.kind === "page" && r.from === transfer.from);
  const here = `/admin/pages/edit?path=${encodeURIComponent(moved?.to ?? transfer.from)}`;

  const rows = transfer.resources
    .map(
      (resource) => `<tr><td style="width:6rem"><span class="pill">${escapeHtml(resource.kind)}</span></td>
<td class="mono">${escapeHtml(resource.from)}</td>
<td class="mono">${escapeHtml(resource.to ?? "")}${
        resource.replaced ? '<div class="small muted">replaced what was there</div>' : ""
      }</td></tr>`,
    )
    .join("");

  return page({
    title: `Moved ${transfer.from}`,
    current: "/admin",
    body: `${notice("ok", `Moved ${transfer.from} to ${transfer.to}.`)}
<h1>Moved</h1>
<div class="panel"><table>
<thead><tr><th></th><th>Was</th><th>Now</th></tr></thead><tbody>${rows}</tbody></table></div>
${
      stale.length === 0
        ? '<div class="notice">No page names a path this took away.</div>'
        : `<h2>Pages still naming the old path</h2>
<div class="notice warn">No page content was changed. Every line below still names a path that has gone, and a URL a
page assembles from pieces cannot be found at all, so read these rather than trust the list.</div>
<div class="panel"><table>
<thead><tr><th>Page</th><th>Line</th></tr></thead><tbody>${stale
            .map((match) =>
              match.lines
                .map(
                  (line) => `<tr><td class="mono">${escapeHtml(match.path)}</td>
<td><span class="muted small">${line.line}</span> <span class="mono">${escapeHtml(line.text)}</span></td></tr>`,
                )
                .join(""),
            )
            .join("")}</tbody></table>${
            stale.some((match) => match.more > 0)
              ? '<div class="small muted">Some pages have more lines than are shown.</div>'
              : ""
          }</div>`
    }
${
      transfer.breaks.length === 0
        ? ""
        : `<h2>Records left pointing at nothing</h2>
<div class="panel"><table>
<thead><tr><th>Collection</th><th>Field</th><th>Pointed at</th><th>Records</th></tr></thead>
<tbody>${transfer.breaks
            .map(
              (broken) => `<tr><td class="mono">${escapeHtml(broken.path)}</td>
<td class="mono">${escapeHtml(broken.field)}</td>
<td class="mono">${escapeHtml(broken.references)}</td><td>${broken.count}</td></tr>`,
            )
            .join("")}</tbody></table></div>`
    }
${
      privacy.length === 0
        ? ""
        : `<h2>Access changed</h2>
<div class="notice ${privacy.some((change) => change.now === "public") ? "warn" : ""}">${privacy
            .map(
              (change) =>
                `<div><span class="mono">${escapeHtml(change.path)}</span> was ${escapeHtml(
                  change.was,
                )} and is now ${escapeHtml(change.now)}.</div>`,
            )
            .join("")}</div>`
    }
${
      rest.length === 0
        ? ""
        : `<h2>Left where it was</h2>
<div class="panel">${inventoryTable(rest)}</div>`
    }
${
      touchesHomePage(transfer)
        ? `<div class="notice warn">${escapeHtml(ROOT_BUNDLE)} is the page a browser gets at
<span class="mono">/</span>, so the site root has no home page until you publish one there again.</div>`
        : ""
    }
<div class="row"><a class="button" href="${here}">Open the page</a>
<a class="button secondary" href="/admin">Back to pages</a></div>
<script>history.replaceState(null,"",${JSON.stringify(here)});</script>`,
  });
}

async function movePageForm(request: Request): Promise<Response> {
  const body = await form(request);
  const from = normalizePath(body.from ?? "");
  const to = normalizePath(body.to ?? "");
  const scope: Scope = body.scope === "page" ? "page" : "bundle";
  const home = `/admin/pages/move?path=${encodeURIComponent(from)}`;

  if (!isValidPath(to)) return back(home, { error: `Path "${body.to}" is not usable.` });
  if (to === "/")
    return back(home, { error: `/ is not a page path. The home page is ${ROOT_BUNDLE}, which is served at /.` });

  try {
    return moveResult(
      await runTransfer({
        scope,
        verb: "move",
        from,
        to,
        overwrite: body.overwrite === "1",
        confirm: true,
      }),
    );
  } catch (error) {
    return back(home, { error: error instanceof Error ? error.message : String(error) });
  }
}

// ---------- assets ----------

async function assetsScreen(url: URL): Promise<Response> {
  const assets = await listAssets();
  const armed = url.searchParams.get("confirm");
  const rows = assets.length
    ? assets
        .map(
          (a) => `<tr>
<td>${escapeHtml(a.filename)}<div class="small muted mono">${escapeHtml(assetUrlFor(a))}</div></td>
<td class="small muted">${(a.size / 1024).toFixed(1)} KB</td>
<td class="actions">
<a class="button secondary" href="${escapeHtml(assetUrlFor(a))}" target="_blank" rel="noopener">Open</a>
${confirmAction({
            here: "/admin/assets",
            token: `delete:${a.key}`,
            armed,
            action: "/admin/assets/delete",
            fields: { key: a.key },
            label: "Delete",
            confirm: `Delete ${a.filename} for good`,
            cancel: "Keep it",
          })}
</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="3" class="muted">No files uploaded yet.</td></tr>`;

  return page({
    title: "Assets",
    current: "/admin/assets",
    body: `${flash(url)}
<h1>Assets</h1>
<p class="lede">Images and files you can reference from any page.</p>
<form method="post" action="/admin/assets/upload" enctype="multipart/form-data" class="panel">
<div class="field"><label for="file">Upload a file</label><input id="file" name="file" type="file" required></div>
<button type="submit">Upload</button>
</form>
<div class="panel"><table>
<thead><tr><th>File</th><th>Size</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`,
  });
}

async function uploadAsset(request: Request): Promise<Response> {
  const data = await request.formData();
  const file = data.get("file");
  if (!(file instanceof File)) return back("/admin/assets", { error: "No file received." });

  const asset = await putAsset({
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    bytes: await file.arrayBuffer(),
  });
  return back("/admin/assets", { ok: `Uploaded ${assetUrlFor(asset)}` });
}

// ---------- connections ----------

async function connectionsScreen(url: URL): Promise<Response> {
  const grants = await listGrants();
  const armed = url.searchParams.get("confirm");
  const rows = grants.length
    ? grants
        .map(
          (grant) => `<tr>
<td>${escapeHtml(grant.clientName)}</td>
<td class="small muted">${new Date(grant.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC</td>
<td class="actions">${confirmAction({
            here: "/admin/connections",
            token: `revoke:${grant.id}`,
            armed,
            action: "/admin/connections/revoke",
            fields: { grant_id: grant.id },
            label: "Revoke",
            confirm: `Revoke ${grant.clientName}, it has to connect again`,
          })}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="3" class="muted">Nothing connected yet.</td></tr>`;

  const origin = `${url.protocol}//${url.host}`;
  return page({
    title: "Connections",
    current: "/admin/connections",
    body: `${flash(url)}
<h1>Connect Claude</h1>
<p class="lede">Add this URL as a custom connector in Claude. You will be asked to sign in with your admin password.</p>
<div class="panel"><p class="mono" style="font-size:1rem">${escapeHtml(origin)}/mcp</p></div>
${
      url.host.endsWith(".netlify.app")
        ? `<div class="notice warn"><strong>If Chrome says "Dangerous site" while signing in</strong>
<div class="small" style="margin-top:.3rem">That is Safe Browsing reacting to the shared <code>netlify.app</code> domain, which gets abused for phishing, not to anything on your site. Adding your own domain in Netlify gives the site its own reputation and the warning stops.</div></div>`
        : ""
    }
<h2>Connected clients</h2>
<div class="panel"><table>
<thead><tr><th>Client</th><th>Connected</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`,
  });
}

// ---------- settings ----------

async function settingsScreen(url: URL): Promise<Response> {
  const settings = await getSettings();
  return page({
    title: "Settings",
    current: "/admin/settings",
    body: `${flash(url)}
<h1>Settings</h1>
<form method="post" action="/admin/settings/site" class="panel">
<h2 style="margin-top:0">Site</h2>
<div class="field"><label for="site_title">Title</label>
<input id="site_title" name="site_title" type="text" value="${escapeHtml(settings.title)}"></div>
<div class="field"><label for="site_description">Description</label>
<input id="site_description" name="site_description" type="text" value="${escapeHtml(settings.description)}"></div>
<button type="submit">Save</button>
</form>
<form method="post" action="/admin/settings/password" class="panel">
<h2 style="margin-top:0">Password</h2>
  <input type="text" name="username" value="admin" autocomplete="username"
    readonly hidden aria-hidden="true" tabindex="-1" style="display:none">

<div class="field"><label for="password">New password<span class="hint">At least 12 characters.</span></label>
<input id="password" name="password" type="password" minlength="12" required autocomplete="new-password"></div>
<div class="field"><label for="confirm">Confirm</label>
<input id="confirm" name="confirm" type="password" minlength="12" required autocomplete="new-password"></div>
<button type="submit">Change password</button>
</form>
<div class="panel">
<h2 style="margin-top:0">Custom domain</h2>
<p class="small muted" style="margin:0 0 .6rem">Your site can answer at your own domain instead of its netlify.app address. You add the domain in Netlify, point one DNS record at it from wherever your domain is managed, and Netlify issues the certificate. Nothing moves and nothing transfers.</p>
<p class="small muted" style="margin:0 0 .8rem">Worth doing: a domain of your own also avoids the browser warnings that shared netlify.app addresses sometimes attract.</p>
<a class="button secondary" href="https://docs.netlify.com/domains-https/custom-domains/" target="_blank" rel="noopener">How to add a domain &#8599;</a>
</div>
<form method="post" action="/admin/logout" class="panel">
<button class="secondary" type="submit">Sign out</button>
</form>`,
  });
}

// ---------- oauth consent ----------

async function authorizeScreen(request: Request, url: URL, owner: Owner): Promise<Response> {
  const parsed = await parseAuthorize(url);
  if (parsed instanceof Response) return parsed;

  if (request.method === "POST") {
    const body = await form(request);
    if (body.decision !== "approve") return redirect("/admin");
    return redirect(await completeAuthorize(parsed, owner.id));
  }

  return page({
    title: "Authorize",
    chrome: false,
    narrow: true,
    body: `
<h1>Connect ${escapeHtml(parsed.client.clientName)}?</h1>
<p class="lede">It will be able to read, publish, edit and delete pages and files on this site.</p>
<form method="post" class="panel">
<input type="hidden" name="decision" value="approve">
<div class="row"><button type="submit">Approve</button>
<a class="button secondary" href="/admin">Cancel</a></div>
</form>`,
  });
}

// ---------- data ----------

async function dataScreen(url: URL): Promise<Response> {
  const collections = await listCollections();
  const armed = url.searchParams.get("confirm");
  const rows = collections.length
    ? collections
        .map(
          (c) => `<tr>
<td><a href="/admin/data/edit?path=${encodeURIComponent(c.path)}">${escapeHtml(c.path)}</a>
<div class="small muted mono">/data${escapeHtml(c.path)}.json</div></td>
<td class="small muted">${c.count} items<div class="small muted">rev ${c.rev}</div></td>
<td class="actions">
<a class="button secondary" href="/data${escapeHtml(c.path)}.json" target="_blank" rel="noopener">Open</a>
${confirmAction({
            here: "/admin/data",
            token: `delete:${c.path}`,
            armed,
            action: "/admin/data/delete",
            fields: { path: c.path },
            label: "Delete",
            confirm: `Delete ${c.path} and its ${c.count} item${c.count === 1 ? "" : "s"}`,
            cancel: "Keep it",
          })}
</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="3" class="muted">No collections yet.</td></tr>`;

  return page({
    title: "Data",
    current: "/admin/data",
    body: `${flash(url)}
<div class="row" style="justify-content:space-between">
<h1>Data</h1><a class="button" href="/admin/data/edit">New collection</a></div>
<p class="lede">JSON a page can fetch and render. Each collection is served whole at its
<code>/data/&lt;path&gt;.json</code> address. Claude edits single items; here you edit the raw array.</p>
<div class="panel"><table>
<thead><tr><th>Collection</th><th>Size</th><th></th></tr></thead>
<tbody>${rows}</tbody></table></div>`,
  });
}

async function dataEditor(url: URL): Promise<Response> {
  const path = url.searchParams.get("path");
  const existing = path ? await getCollection(path) : null;
  const body = existing ? JSON.stringify(existing.items, null, 2) : "[]";

  return page({
    title: existing ? `Edit ${existing.path}` : "New collection",
    current: "/admin/data",
    body: `${flash(url)}
<h1>${existing ? "Edit collection" : "New collection"}</h1>
<form method="post" action="/admin/data/save" class="panel">
<input type="hidden" name="original" value="${escapeHtml(existing?.path ?? "")}">
<div class="field">
  <label for="path">Path<span class="hint">Lowercase, for example /products. Served at /data/products.json.</span></label>
  <input id="path" name="path" type="text" required value="${escapeHtml(existing?.path ?? "")}" placeholder="/products">
</div>
<div class="field">
  <label for="items">Items<span class="hint">A JSON array of objects. Each one needs a unique id; missing ids are filled in.</span></label>
  <textarea id="items" name="items" required spellcheck="false">${escapeHtml(body)}</textarea>
</div>
<div class="row"><button type="submit">Save</button>
<a class="button secondary" href="/admin/data">Cancel</a></div>
</form>`,
  });
}

async function saveDataForm(request: Request): Promise<Response> {
  const body = await form(request);
  const path = normalizeCollectionPath(body.path ?? "");
  const editing = `/admin/data/edit?path=${encodeURIComponent(body.original || path)}`;
  if (!isValidPath(path)) return back(editing, { error: `Path "${body.path}" is not usable.` });

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.items ?? "");
  } catch (error) {
    return back(editing, { error: `That is not valid JSON. ${error instanceof Error ? error.message : ""}` });
  }
  if (!Array.isArray(parsed)) return back(editing, { error: "Items must be a JSON array." });

  const items: Item[] = [];
  const taken = new Set<string>();
  for (const [index, entry] of parsed.entries()) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry))
      return back(editing, { error: `Item ${index + 1} is not an object.` });

    const fields = entry as Record<string, unknown>;
    let id = typeof fields.id === "string" && fields.id ? fields.id : `item-${index + 1}`;
    while (taken.has(id)) id = `${id}-2`;
    if (!isValidId(id)) return back(editing, { error: `Item id "${id}" is not usable.` });

    taken.add(id);
    items.push({ ...fields, id });
  }

  const original = body.original ? normalizeCollectionPath(body.original) : null;
  if (original && original !== path) await deleteCollection(original);

  await saveCollection(path, items);
  return back("/admin/data", { ok: `Saved ${path} with ${items.length} items` });
}

// ---------- router ----------

export async function handleAdmin(request: Request, url: URL): Promise<Response> {
  const path = url.pathname;

  if (path === "/admin/setup") return handleSetup(request);
  if (!(await isSetupComplete())) return redirect("/admin/setup");

  if (path === "/admin/login") return handleLogin(request, url.searchParams.get("next") ?? "/admin");

  const owner = await getSessionOwner(request);
  if (!owner) {
    return redirect(`/admin/login?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
  }

  if (path === "/oauth/authorize") return authorizeScreen(request, url, owner);

  if (request.method === "POST") {
    switch (path) {
      case "/admin/logout":
        return redirect("/admin/login", { "set-cookie": clearSessionCookie() });
      case "/admin/pages/save":
        return savePageForm(request);
      case "/admin/pages/move":
        return movePageForm(request);
      case "/admin/pages/delete": {
        const body = await form(request);
        await deletePage(body.path ?? "");
        return back("/admin", { ok: `Deleted ${body.path}` });
      }
      case "/admin/assets/upload":
        return uploadAsset(request);
      case "/admin/assets/delete": {
        const body = await form(request);
        await deleteAsset(body.key ?? "");
        return back("/admin/assets", { ok: "File deleted." });
      }
      case "/admin/data/save":
        return saveDataForm(request);
      case "/admin/data/delete": {
        const body = await form(request);
        await deleteCollection(body.path ?? "");
        return back("/admin/data", { ok: `Deleted ${body.path}` });
      }
      // These three come back to the screen the form was on, so changing a page's access from its
      // editor leaves you in the editor.
      case "/admin/pages/private": {
        const body = await form(request);
        const path = normalizePath(body.path ?? "");
        const to = returnTo(body.return);
        if (path === "/") return back(to, { error: "/ cannot be private: it would close the whole site." });
        if (!isValidPath(path)) return back(to, { error: `${body.path} is not a usable path.` });
        try {
          await setPrivate(path);
        } catch (error) {
          return back(to, { error: error instanceof Error ? error.message : String(error) });
        }
        return back(to, { ok: `${path} is private. Nobody can reach it until you make a link.` });
      }
      case "/admin/pages/public": {
        const body = await form(request);
        const scope = await setPublic(normalizePath(body.path ?? ""));
        return back(returnTo(body.return), {
          ok: scope ? `${scope.path} is public again, and ${scope.shares.length} link(s) stopped working.` : "Nothing to do.",
        });
      }
      case "/admin/pages/share": {
        const body = await form(request);
        const path = normalizePath(body.path ?? "");
        const label = (body.label ?? "").trim();
        // An error goes back to where the form was, and so does a success: the editor for a page,
        // the access screen for a private path that has none.
        const editing = Boolean(await getPage(path));
        const home = new URL(manageHref(path, editing), url);
        const flashTo = `${home.pathname}${home.search}${home.hash}`;

        if (!label) return back(flashTo, { error: "Give the link a name." });
        try {
          const { token } = await mintShare(path, label);
          // Rendered straight into this response, never redirected with the link in a query
          // string: that is the one way a share token could reach a server log.
          const link = `${url.protocol}//${url.host}${path === ROOT_BUNDLE ? "" : path}#${token}`;
          return editing ? pageEditor(home, { label, link }) : pathAccessScreen(home, { label, link });
        } catch (error) {
          return back(flashTo, { error: error instanceof Error ? error.message : String(error) });
        }
      }
      case "/admin/pages/revoke": {
        const body = await form(request);
        const gone = await revokeShares(normalizePath(body.path ?? ""), (body.label ?? "").trim());
        return back(returnTo(body.return), {
          ok: gone.length ? `Revoked ${gone.map((share) => share.label).join(", ")}.` : "Nothing to revoke.",
        });
      }
      case "/admin/connections/revoke": {
        const body = await form(request);
        await revokeGrant(body.grant_id ?? "");
        return back("/admin/connections", { ok: "Connection revoked." });
      }
      case "/admin/settings/site": {
        const body = await form(request);
        await saveSettings({ title: body.site_title ?? "Pages", description: body.site_description ?? "" });
        return back("/admin/settings", { ok: "Site updated." });
      }
      case "/admin/settings/password": {
        const body = await form(request);
        if ((body.password ?? "").length < 12)
          return back("/admin/settings", { error: "Password must be at least 12 characters." });
        if (body.password !== body.confirm)
          return back("/admin/settings", { error: "Passwords do not match." });
        await changePassword(body.password);
        return back("/admin/settings", { ok: "Password changed." });
      }
    }
    return new Response("Not found", { status: 404 });
  }

  switch (path) {
    case "/admin":
    case "/admin/":
      return pagesScreen(url);
    case "/admin/pages/access":
      return pathAccessScreen(url);
    case "/admin/pages/edit":
      return pageEditor(url);
    case "/admin/pages/move":
      return movePageScreen(url);
    case "/admin/assets":
      return assetsScreen(url);
    case "/admin/data":
      return dataScreen(url);
    case "/admin/data/edit":
      return dataEditor(url);
    case "/admin/connections":
      return connectionsScreen(url);
    case "/admin/settings":
      return settingsScreen(url);
  }

  return new Response("Not found", { status: 404 });
}
