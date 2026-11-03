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
      const error = new SiteError(`${tool} on ${this.url}: ${response.status} ${body.error ?? body.message ?? ""}`.trim());
      error.status = response.status;
      throw error;
    }
    return body;
  }

  read(tool, args) {
    return this.call(tool, args, { read: true });
  }

  async bytes(url) {
    const absolute = url.startsWith("http") ? url : `${this.url}${url}`;
    const response = await fetch(absolute, { headers: this.headers() });
    if (!response.ok) throw new SiteError(`GET ${absolute}: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
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
      const bytes = await this.bytes(asset.url);
      fullAssets.push({ path: asset.path ?? null, filename: asset.filename, contentType: contentTypeOf(asset.filename), bytes });
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

// A source named on the command line: a site URL, whose token is SOURCE_TOKEN, or an export directory.
export async function openSource(name) {
  if (/^https?:\/\//.test(name)) {
    const token = process.env.SOURCE_TOKEN;
    if (!token) throw new SiteError("SOURCE_TOKEN is not set for the source site.");
    return { label: name, read: () => new Site(name, token).snapshot() };
  }
  return { label: `${name} (export)`, read: () => readExport(name) };
}

export function openTarget(name) {
  if (!/^https?:\/\//.test(name)) throw new SiteError("The target must be a site URL.");
  const token = process.env.TARGET_TOKEN;
  if (!token) throw new SiteError("TARGET_TOKEN is not set for the target site.");
  return new Site(name, token);
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
