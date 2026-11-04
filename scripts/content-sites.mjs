// Reading and writing a pages site's content, shared by migrate-content.mjs and verify-content.mjs.
//
// A site is named by a URL and its token comes from the environment, never an argument, so it reaches
// no shell history and no process list, and nothing here ever prints one. A source may instead be an
// export directory: content.json beside the asset files, which `migrate-content.mjs --export` writes.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// Cloudflare refuses a client that names no user agent of its own.
const USER_AGENT = "pages-migrate/1";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export class SiteError extends Error {}

// One site over its REST API. The current API reads with GET and writes with POST; the API before the
// platform took every call as a POST, which `legacy` selects, found by the absence of an API document.
export class Site {
  constructor(url, token) {
    this.url = url.replace(/\/+$/, "");
    this.token = token;
  }

  headers(extra = {}) {
    return { authorization: `Bearer ${this.token}`, "user-agent": USER_AGENT, ...extra };
  }

  async detect() {
    if (this.legacy !== undefined) return;
    const response = await fetch(`${this.url}/api/platform/openapi.json`, { headers: this.headers() });
    if (response.status === 401) throw new SiteError(`${this.url} refused the token (401).`);
    this.legacy = !response.ok;
  }

  async call(tool, args = {}, { read = false } = {}) {
    await this.detect();
    let response;
    if (read && !this.legacy) {
      const query = encodeQuery(args);
      response = await fetch(`${this.url}/api/v1/${tool}${query ? `?${query}` : ""}`, { headers: this.headers() });
    } else {
      response = await fetch(`${this.url}/api/v1/${tool}`, {
        method: "POST",
        headers: this.headers({ "content-type": "application/json" }),
        body: JSON.stringify(args),
      });
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reason = body.error?.message ?? body.error ?? body.message ?? "";
      const error = new SiteError(`${tool} on ${this.url}: ${response.status} ${typeof reason === "string" ? reason : JSON.stringify(reason)}`.trim());
      error.status = response.status;
      throw error;
    }
    return body;
  }

  read(tool, args) {
    return this.call(tool, args, { read: true });
  }

  // A file's bytes and the type the site serves it with, which is what its upload recorded.
  async file(url) {
    const absolute = url.startsWith("http") ? url : `${this.url}${url}`;
    const response = await fetch(absolute, { headers: this.headers() });
    if (!response.ok) throw new SiteError(`GET ${absolute}: ${response.status}`);
    const type = (response.headers.get("content-type") ?? "").split(";")[0].trim();
    return { bytes: Buffer.from(await response.arrayBuffer()), type };
  }

  async upload(path, filename, contentType, bytes) {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: contentType }), filename);
    if (path) form.append("path", path);
    const response = await fetch(`${this.url}/api/v1/upload_asset`, { method: "POST", headers: this.headers(), body: form });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new SiteError(`upload_asset ${path ?? filename}: ${response.status} ${body.error ?? ""}`.trim());
    return body;
  }

  // The site's content in the export shape, read whole. Drafts, item order, references, every asset's
  // bytes, the owner's instructions, the site's settings and its private paths.
  async snapshot() {
    const [{ pages }, { collections }, { assets }, site, instructions] = await Promise.all([
      this.read("list_pages"),
      this.read("list_collections"),
      this.read("list_assets"),
      this.read("get_site"),
      this.read("get_instructions"),
    ]);

    const fullPages = [];
    for (const summary of pages) {
      const live = await this.read("get_page", { path: summary.path });
      const page = { path: live.path, title: live.title, format: live.format, meta: live.meta ?? {}, content: live.content };
      if (live.has_draft) {
        const draft = await this.read("get_page", { path: summary.path, draft: true });
        page.draft = { title: draft.title, format: draft.format, meta: draft.meta ?? {}, content: draft.content };
      }
      fullPages.push(page);
    }

    const fullCollections = [];
    for (const entry of collections) {
      const items = [];
      for (let offset = 0; ; ) {
        const listed = await this.read("list_items", { path: entry.path, limit: 200, offset });
        for (const { id, item } of listed.items) items.push({ ...item, id });
        offset += listed.items.length;
        if (listed.items.length === 0 || offset >= listed.total) break;
      }
      fullCollections.push({ path: entry.path, refs: entry.refs ?? {}, items });
    }

    const fullAssets = [];
    for (const asset of assets) {
      const { bytes, type } = await this.file(asset.url);
      fullAssets.push({ path: asset.path ?? null, filename: asset.filename, contentType: type || contentTypeOf(asset.filename), bytes });
    }

    return {
      site: { title: site.title, description: site.description, head: site.head, header: site.header, footer: site.footer, theme: site.theme },
      instructions: instructions.text,
      private: (site.private ?? []).map((entry) => entry.path),
      pages: fullPages,
      collections: fullCollections,
      assets: fullAssets,
    };
  }
}

