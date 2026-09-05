import { deleteAsset, listAssets, putAsset } from "../assets/service";
import { changePassword, completeSetup, getOwner, isSetupComplete } from "../auth/setup";
import { verifySecret } from "../auth/password";
import { checkRateLimit, clearFailures, clientBucket, recordFailure } from "../auth/ratelimit";
import { clearSessionCookie, createSessionCookie, getSessionOwner } from "../auth/session";
import { seal } from "../crypto/secretbox";
import { listZones } from "../domains/cloudflare";
import { isApex, PROVIDERS, providerById } from "../domains/instructions";
import {
  addDomain,
  configureProviderZone,
  domainRecords,
  getDomainConfig,
  listDomains,
  refreshDomain,
  removeDomain,
} from "../domains/service";
import { deletePage, deriveTitle, getPage, listPages, savePage } from "../pages/service";
import { isValidPath, normalizePath } from "../pages/path";
import { getSetting, getSettings, SETTING, setSetting } from "../settings";
import type { Env } from "../types";
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

async function handleSetup(request: Request, env: Env): Promise<Response> {
  if (await isSetupComplete(env)) return redirect("/admin/login");
  if (request.method !== "POST") return setupScreen();

  const body = await form(request);
  if ((body.password ?? "").length < 12) return setupScreen("Password must be at least 12 characters.");
  if (body.password !== body.confirm) return setupScreen("Passwords do not match.");

  const { ownerId, recovery } = await completeSetup(env, body.password);
  const cookie = await createSessionCookie(env, ownerId);

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
  headers.append("set-cookie", cookie);
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
<p class="small muted">Lost your password? Sign in with your recovery code instead, then set a new one in Settings.</p>`,
  });
}

async function handleLogin(request: Request, env: Env, next: string): Promise<Response> {
  if (!(await isSetupComplete(env))) return redirect("/admin/setup");
  if (request.method !== "POST") return loginScreen();

  const bucket = clientBucket(request);
  if (!(await checkRateLimit(env, bucket)))
    return loginScreen("Too many attempts. Try again in fifteen minutes.");

  const body = await form(request);
  const owner = await getOwner(env);
  if (!owner) return redirect("/admin/setup");

  const okPassword = await verifySecret(body.password ?? "", owner.password_hash, owner.password_salt);
  const okRecovery = okPassword
    ? false
    : await verifySecret(
        (body.password ?? "").trim().toUpperCase(),
        owner.recovery_hash,
        owner.recovery_salt,
      );

  if (!okPassword && !okRecovery) {
    await recordFailure(env, bucket);
    return loginScreen("Incorrect password.");
  }

  await clearFailures(env, bucket);
  const cookie = await createSessionCookie(env, owner.id);
  return redirect(okRecovery ? "/admin/settings?ok=Signed+in+with+recovery+code.+Set+a+new+password." : next, {
    "set-cookie": cookie,
  });
}

// ---------- pages ----------

async function pagesScreen(env: Env, url: URL): Promise<Response> {
  const pages = await listPages(env);
  const rows = pages.length
    ? pages
        .map(
          (p) => `<tr>
<td><a href="/admin/pages/edit?path=${encodeURIComponent(p.path)}">${escapeHtml(p.title)}</a>
<div class="small muted mono">${escapeHtml(p.path)}</div></td>
<td><span class="pill">${p.content_type}</span></td>
<td class="actions">
<a class="button secondary small" href="${escapeHtml(p.path)}" target="_blank" rel="noopener">View</a>
<form method="post" action="/admin/pages/delete" style="display:inline"
  onsubmit="return confirm('Delete ${escapeHtml(p.path)}?')">
<input type="hidden" name="path" value="${escapeHtml(p.path)}">
<button class="danger" type="submit">Delete</button></form>
</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="3" class="muted">Nothing published yet. Connect Claude and ask it to publish a page, or create one here.</td></tr>`;

  return page({
    title: "Pages",
    current: "/admin",
    body: `${flash(url)}
<div class="row" style="justify-content:space-between">
<h1>Pages</h1><a class="button" href="/admin/pages/edit">New page</a></div>
<div class="panel"><table>
<thead><tr><th>Page</th><th>Format</th><th></th></tr></thead>
<tbody>${rows}</tbody></table></div>`,
  });
}

async function pageEditor(env: Env, url: URL): Promise<Response> {
  const path = url.searchParams.get("path");
  const existing = path ? await getPage(env, path) : null;

  return page({
    title: existing ? `Edit ${existing.path}` : "New page",
    current: "/admin",
    body: `${flash(url)}
<h1>${existing ? "Edit page" : "New page"}</h1>
<form method="post" action="/admin/pages/save" class="panel">
<input type="hidden" name="original" value="${escapeHtml(existing?.path ?? "")}">
<div class="field">
  <label for="path">Path<span class="hint">Lowercase, for example /about or /notes/first-post. Use / for the home page.</span></label>
  <input id="path" name="path" type="text" required value="${escapeHtml(existing?.path ?? "")}" placeholder="/about">
</div>
<div class="field">
  <label for="title">Title<span class="hint">Leave blank to use the first heading.</span></label>
  <input id="title" name="title" type="text" value="${escapeHtml(existing?.title ?? "")}">
</div>
<div class="field">
  <label for="format">Format<span class="hint">Markdown is wrapped in the site theme. HTML is served exactly as written.</span></label>
  <select id="format" name="format">
    <option value="markdown"${existing?.content_type === "markdown" ? " selected" : ""}>Markdown</option>
    <option value="html"${existing?.content_type === "html" ? " selected" : ""}>HTML</option>
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

async function savePageForm(request: Request, env: Env, ownerId: string): Promise<Response> {
  const body = await form(request);
  const path = normalizePath(body.path ?? "");
  if (!isValidPath(path)) return back("/admin/pages/edit", { error: `Path "${body.path}" is not usable.` });

  const original = body.original ? normalizePath(body.original) : null;
  if (original && original !== path) await deletePage(env, original);

  await savePage(env, {
    path,
    ownerId,
    contentType: body.format === "html" ? "html" : "markdown",
    title: body.title?.trim() || deriveTitle(body.content ?? "", path),
    body: body.content ?? "",
  });

  return back("/admin", { ok: `Saved ${path}` });
}

// ---------- assets ----------

async function assetsScreen(env: Env, url: URL): Promise<Response> {
  const assets = await listAssets(env);
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

async function uploadAsset(request: Request, env: Env, ownerId: string): Promise<Response> {
  const data = await request.formData();
  const file = data.get("file");
  if (!(file instanceof File)) return back("/admin/assets", { error: "No file received." });

  const asset = await putAsset(env, {
    ownerId,
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    bytes: await file.arrayBuffer(),
  });
  return back("/admin/assets", { ok: `Uploaded /assets/${asset.key}` });
}

// ---------- domains ----------

function recordTable(records: { type: string; name: string; value: string; purpose: string }[]): string {
  if (records.length === 0) return "";
  return `<table><thead><tr><th>Type</th><th>Name</th><th>Value</th></tr></thead><tbody>${records
    .map(
      (r) => `<tr><td><span class="pill">${r.type}</span></td>
<td class="mono">${escapeHtml(r.name)}</td>
<td class="mono">${escapeHtml(r.value)}<div class="small muted" style="margin-top:.3rem">${escapeHtml(
        r.purpose,
      )}</div></td></tr>`,
    )
    .join("")}</tbody></table>`;
}

async function domainsScreen(env: Env, url: URL): Promise<Response> {
  const config = await getDomainConfig(env);

  if (!config) {
    const zoneId = await getSetting(env, SETTING.cfZoneId);
    return page({
      title: "Domains",
      current: "/admin/domains",
      body: `${flash(url)}
<h1>Custom domains</h1>
<p class="lede">One-time setup. After this, any domain can point here with a CNAME, and its owner never has to move their DNS.</p>
<div class="panel">
<h2 style="margin-top:0">Connect your Cloudflare account</h2>
<ol class="steps">
<li>Open the Cloudflare dashboard and create an API token.</li>
<li>Give it these permissions: <code>Zone : SSL and Certificates : Edit</code>, <code>Zone : DNS : Edit</code>, <code>Zone : Workers Routes : Edit</code>, <code>Zone : Zone : Read</code>.</li>
<li>Scope it to the one domain this site should use as its home base, then paste the token below.</li>
</ol>
<form method="post" action="/admin/domains/configure">
<div class="field">
  <label for="token">Cloudflare API token<span class="hint">Stored encrypted. Never shown again after saving.</span></label>
  <input id="token" name="token" type="password" required>
</div>
<div class="field">
  <label for="script">Worker name<span class="hint">The name of this Worker in your Cloudflare account.</span></label>
  <input id="script" name="script" type="text" value="pages" required>
</div>
${zoneId ? `<input type="hidden" name="zone_id" value="${escapeHtml(zoneId)}">` : ""}
<button type="submit">Continue</button>
</form>
</div>`,
    });
  }

  const domains = await listDomains(env);
  const cards = await Promise.all(
    domains.map(async (domain) => {
      const records = await domainRecords(env, domain);
      const pill =
        domain.status === "active" ? "ok" : domain.status === "failed" ? "bad" : "warn";
      const label =
        domain.status === "active"
          ? "Live"
          : domain.status === "failed"
            ? "Needs attention"
            : "Waiting for DNS";
      return `<div class="panel">
<div class="row" style="justify-content:space-between">
<div><strong class="mono">${escapeHtml(domain.hostname)}</strong>
<span class="pill ${pill}" style="margin-left:.5rem">${label}</span></div>
<form method="post" action="/admin/domains/remove"
  onsubmit="return confirm('Remove ${escapeHtml(domain.hostname)}?')">
<input type="hidden" name="hostname" value="${escapeHtml(domain.hostname)}">
<button class="danger" type="submit">Remove</button></form>
</div>
${
  domain.verification_errors
    ? notice("bad", domain.verification_errors)
    : domain.status === "active"
      ? ""
      : `<p class="small muted">Add these two records wherever you manage DNS for this domain. This page checks every few minutes.</p>${recordTable(
          records,
        )}`
}
${isApex(domain.hostname) && domain.status !== "active" ? notice("warn", "This is a bare domain. It only works if your DNS provider supports CNAME flattening or ALIAS records. If it does not, use www instead.") : ""}
</div>`;
    }),
  );

  const providerOptions = PROVIDERS.map(
    (p) => `<option value="${p.id}">${escapeHtml(p.label)}</option>`,
  ).join("");

  return page({
    title: "Domains",
    current: "/admin/domains",
    body: `${flash(url)}
<h1>Custom domains</h1>
<p class="lede">Point any domain here with a CNAME. Nothing moves, nothing transfers.</p>
<form method="post" action="/admin/domains/add" class="panel">
<div class="field">
  <label for="hostname">Domain<span class="hint">For example blog.example.com</span></label>
  <input id="hostname" name="hostname" type="text" required placeholder="blog.example.com">
</div>
<div class="field">
  <label for="provider">Who manages this domain's DNS?<span class="hint">Used to show the right instructions.</span></label>
  <select id="provider" name="provider">${providerOptions}</select>
</div>
<button type="submit">Add domain</button>
</form>
${cards.join("")}
<p class="small muted">CNAME target for every domain: <code>${escapeHtml(config.fallbackOrigin)}</code></p>`,
  });
}

async function configureDomains(request: Request, env: Env): Promise<Response> {
  const body = await form(request);
  const token = body.token?.trim();
  if (!token) return back("/admin/domains", { error: "Token is required." });

  let zones;
  try {
    zones = await listZones(token);
  } catch (error) {
    return back("/admin/domains", {
      error: error instanceof Error ? error.message : "Could not reach Cloudflare.",
    });
  }

  const zone = body.zone_id ? zones.find((z) => z.id === body.zone_id) : zones[0];
  if (!zone)
    return back("/admin/domains", {
      error: "That token cannot see any domains. Scope it to a domain in your account.",
    });

  try {
    await configureProviderZone(env, {
      token,
      zoneId: zone.id,
      zoneName: zone.name,
      scriptName: body.script?.trim() || "pages",
    });
  } catch (error) {
    return back("/admin/domains", {
      error: error instanceof Error ? error.message : "Cloudflare setup failed.",
    });
  }

  await setSetting(env, SETTING.cfApiToken, await seal(env, token));
  await setSetting(env, SETTING.cfZoneId, zone.id);
  return back("/admin/domains", { ok: `Ready. Domains will point at ${zone.name}.` });
}

// ---------- connections ----------

async function connectionsScreen(env: Env, url: URL, ownerId: string): Promise<Response> {
  const grants = await env.OAUTH_PROVIDER.listUserGrants(ownerId);
  const named = await Promise.all(
    grants.items.map(async (grant) => {
      const client = await env.OAUTH_PROVIDER.lookupClient(grant.clientId).catch(() => null);
      return { grant, name: client?.clientName || grant.clientId };
    }),
  );
  const rows = named.length
    ? named
        .map(
          ({ grant, name }) => `<tr>
<td>${escapeHtml(name)}</td>
<td class="small muted">${new Date(grant.createdAt * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC</td>
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
<p class="lede">Add this URL as a custom connector in Claude. You will be asked to sign in with the password you set here.</p>
<div class="panel"><p class="mono" style="font-size:1rem">${escapeHtml(origin)}/mcp</p></div>
<h2>Connected clients</h2>
<div class="panel"><table>
<thead><tr><th>Client</th><th>Connected</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`,
  });
}

// ---------- settings ----------

async function settingsScreen(env: Env, url: URL): Promise<Response> {
  const settings = await getSettings(env);
  return page({
    title: "Settings",
    current: "/admin/settings",
    body: `${flash(url)}
<h1>Settings</h1>
<form method="post" action="/admin/settings/site" class="panel">
<h2 style="margin-top:0">Site</h2>
<div class="field"><label for="site_title">Title</label>
<input id="site_title" name="site_title" type="text" value="${escapeHtml(settings[SETTING.siteTitle] ?? "")}"></div>
<div class="field"><label for="site_description">Description</label>
<input id="site_description" name="site_description" type="text" value="${escapeHtml(
      settings[SETTING.siteDescription] ?? "",
    )}"></div>
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

async function authorizeScreen(request: Request, env: Env, ownerId: string): Promise<Response> {
  const oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  const client = await env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId);
  const name = client?.clientName || oauthReq.clientId;

  if (request.method === "POST") {
    const body = await form(request);
    if (body.decision !== "approve") return redirect("/admin");
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthReq,
      userId: ownerId,
      metadata: { connectedAt: Date.now() },
      scope: oauthReq.scope,
      props: { ownerId },
    });
    return redirect(redirectTo);
  }

  return page({
    title: "Authorize",
    chrome: false,
    narrow: true,
    body: `
<h1>Connect ${escapeHtml(name)}?</h1>
<p class="lede">It will be able to read, publish, edit and delete pages and files on this site.</p>
<form method="post" class="panel">
<input type="hidden" name="decision" value="approve">
<div class="row"><button type="submit">Approve</button>
<a class="button secondary" href="/admin">Cancel</a></div>
</form>`,
  });
}

// ---------- router ----------

export async function handleAdmin(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;

  if (path === "/admin/setup") return handleSetup(request, env);
  if (!(await isSetupComplete(env))) return redirect("/admin/setup");

  const next = url.searchParams.get("next") ?? "/admin";
  if (path === "/admin/login") return handleLogin(request, env, next);

  const ownerId = await getSessionOwner(request, env);
  if (!ownerId) {
    const target = `${url.pathname}${url.search}`;
    return redirect(`/admin/login?next=${encodeURIComponent(target)}`);
  }

  if (path === "/oauth/authorize") return authorizeScreen(request, env, ownerId);

  if (request.method === "POST") {
    switch (path) {
      case "/admin/logout":
        return redirect("/admin/login", { "set-cookie": clearSessionCookie() });
      case "/admin/pages/save":
        return savePageForm(request, env, ownerId);
      case "/admin/pages/delete": {
        const body = await form(request);
        await deletePage(env, body.path ?? "");
        return back("/admin", { ok: `Deleted ${body.path}` });
      }
      case "/admin/assets/upload":
        return uploadAsset(request, env, ownerId);
      case "/admin/assets/delete": {
        const body = await form(request);
        await deleteAsset(env, body.key ?? "");
        return back("/admin/assets", { ok: "File deleted." });
      }
      case "/admin/domains/configure":
        return configureDomains(request, env);
      case "/admin/domains/add": {
        const body = await form(request);
        try {
          const { domain } = await addDomain(env, ownerId, body.hostname ?? "");
          const provider = providerById(body.provider ?? "generic");
          return back("/admin/domains", {
            ok: `${domain.hostname} added. ${provider.steps[0]}`,
          });
        } catch (error) {
          return back("/admin/domains", {
            error: error instanceof Error ? error.message : "Could not add that domain.",
          });
        }
      }
      case "/admin/domains/remove": {
        const body = await form(request);
        await removeDomain(env, body.hostname ?? "");
        return back("/admin/domains", { ok: "Domain removed." });
      }
      case "/admin/connections/revoke": {
        const body = await form(request);
        await env.OAUTH_PROVIDER.revokeGrant(body.grant_id ?? "", ownerId);
        return back("/admin/connections", { ok: "Connection revoked." });
      }
      case "/admin/settings/site": {
        const body = await form(request);
        await setSetting(env, SETTING.siteTitle, body.site_title ?? "Pages");
        await setSetting(env, SETTING.siteDescription, body.site_description ?? "");
        return back("/admin/settings", { ok: "Site updated." });
      }
      case "/admin/settings/password": {
        const body = await form(request);
        if ((body.password ?? "").length < 12)
          return back("/admin/settings", { error: "Password must be at least 12 characters." });
        if (body.password !== body.confirm)
          return back("/admin/settings", { error: "Passwords do not match." });
        await changePassword(env, ownerId, body.password);
        return back("/admin/settings", { ok: "Password changed." });
      }
    }
    return new Response("Not found", { status: 404 });
  }

  switch (path) {
    case "/admin":
    case "/admin/":
      return pagesScreen(env, url);
    case "/admin/pages/edit":
      return pageEditor(env, url);
    case "/admin/assets":
      return assetsScreen(env, url);
    case "/admin/domains":
      return domainsScreen(env, url);
    case "/admin/domains/refresh": {
      const domains = await listDomains(env);
      for (const domain of domains) if (domain.status !== "active") await refreshDomain(env, domain);
      return back("/admin/domains", { ok: "Checked." });
    }
    case "/admin/connections":
      return connectionsScreen(env, url, ownerId);
    case "/admin/settings":
      return settingsScreen(env, url);
  }

  return new Response("Not found", { status: 404 });
}
