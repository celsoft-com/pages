import { deleteAsset, listAssets, putAsset } from "../assets/service";
import { verifySecret } from "../auth/password";
import { checkRateLimit, clearFailures, clientBucket, recordFailure } from "../auth/ratelimit";
import { clearSessionCookie, createSessionCookie, getSessionOwner } from "../auth/session";
import { changePassword, completeSetup, getOwner, isSetupComplete } from "../auth/setup";
import { completeAuthorize, parseAuthorize } from "../oauth/server";
import { listGrants, revokeGrant } from "../oauth/store";
import { deletePage, deriveTitle, getPage, listPages, savePage } from "../pages/service";
import { isValidPath, normalizePath } from "../pages/path";
import { getSettings, saveSettings } from "../settings";
import type { Owner } from "../types";
import { escapeHtml, notice, page, redirect } from "./ui";

function flash(url: URL): string {
  const ok = url.searchParams.get("ok");
  const bad = url.searchParams.get("error");
  if (ok) return notice("ok", ok);
  if (bad) return notice("bad", bad);
  return "";
}

function back(path: string, params: Record<string, string>): Response {
  const query = new URLSearchParams(params).toString();
  return redirect(query ? `${path}?${query}` : path);
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

async function pagesScreen(url: URL): Promise<Response> {
  const [pages, grants] = await Promise.all([listPages(), listGrants()]);
  const origin = `${url.protocol}//${url.host}`;

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
        .map(
          (p) => `<tr>
<td><a href="/admin/pages/edit?path=${encodeURIComponent(p.path)}">${escapeHtml(p.title)}</a>
<div class="small muted mono">${escapeHtml(p.path)}</div></td>
<td><span class="pill">${p.contentType}</span></td>
<td class="actions">
<a class="button secondary" href="${escapeHtml(p.path)}" target="_blank" rel="noopener">View</a>
<form method="post" action="/admin/pages/delete" style="display:inline"
  onsubmit="return confirm('Delete ${escapeHtml(p.path)}?')">
<input type="hidden" name="path" value="${escapeHtml(p.path)}">
<button class="danger" type="submit">Delete</button></form>
</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="3" class="muted">Nothing published yet.</td></tr>`;

  return page({
    title: "Pages",
    current: "/admin",
    body: `${flash(url)}${guide}
<div class="row" style="justify-content:space-between">
<h1>Pages</h1><a class="button" href="/admin/pages/edit">New page</a></div>
<div class="panel"><table>
<thead><tr><th>Page</th><th>Format</th><th></th></tr></thead>
<tbody>${rows}</tbody></table></div>`,
  });
}

async function pageEditor(url: URL): Promise<Response> {
  const path = url.searchParams.get("path");
  const existing = path ? await getPage(path) : null;

  return page({
    title: existing ? `Edit ${existing.path}` : "New page",
    current: "/admin",
    body: `${flash(url)}
<h1>${existing ? "Edit page" : "New page"}</h1>
<form method="post" action="/admin/pages/save" class="panel">
<input type="hidden" name="original" value="${escapeHtml(existing?.path ?? "")}">
<div class="field">
  <label for="path">Path<span class="hint">Lowercase, for example /about. Use / for the home page.</span></label>
  <input id="path" name="path" type="text" required value="${escapeHtml(existing?.path ?? "")}" placeholder="/about">
</div>
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

async function savePageForm(request: Request): Promise<Response> {
  const body = await form(request);
  const path = normalizePath(body.path ?? "");
  if (!isValidPath(path)) return back("/admin/pages/edit", { error: `Path "${body.path}" is not usable.` });

  const original = body.original ? normalizePath(body.original) : null;
  if (original && original !== path) await deletePage(original);

  await savePage({
    path,
    contentType: body.format === "html" ? "html" : "markdown",
    title: body.title?.trim() || deriveTitle(body.content ?? "", path),
    body: body.content ?? "",
  });

  return back("/admin", { ok: `Saved ${path}` });
}

// ---------- assets ----------

async function assetsScreen(url: URL): Promise<Response> {
  const assets = await listAssets();
  const rows = assets.length
    ? assets
        .map(
          (a) => `<tr>
<td>${escapeHtml(a.filename)}<div class="small muted mono">/assets/${escapeHtml(a.key)}</div></td>
<td class="small muted">${(a.size / 1024).toFixed(1)} KB</td>
<td class="actions">
<a class="button secondary" href="/assets/${escapeHtml(a.key)}" target="_blank" rel="noopener">Open</a>
<form method="post" action="/admin/assets/delete" style="display:inline">
<input type="hidden" name="key" value="${escapeHtml(a.key)}">
<button class="danger" type="submit">Delete</button></form>
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
  return back("/admin/assets", { ok: `Uploaded /assets/${asset.key}` });
}

// ---------- connections ----------

async function connectionsScreen(url: URL): Promise<Response> {
  const grants = await listGrants();
  const rows = grants.length
    ? grants
        .map(
          (grant) => `<tr>
<td>${escapeHtml(grant.clientName)}</td>
<td class="small muted">${new Date(grant.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC</td>
<td class="actions"><form method="post" action="/admin/connections/revoke">
<input type="hidden" name="grant_id" value="${escapeHtml(grant.id)}">
<button class="danger" type="submit">Revoke</button></form></td></tr>`,
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
<div class="field"><label for="password">New password<span class="hint">At least 12 characters.</span></label>
<input id="password" name="password" type="password" minlength="12" required autocomplete="new-password"></div>
<div class="field"><label for="confirm">Confirm</label>
<input id="confirm" name="confirm" type="password" minlength="12" required autocomplete="new-password"></div>
<button type="submit">Change password</button>
</form>
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
    case "/admin/pages/edit":
      return pageEditor(url);
    case "/admin/assets":
      return assetsScreen(url);
    case "/admin/connections":
      return connectionsScreen(url);
    case "/admin/settings":
      return settingsScreen(url);
  }

  return new Response("Not found", { status: 404 });
}