function encodeQuery(args) {
  const pairs = [];
  const add = (name, value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) for (const inner of value) add(`${name}[]`, inner);
    else if (typeof value === "object") for (const [key, inner] of Object.entries(value)) add(`${name}[${key}]`, inner);
    else pairs.push([name, String(value)]);
  };
  for (const [name, value] of Object.entries(args)) add(name, value);
  return new URLSearchParams(pairs).toString();
}

const TYPES = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  ico: "image/x-icon", pdf: "application/pdf", json: "application/json", geojson: "application/geo+json",
  txt: "text/plain", css: "text/css", js: "text/javascript", html: "text/html", md: "text/markdown",
  woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf",
};

export function contentTypeOf(filename) {
  const ext = filename.toLowerCase().split(".").pop();
  return TYPES[ext] ?? "application/octet-stream";
}

// An export directory: content.json holds everything but the asset bytes, which sit beside it under
// assets/ at their own paths, or under assets/_hash/ for a file stored with no path.
const assetFile = (dir, asset) => join(dir, "assets", asset.path ? asset.path.replace(/^\//, "") : `_hash/${asset.sha256}-${asset.filename}`);

export async function readExport(dir) {
  const content = JSON.parse(await readFile(join(dir, "content.json"), "utf8"));
  for (const asset of content.assets) asset.bytes = await readFile(assetFile(dir, asset));
  return content;
}

export async function writeExport(dir, snapshot) {
  const assets = [];
  for (const asset of snapshot.assets) {
    const entry = { path: asset.path, filename: asset.filename, contentType: asset.contentType, sha256: sha256(asset.bytes) };
    const file = assetFile(dir, entry);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, asset.bytes);
    assets.push(entry);
  }
  await writeFile(join(dir, "content.json"), `${JSON.stringify({ ...snapshot, assets }, null, 2)}\n`);
}

// A token is named by the environment variable that holds it, never passed as a value.
function tokenFrom(envName, role) {
  if (!envName) throw new SiteError(`name the environment variable holding the ${role} token`);
  const token = process.env[envName];
  if (!token) throw new SiteError(`${envName} is not set, so there is no token for the ${role}.`);
  return token;
}

// A source is a site URL, read with the token in tokenEnv, or an export directory.
export async function openSource(name, tokenEnv) {
  if (/^https?:\/\//.test(name)) {
    const site = new Site(name, tokenFrom(tokenEnv, "source"));
    return { label: name, site, read: () => site.snapshot() };
  }
  return { label: `${name} (export)`, read: () => readExport(name) };
}

export function openTarget(name, tokenEnv) {
  if (!/^https?:\/\//.test(name ?? "")) throw new SiteError("--target must be a site URL.");
  return new Site(name, tokenFrom(tokenEnv, "target"));
}

// --name value pairs and bare --switches, the way both scripts take their arguments.
export function parseArgs(argv, switches = []) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new SiteError(`unexpected argument ${arg}`);
    const name = arg.slice(2);
    if (switches.includes(name)) options[name] = true;
    else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) options[name] = argv[++i];
    else throw new SiteError(`--${name} needs a value`);
  }
  return options;
}

// Stable JSON, so two values compare equal whatever order their keys came in.
export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

export const same = (a, b) => canonical(a) === canonical(b);

// Where a reader opens a path: the same rule as src/pages/path.ts pageHref, which the site's own
// templates use, so a rewritten link and a link a template builds always agree.
const SERVED_AS_IS = [
  "/assets", "/data", "/docs", "/p", "/preview", "/admin", "/api", "/login", "/signup", "/forgot", "/reset",
  "/consent", "/invites", "/tokens", "/mcp", "/.well-known", "/favicon.ico", "/robots.txt",
];
export function pageHref(value) {
  if (!value.startsWith("/") || value.startsWith("//")) return value;
  const at = value.search(/[?#]/);
  const path = at === -1 ? value : value.slice(0, at);
  const rest = at === -1 ? "" : value.slice(at);
  if (path === "/" || path === "/root" || path === "/root/") return `/${rest}`;
  if (SERVED_AS_IS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return value;
  return `/p${path}${rest}`;
}

// A link's new form, for the migration from sites that served pages at their own paths:
//   a literal internal link       /essay/x            -> /p/essay/x
//   a path a template completes   /{{ kind }}         -> /p/{{ kind }}
//   a link a template computes    {{ r.path }}        -> {{ r.path | page_url }}
// /assets, /data, /docs, outside addresses and fragments are left as written. It reads href, src and
// action attributes and markdown link targets; a code block other than a pages fence is prose and is
// left alone.
function rewriteValue(value) {
  const trimmed = value.trim();
  const output = /^\{\{-?\s*([\s\S]+?)\s*-?\}\}$/.exec(trimmed);
  if (output) return /\|\s*page_url\b/.test(output[1]) ? value : `{{ ${output[1]} | page_url }}`;
  if (trimmed.startsWith("/{{") || trimmed.startsWith("/{%")) return `/p${trimmed}`;
  if (trimmed.includes("{{") || trimmed.includes("{%")) return value;
  return pageHref(value);
}

function rewriteSpan(text, changes) {
  const note = (from, to) => {
    if (from !== to) changes.push({ from, to });
    return to;
  };
  return text
    .replace(/\b(href|src|action)(\s*=\s*)(["'])([^"']*)\3/g, (_, attr, eq, q, value) => `${attr}${eq}${q}${note(value, rewriteValue(value))}${q}`)
    .replace(/\]\((\/[^)\s]*)((?:\s+"[^"]*")?)\)/g, (_, value, title) => `](${note(value, pageHref(value))}${title})`);
}

export function rewriteLinks(source, format) {
  const changes = [];
  if (format === "html") return { text: rewriteSpan(source, changes), changes };
  // Markdown: only text and pages fences carry links a reader follows.
  const parts = source.split(/(^```[^\n]*\n[\s\S]*?^```[ \t]*$)/m);
  const text = parts
    .map((part) => (part.startsWith("```") && !/^```pages\b/.test(part) ? part : rewriteSpan(part, changes)))
    .join("");
  return { text, changes };
}

// The redirect each old page path needs, from a site that served pages at their own paths: the home page
// and the templates filed under /root were never addresses of their own, and / is unchanged. A private
// path gets none: a redirect answers anyone, so it would tell a stranger the path is there.
export function oldPathRedirects(content) {
  const isPrivate = (path) => content.private.some((scope) => path === scope || path.startsWith(`${scope}/`));
  return content.pages
    .map((page) => page.path)
    .filter((path) => path !== "/root" && !path.startsWith("/root/") && pageHref(path) !== path && !isPrivate(path))
    .map((path) => ({ from: path, to: pageHref(path) }));
}

// The whole content with every page's links in their new form, and the list of what changed.
export function rewriteContent(content) {
  const rewritten = [];
  const pages = content.pages.map((page) => {
    const live = rewriteLinks(page.content, page.format);
    for (const change of live.changes) rewritten.push({ page: page.path, ...change });
    const draft = page.draft ? rewriteLinks(page.draft.content, page.draft.format) : null;
    for (const change of draft?.changes ?? []) rewritten.push({ page: `${page.path} (draft)`, ...change });
    return { ...page, content: live.text, ...(page.draft ? { draft: { ...page.draft, content: draft.text } } : {}) };
  });
  return { content: { ...content, pages }, rewritten };
}

// The source's own absolute URLs, for a migration to a site at another address. A page or item that names
// its own site by https://old.host/... keeps working only while the old host serves it, and a browser on
// the new host refuses that fetch across origins, so each becomes root-relative, the page path taking
// its new form when links are rewritten too. A <meta> or <link> must stay absolute (og:url, og:image,
// canonical), so there it points at the target instead. Bare host names in prose are left alone.
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function rewriteUrls(text, from, to, mapPath, inTag, changes) {
  const host = new URL(from).host;
  const pattern = new RegExp(`https?://${escapeRegExp(host)}(?![\\w.-])([^\\s"'<>()\\]\\\`]*)`, "g");
  return text.replace(pattern, (url, rest, at) => {
    const path = mapPath(rest === "" || /^[?#]/.test(rest) ? `/${rest}` : rest);
    const replaced = inTag && /^<(meta|link)\b/i.test(text.slice(text.lastIndexOf("<", at), at)) ? `${to}${path}` : path;
    if (replaced !== url) changes.push({ from: url, to: replaced });
    return replaced;
  });
}

function rewriteValueUrls(value, from, to, mapPath, changes) {
  if (typeof value === "string") return rewriteUrls(value, from, to, mapPath, false, changes);
  if (Array.isArray(value)) return value.map((v) => rewriteValueUrls(v, from, to, mapPath, changes));
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewriteValueUrls(v, from, to, mapPath, changes)]));
  return value;
}

function rewritePageUrls(source, format, from, to, mapPath, changes) {
  if (format === "html") return rewriteUrls(source, from, to, mapPath, true, changes);
  const parts = source.split(/(^```[^\n]*\n[\s\S]*?^```[ \t]*$)/m);
  return parts
    .map((part) => (part.startsWith("```") && !/^```pages\b/.test(part) ? part : rewriteUrls(part, from, to, mapPath, true, changes)))
    .join("");
}

// The whole content with the source's own URLs made relative to wherever it lands, and what changed.
export function rewriteOwnUrls(content, from, to, { pagePaths = false } = {}) {
  const mapPath = pagePaths ? pageHref : (path) => path;
  const rewritten = [];
  const pages = content.pages.map((page) => {
    const changes = [];
    const text = rewritePageUrls(page.content, page.format, from, to, mapPath, changes);
    const draft = page.draft
      ? { ...page.draft, content: rewritePageUrls(page.draft.content, page.draft.format, from, to, mapPath, changes) }
      : undefined;
    for (const change of changes) rewritten.push({ where: page.path, ...change });
    return { ...page, content: text, ...(draft ? { draft } : {}) };
  });
  const collections = content.collections.map((collection) => ({
    ...collection,
    items: collection.items.map((item) => {
      const changes = [];
      const fields = rewriteValueUrls(item, from, to, mapPath, changes);
      for (const change of changes) rewritten.push({ where: `${collection.path}#${item.id}`, ...change });
      return fields;
    }),
  }));
  return { content: { ...content, pages, collections }, rewritten };
}

// What a migration writes, from what the source holds: its own URLs made relative unless keepOwnUrls,
// then its links in their /p form when rewriteLinks. Migrate and verify both call this, so verify
// expects exactly what migrate wrote. Each change is reported as a line.
export function migratedContent(content, { from, to, rewriteLinks: links = false, keepOwnUrls = false }) {
  const lines = [];
  let result = content;
  if (!keepOwnUrls && from) {
    const own = rewriteOwnUrls(result, from, to, { pagePaths: links });
    result = own.content;
    for (const r of own.rewritten) lines.push(`own URL in ${r.where}: ${r.from} -> ${r.to}`);
    lines.push(`rewrote ${own.rewritten.length} own URL${own.rewritten.length === 1 ? "" : "s"}`);
  }
  if (links) {
    const rewritten = rewriteContent(result);
    result = rewritten.content;
    for (const r of rewritten.rewritten) lines.push(`link in ${r.page}: ${r.from} -> ${r.to}`);
    lines.push(`rewrote ${rewritten.rewritten.length} link${rewritten.rewritten.length === 1 ? "" : "s"}`);
  }
  return { content: result, lines };
}
