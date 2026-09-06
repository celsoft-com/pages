import { assetUrlFor, putAsset } from "../assets/service";
import { assetEntries, bundleContents, collectionEntries, ROOT_IS_NOT_A_BUNDLE } from "../inventory";
import { similarity } from "../data/match";
import { matchItem, parseQuery } from "../data/query";
import {
  brokenRefs,
  deleteCollection,
  deleteItem,
  getCollection,
  listCollections,
  putItem,
  reorderItems,
  revOf,
  setRefs,
} from "../data/service";
import { deriveTitle, editPage, getPage, listPages, savePage, slicePage } from "../pages/service";
import {
  runTransfer,
  staleReferences,
  touchesHomePage,
  type Kind,
  type Scope,
  type Transfer,
  type Verb,
} from "../transfer";
import { ROOT_BUNDLE, isValidPath, normalizePath } from "../pages/path";
import { getSettings, saveSettings } from "../settings";
import type { Item } from "../types";

export interface ToolContext {
  siteUrl: string;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, any>, ctx: ToolContext) => Promise<string>;
}

function object(properties: Record<string, unknown>, required: string[] = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

function requirePath(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") throw new Error("path is required");
  const path = normalizePath(raw);
  if (!isValidPath(path))
    throw new Error(
      `path "${raw}" is not usable. Use lowercase letters, numbers, dashes and slashes, for example /about`,
    );
  return path;
}

function detectFormat(content: string, declared?: string): "markdown" | "html" {
  if (declared === "markdown" || declared === "html") return declared;
  return /^\s*(<!doctype html|<html[\s>])/i.test(content) ? "html" : "markdown";
}

function urlFor(ctx: ToolContext, path: string): string {
  return `${ctx.siteUrl}${path === "/" || path === ROOT_BUNDLE ? "" : path}`;
}

function dataUrl(ctx: ToolContext, path: string): string {
  return `${ctx.siteUrl}/data${path === "/" ? "/index" : path}.json`;
}

const SERVING =
  "How it is served: take the collection path, prefix /data and add .json. Collection /a/b is served at /data/a/b.json, " +
  "/products at /data/products.json. Paths are lowercased and any .json you pass is ignored, so /Products, products " +
  "and /products.json are all the collection /products; the address always uses the normalized path, which every reply " +
  "echoes back as url. A GET returns a bare JSON array of the items, with no wrapper object, and each served item " +
  "includes its id along with the fields you wrote. Array order is the collection order set by reorder_items and by " +
  "put_item's index, and is preserved exactly, so a page needs no sort field. Nested objects and arrays of objects are " +
  "stored and served unchanged. It is public, unauthenticated and cached for 60 seconds. " +
  "GET /data/_collections.json for the index of every collection: an array of {path, url, count, rev, updatedAt} " +
  "sorted by path, so a page can discover collections over plain HTTP with no access to these tools.";

const BUNDLES =
  "Organization is a folder tree and nothing more. A path is a bundle and holds everything at or under it: /trip " +
  "holds /trip/items, /trip/images/coburg.jpg and /trip/day1/items alike, and /trip/day1 holds that last one too. " +
  "Pages, collections and assets are all just resources at paths. None of them owns or belongs to another, there " +
  "is no owner and no owning page, and nothing is ever unfiled or ungrouped: a resource's own path already says " +
  "which bundles hold it, so publishing a page at /trip changes nothing about what is under /trip. Matching is on " +
  "whole path segments, so /bavaria does not hold /bavaria-lessons/lessons. One exception: / is not a bundle, " +
  "because it would hold the entire site. A resource may still sit at /, and what a browser gets at / is the page " +
  "in the /root bundle. This is organization only, never a boundary: nothing is rejected, moved or blocked by it, " +
  "any page may fetch any collection, and references may cross bundles.";

const ENVELOPE = "GET the url returns just the items array, without this envelope";

const REVS =
  "Every item carries a rev, a number that changes whenever that item changes. It is kept outside the stored JSON, " +
  "so it never appears in what the url serves. Pass the rev you read back as if_rev when you write, and a write " +
  "built on a stale read is refused instead of silently clobbering someone else's edit.";

function parseFilter(raw: unknown): [string, unknown][] {
  if (raw === undefined) return [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new Error("filter must be an object of field/value pairs");
  return Object.entries(raw as Record<string, unknown>);
}

function rankOf(value: unknown): number {
  if (value === null) return 0;
  if (typeof value === "number") return 1;
  if (typeof value === "boolean") return 2;
  return 3;
}

function compareValues(a: unknown, b: unknown): number {
  const [left, right] = [rankOf(a), rankOf(b)];
  if (left !== right) return left - right;
  if (left === 1) return (a as number) - (b as number);
  if (left === 2) return Number(a) - Number(b);
  if (left === 3) return String(a).localeCompare(String(b));
  return 0;
}

function project(item: Item, fields: unknown): Record<string, unknown> {
  if (!Array.isArray(fields) || fields.length === 0) return item;
  const picked: Record<string, unknown> = { id: item.id };
  for (const field of fields) if (field !== "id") picked[String(field)] = item[String(field)];
  return picked;
}

function refsOf(refs: Record<string, string>): string {
  const entries = Object.entries(refs);
  return entries.length === 0 ? "" : `  refs ${entries.map(([f, t]) => `${f}->${t}`).join(", ")}`;
}

const TRANSFER =
  "One shape at every level: page, collection, asset and bundle take the same arguments and return the same reply. " +
  "It runs on the server, so ids, array order, nested values, revs and reference declarations survive exactly and no " +
  "record passes through this conversation. Page content is never rewritten: the reply lists any page line still " +
  "naming a path that has gone, and any record left pointing at nothing. A copy or move refuses an occupied target " +
  "unless you pass overwrite, and changes nothing when it refuses.";

function resourceUrl(ctx: ToolContext, kind: Kind, path: string): string {
  if (kind === "page") return urlFor(ctx, path === ROOT_BUNDLE ? "/" : path);
  if (kind === "collection") return dataUrl(ctx, path);
  return `${ctx.siteUrl}/assets${path}`;
}

// A page verb takes the page and nothing else. The rest of its bundle stays exactly where it
// is, and saying so is the difference between a visible effect and a silent one.
async function restOfBundle(transfer: Transfer): Promise<{ kind: string; path: string }[]> {
  if (transfer.scope !== "page") return [];
  // / is not a bundle, so a page stored there has no rest of a bundle: it would be the site.
  if (transfer.from === "/") return [];
  const contents = await bundleContents(transfer.from);
  const taken = new Set(transfer.resources.flatMap((r) => (r.to === null ? [r.from] : [r.from, r.to])));
  return [
    ...contents.pages.map((p) => ({ kind: "page", path: p.path })),
    ...contents.collections.map((c) => ({ kind: "collection", path: c.path })),
    ...contents.assets.map((a) => ({ kind: "asset", path: a.path! })),
  ].filter((entry) => !taken.has(entry.path));
}

async function transferReply(ctx: ToolContext, transfer: Transfer): Promise<string> {
  const [stale, rest] = await Promise.all([staleReferences(transfer), restOfBundle(transfer)]);
  const notes: string[] = [];

  if (!transfer.applied)
    notes.push(`Nothing was changed. Call again with confirm: true to ${transfer.verb} all of this.`);
  else if (transfer.verb === "copy")
    notes.push(
      "The source is untouched. A copied page keeps the URLs written into its body, so it still fetches the " +
        "original's collections and assets until you edit it.",
    );
  else
    notes.push(
      stale.length === 0
        ? "No page names a path this removed. No page content was changed either way."
        : "No page content was changed. Every line listed in pages_to_update still names a path that has gone.",
    );

  if (rest.length > 0) notes.push("Everything in rest_of_bundle stayed exactly where it was.");
  if (touchesHomePage(transfer))
    notes.push(
      `${ROOT_BUNDLE} is the page a browser gets at /, so the site root now has no home page until you publish one.`,
    );

  return JSON.stringify(
    {
      operation: transfer.verb,
      scope: transfer.scope,
      from: transfer.from,
      ...(transfer.to === null ? {} : { to: transfer.to }),
      applied: transfer.applied,
      resources: transfer.resources.map((r) => ({
        kind: r.kind,
        from: r.from,
        to: r.to,
        ...(r.to === null ? {} : { url: resourceUrl(ctx, r.kind, r.to), replaced: r.replaced }),
        ...(r.title === undefined ? {} : { title: r.title }),
        ...(r.items === undefined ? {} : { items: r.items, rev: r.rev, refs: r.refs }),
        ...(r.bytes === undefined ? {} : { bytes: r.bytes }),
      })),
      breaks: transfer.breaks,
      pages_to_update: stale,
      ...(rest.length === 0 ? {} : { rest_of_bundle: rest }),
      notes,
    }
  );
}

function transferArgs(args: Record<string, any>, scope: Scope, verb: Verb) {
  return {
    scope,
    verb,
    from: String(verb === "delete" ? args.path : args.from),
    ...(verb === "delete" ? {} : { to: String(args.to) }),
    overwrite: args.overwrite === true,
    confirm: args.confirm === true,
    ifRev: args.if_rev === undefined ? undefined : Number(args.if_rev),
  };
}

function transferSchema(scope: Scope, verb: Verb, what: string) {
  const paths =
    verb === "delete"
      ? { path: { type: "string", description: `The ${what} to delete` } }
      : {
          from: { type: "string", description: `The ${what} to ${verb}` },
          to: { type: "string", description: `Path to ${verb} it to` },
        };
  return object(
    {
      ...paths,
      ...(verb === "delete"
        ? {}
        : { overwrite: { type: "boolean", description: "Replace whatever already sits at the target. Default false." } }),
      ...(scope === "bundle"
        ? {
            confirm: {
              type: "boolean",
              description: "Must be true to apply. Without it nothing changes and you get the inventory instead.",
            },
          }
        : {}),
      ...(scope === "collection"
        ? { if_rev: { type: "number", description: "Refuse unless the collection is still at this rev." } }
        : {}),
    },
    verb === "delete" ? ["path"] : ["from", "to"],
  );
}

function transferTool(scope: Scope, verb: Verb, spec: { title: string; what: string; lead: string }): ToolDefinition {
  return {
    name: `${verb}_${scope}`,
    title: spec.title,
    description: `${spec.lead} ${TRANSFER}${scope === "bundle" ? ` ${BUNDLES}` : ""}`,
    inputSchema: transferSchema(scope, verb, spec.what),
    handler: async (args, ctx) => transferReply(ctx, await runTransfer(transferArgs(args, scope, verb))),
  };
}

export const TOOLS: ToolDefinition[] = [
  {
    name: "list_pages",
    title: "List pages",
    description: "List every page published on this site. " + BUNDLES,
    inputSchema: object({}),
    handler: async (_args, ctx) => {
      const pages = await listPages();
      if (pages.length === 0) return "No pages published yet.";
      return pages.map((p) => `${p.path}  ${p.title}  (${p.contentType})  ${urlFor(ctx, p.path)}`).join("\n");
    },
  },
  {
    name: "get_page",
    title: "Read a page",
    description:
      "Return the stored source of one page so it can be edited. Pass find, or offset and limit, to read only the " +
      "part you are working on: the reply is then numbered lines rather than the whole document, which is what " +
      "edit_page wants and costs a fraction of reading a long page to change one line of it. " +
      BUNDLES,
    inputSchema: object(
      {
        path: { type: "string", description: "Page path, for example /about" },
        find: { type: "string", description: "Return only lines containing this text, ignoring case" },
        offset: { type: "number", description: "First line to return, 1 based. Ignored when find is given." },
        limit: { type: "number", description: "Maximum lines to return. Defaults to 200, which is also the cap." },
      },
      ["path"],
    ),
    handler: async (args) => {
      const path = requirePath(args.path);
      const page = await getPage(path);
      if (!page) throw new Error(`No page exists at ${path}`);

      const whole = args.find === undefined && args.offset === undefined && args.limit === undefined;
      if (whole)
        return JSON.stringify({ path: page.path, title: page.title, format: page.contentType, content: page.body });

      const slice = slicePage(page, {
        find: args.find === undefined ? undefined : String(args.find),
        offset: args.offset === undefined ? undefined : Number(args.offset),
        limit: args.limit === undefined ? undefined : Number(args.limit),
      });
      return JSON.stringify({
        path: page.path,
        title: page.title,
        format: page.contentType,
        total: slice.total,
        more: slice.more,
        lines: slice.lines,
      });
    },
  },
  {
    name: "edit_page",
    title: "Edit part of a page",
    description:
      "Replace an exact string in a published page and leave every other byte of it alone. Read the part you are " +
      "changing with get_page first, passing find or offset and limit, and copy the snippet from what it returns. " +
      "The edit is refused if the snippet matches nothing, and refused with a count if it matches more than once, " +
      "so pass enough surrounding text to name one spot, or all true to change every occurrence. " +
      "If you are editing the page to change items in a list, move that list into a data collection instead and " +
      "let the page fetch it. " +
      BUNDLES,
    inputSchema: object(
      {
        path: { type: "string", description: "Page path, for example /about" },
        find: { type: "string", description: "Exact text to replace, copied from get_page" },
        replace: { type: "string", description: "Text to put in its place. Empty string deletes the match." },
        all: { type: "boolean", description: "Replace every occurrence instead of refusing an ambiguous match" },
      },
      ["path", "find", "replace"],
    ),
    handler: async (args, ctx) => {
      const path = requirePath(args.path);
      if (typeof args.find !== "string") throw new Error("find is required");
      if (typeof args.replace !== "string") throw new Error("replace is required");

      const { page, replaced, lines } = await editPage({
        path,
        find: args.find,
        replace: args.replace,
        all: args.all === true,
      });
      const where = lines.length > 3 ? `${lines.slice(0, 3).join(", ")} and ${lines.length - 3} more` : lines.join(", ");
      return `Replaced ${replaced} occurrence${replaced === 1 ? "" : "s"} at line ${where} in ${urlFor(ctx, page.path)}`;
    },
  },
  {
    name: "publish_page",
    title: "Publish a page",
    description:
      "Create a page at a path. Markdown is rendered into the site theme; HTML is served exactly as written. Fails if the path is taken unless overwrite is true. " +
      "If the page lists repeating things, offer the owner a data collection first: keep the items in one with put_item and have the page fetch /data/<path>.json, so editing one of them later does not mean rewriting the page. " +
      BUNDLES,
    inputSchema: object(
      {
        path: {
          type: "string",
          description: `Page path, for example /about. The page at ${ROOT_BUNDLE} is what a browser gets at /.`,
        },
        content: { type: "string", description: "Markdown or a full HTML document" },
        format: { type: "string", enum: ["markdown", "html"], description: "Defaults to auto-detect" },
        title: { type: "string", description: "Defaults to the first heading" },
        overwrite: { type: "boolean", description: "Replace an existing page at this path" },
      },
      ["path", "content"],
    ),
    handler: async (args, ctx) => {
      const path = requirePath(args.path);
      if (typeof args.content !== "string" || args.content.length === 0)
        throw new Error("content is required");
      if ((await getPage(path)) && args.overwrite !== true)
        throw new Error(`A page already exists at ${path}. Pass overwrite: true to replace it.`);

      const page = await savePage({
        path,
        contentType: detectFormat(args.content, args.format),
        title: typeof args.title === "string" && args.title ? args.title : deriveTitle(args.content, path),
        body: args.content,
      });
      return `Published ${page.title} at ${urlFor(ctx, page.path)}`;
    },
  },
  {
    name: "update_page",
    title: "Update a page",
    description:
      "Replace the content of an existing page. If you are rewriting the page only to change items in a list, move that list into a data collection instead and let the page fetch it. " +
      BUNDLES,
    inputSchema: object({ path: { type: "string" }, content: { type: "string" }, title: { type: "string" } }, [
      "path",
      "content",
    ]),
    handler: async (args, ctx) => {
      const path = requirePath(args.path);
      const existing = await getPage(path);
      if (!existing) throw new Error(`No page exists at ${path}. Use publish_page to create it.`);
      if (typeof args.content !== "string" || args.content.length === 0)
        throw new Error("content is required");

      const page = await savePage({
        path,
        contentType: detectFormat(args.content, existing.contentType),
        title: typeof args.title === "string" && args.title ? args.title : existing.title,
        body: args.content,
      });
      return `Updated ${urlFor(ctx, page.path)}`;
    },
  },
  transferTool("page", "copy", {
    title: "Copy a page",
    what: "page",
    lead:
      "Duplicate a page at another path, body byte for byte. The copy keeps every URL written into its body, so it " +
      "fetches the original's collections and assets until you edit it, and it owns whatever already sits under its " +
      "new path.",
  }),
  transferTool("page", "move", {
    title: "Move or rename a page",
    what: "page",
    lead:
      "Rename a page. Collections and assets under its old path stay exactly where they are and only change owner; " +
      "the reply names every one of them. The old URL stops resolving at once, so any link to it breaks. To take a " +
      "page and its data together, use move_bundle.",
  }),
  transferTool("page", "delete", {
    title: "Delete a page",
    what: "page",
    lead:
      "Remove one page. Collections and assets under its path are left exactly as they are; only their owner " +
      "changes, to whatever page remains above them or to none, and the reply names every one of them. To delete a " +
      "page together with everything under it, use delete_bundle.",
  }),
  {
    name: "upload_asset",
    title: "Upload an asset",
    description:
      "Store an image or file and return its public URL for use on any page. Pass path to file it into a bundle; " +
      "without one it is stored under a content hash, which keeps working forever but sits in no bundle. " +
      "An image uploaded to /root/favicon.ico, .svg, .png, .webp or .jpg becomes the site icon, served at " +
      "/favicon.ico; until one is uploaded the site serves a built-in default. " +
      BUNDLES,
    inputSchema: object(
      {
        filename: { type: "string" },
        content_base64: { type: "string", description: "File contents, base64 encoded" },
        content_type: { type: "string", description: "MIME type, for example image/png" },
        path: {
          type: "string",
          description:
            "Optional path to file this asset under, for example /germanfunstuff/images/coburg.jpg. It is served " +
            "at /assets plus that path, and sits in the bundle that path names.",
        },
      },
      ["filename", "content_base64", "content_type"],
    ),
    handler: async (args, ctx) => {
      if (typeof args.content_base64 !== "string") throw new Error("content_base64 is required");
      const binary = atob(args.content_base64);
      const bytes = new Uint8Array(new ArrayBuffer(binary.length));
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const asset = await putAsset({
        filename: String(args.filename),
        contentType: String(args.content_type),
        bytes: bytes.buffer,
        path: args.path === undefined ? undefined : String(args.path),
      });
      const url = `${ctx.siteUrl}${assetUrlFor(asset)}`;
      return asset.path ? `${url}\npath ${asset.path}` : url;
    },
  },
  {
    name: "list_assets",
    title: "List assets",
    description:
      "List uploaded images and files with their public URLs and, where they have one, their bundle path. " +
      BUNDLES,
    inputSchema: object({}),
    handler: async (_args, ctx) => {
      const assets = await assetEntries();
      if (assets.length === 0) return "No assets uploaded yet.";
      return assets
        .map(
          (a) =>
            `${a.filename}  ${ctx.siteUrl}/assets/${a.path ? a.path.replace(/^\//, "") : a.key}  (${a.size} bytes)` +
            `${a.path ? `  in ${a.path}` : "  stored under a content hash, in no bundle"}`,
        )
        .join("\n");
    },
  },
  transferTool("asset", "copy", {
    title: "Copy an asset",
    what: "asset path",
    lead:
      "Duplicate a stored file at another path, bytes unchanged. An asset stored under a content hash has no path " +
      "to copy from; upload it again with a path instead.",
  }),
  transferTool("asset", "move", {
    title: "Move or rename an asset",
    what: "asset path",
    lead:
      "Rename a stored file. Its old /assets URL stops resolving at once, so every page holding that URL breaks " +
      "until you edit it; the reply gives the lines. An asset stored under a content hash has no path and cannot be " +
      "moved to one.",
  }),
  transferTool("asset", "delete", {
    title: "Delete an asset",
    what: "asset path, or hash key for an older upload",
    lead: "Remove one stored file, by its path or, for one uploaded before paths existed, by its content hash key.",
  }),
  {
    name: "list_bundle",
    title: "List a bundle",
    description:
      "List every page, collection and asset at or under one path, each with the page that owns it. Includes " +
      "resources owned by deeper pages, and those deeper pages themselves. Use it to see everything one page's " +
      "content is made of. " +
      BUNDLES,
    inputSchema: object(
      { path: { type: "string", description: "Bundle path, for example /germanfunstuff. It need not have a page." } },
      ["path"],
    ),
    handler: async (args, ctx) => {
      const path = requirePath(args.path);
      if (path === "/") throw new Error(ROOT_IS_NOT_A_BUNDLE);
      const [contents, page] = await Promise.all([bundleContents(path), getPage(path)]);

      const pages: string[] = [];
      for (const entry of contents.pages)
        pages.push(`page ${entry.path}  ${entry.title}  ${urlFor(ctx, entry.path)}`);

      const resources: string[] = [];
      for (const c of contents.collections)
        resources.push(
          `collection ${c.path}  ${c.count} items  rev ${c.rev}${refsOf(c.refs)}  ${dataUrl(ctx, c.path)}`,
        );
      for (const a of contents.assets)
        resources.push(
          `asset ${a.path}  ${a.size} bytes  ${ctx.siteUrl}/assets/${a.path!.replace(/^\//, "")}`,
        );

      // A page that owns nothing and a path where nothing exists are different situations.
      if (!page && pages.length === 0 && resources.length === 0)
        throw new Error(
          `Nothing is published at ${path}: no page there, and no collection or asset under it. ` +
            `Call list_pages or list_collections to see what does exist.`,
        );

      const out: string[] = [];
      if (!page) out.push(`No page is published at ${path}. These are grouped under it by path alone.`);

      out.push(...pages, ...resources);
      if (page && resources.length === 0) out.push(`Nothing else is in ${path} yet.`);
      return out.join("\n");
    },
  },
  transferTool("bundle", "copy", {
    title: "Copy a bundle",
    what: "bundle path",
    lead:
      "Duplicate everything at and under one path in a single operation: the page there, every page beneath it, " +
      "every collection and every asset. A reference from one copied collection to another is rewritten to the new " +
      "path, so the copy is internally consistent; one pointing outside the bundle is left alone. Called without " +
      "confirm: true it copies nothing and returns the full inventory it would write.",
  }),
  transferTool("bundle", "move", {
    title: "Move or rename a bundle",
    what: "bundle path",
    lead:
      "Move everything at and under one path in a single operation, keeping a page together with the collections " +
      "and assets it renders. This is the whole-site rename: one call, nothing read into this conversation, every " +
      "id, position, rev and reference preserved. References between collections in the bundle are rewritten to the " +
      "new paths; references from outside it break, and the reply names them. Called without confirm: true it moves " +
      "nothing and returns the full inventory it would move.",
  }),
  transferTool("bundle", "delete", {
    title: "Delete a bundle",
    what: "bundle path",
    lead:
      "Delete everything at and under one path: the page there, every page beneath it, every collection and every " +
      "asset. This is the only tool that deletes more than one thing, and it cannot be undone. Called without " +
      "confirm: true it deletes nothing and returns the full inventory it would delete, including records in other " +
      "bundles that reference ids it would remove; read that before confirming. To remove only the page and leave " +
      "its data alone, use delete_page.",
  }),
  {
    name: "list_collections",
    title: "List data collections",
    description:
      "List every JSON data collection on this site with its item count and public URL. " +
      "A collection is an ordered array of items a page fetches and renders. " +
      BUNDLES +
      " " +
      SERVING,
    inputSchema: object({}),
    handler: async (_args, ctx) => {
      const collections = await collectionEntries();
      if (collections.length === 0) return "No data collections yet. Use put_item to create one.";
      return collections
        .map((c) => {
          const refs = Object.entries(c.refs);
          const declared = refs.length > 0 ? `  refs ${refs.map(([f, t]) => `${f}->${t}`).join(", ")}` : "";
          return (
            `${c.path}  ${c.count} items  rev ${c.rev}${declared}  served at ${dataUrl(ctx, c.path)}`
          );
        })
        .join("\n");
    },
  },
  {
    name: "list_items",
    title: "List items in a collection",
    description:
      "Return items from a collection in order. Ask for only the fields you need and page with limit and offset; the whole collection is rarely worth reading. " +
      "The reply wraps the items in an envelope with the collection total, its public url and a rev for each item; the url itself serves the bare array. " +
      SERVING +
      " " +
      REVS,
    inputSchema: object(
      {
        path: { type: "string", description: "Collection path, for example /products" },
        fields: {
          type: "array",
          items: { type: "string" },
          description: "Field names to include. Defaults to every field. id is always included.",
        },
        limit: { type: "number", description: "Maximum items to return. Defaults to 50." },
        offset: { type: "number", description: "Items to skip. Defaults to 0." },
      },
      ["path"],
    ),
    handler: async (args, ctx) => {
      const path = requirePath(args.path);
      const collection = await getCollection(path);
      if (!collection) throw new Error(`No collection exists at ${path}. Use put_item to create it.`);

      const offset = Math.max(0, Number(args.offset) || 0);
      const limit = Math.max(1, Number(args.limit) || 50);
      const page = collection.items.slice(offset, offset + limit);

      return JSON.stringify(
        {
          path: collection.path,
          url: dataUrl(ctx, collection.path),
          served: ENVELOPE,
          rev: collection.rev,
          total: collection.items.length,
          offset,
          items: page.map((item) => ({ id: item.id, rev: revOf(collection, item.id), item: project(item, args.fields) })),
        });
    },
  },
  {
    name: "count_items",
    title: "Count items by field",
    description:
      "Count records grouped by one or more fields, without reading them. " +
      "Use this when the question is about the shape of a collection rather than its contents: what is missing, what is thin, where coverage is uneven, how many of each kind there are. " +
      "Gaps show up as combinations that return no row, so this answers \"what haven't we covered\" as well as \"how many\". " +
      "Reach for it before proposing additions to a collection, so suggestions target the actual holes rather than areas already well covered. " +
      "Prefer it over list_items whenever you only need counts: on a collection of a few hundred records the response is a small table rather than tens of kilobytes, and it does not fill your context with prose you will not use. " +
      "Use list_items when you need record contents, search_items when looking for particular records, and match_names when checking whether one specific thing already exists. " +
      "On collections of only a few dozen records this is not worth it; the value scales with size and is substantial by a couple of hundred.",
    inputSchema: object(
      {
        path: { type: "string", description: "Collection to aggregate, for example /trip/items" },
        group_by: {
          type: "array",
          items: { type: "string" },
          description: "Field names to group by, at most 3, applied in the order given",
        },
        filter: {
          type: "object",
          additionalProperties: true,
          description:
            "Count only records where every named field equals the given value. Exact equality, combined with AND, the same as the match_names filter.",
        },
      },
      ["path", "group_by"],
    ),
    handler: async (args) => {
      const path = requirePath(args.path);
      if (!Array.isArray(args.group_by) || args.group_by.length === 0)
        throw new Error("group_by must be a non-empty array of field names");
      if (args.group_by.length > 3)
        throw new Error(`group_by holds ${args.group_by.length} fields; 3 is the most that can be grouped at once`);

      const fields = args.group_by.map(String);
      const filter = parseFilter(args.filter);

      const collection = await getCollection(path);
      if (!collection) throw new Error(`No collection exists at ${path}. Nothing to count.`);

      const inScope = collection.items.filter((item) => filter.every(([key, value]) => item[key] === value));

      for (const item of inScope)
        for (const field of fields) {
          const value = item[field];
          if (typeof value === "object" && value !== null)
            throw new Error(
              `Field "${field}" holds ${Array.isArray(value) ? "an array" : "an object"} on item "${item.id}", ` +
                `so it cannot be grouped. Group on a short scalar field instead.`,
            );
        }

      const groups = new Map<string, { values: unknown[]; count: number }>();
      for (const item of inScope) {
        const values = fields.map((field) => (item[field] === undefined ? null : item[field]));
        const key = JSON.stringify(values);
        const found = groups.get(key);
        if (found) {
          found.count++;
          continue;
        }
        if (groups.size === 1000)
          throw new Error(
            `Grouping by ${fields.join(", ")} produces more than 1000 combinations. ` +
              `Pass a filter to narrow the collection, or group by fewer fields.`,
          );
        groups.set(key, { values, count: 1 });
      }

      const rows = [...groups.values()]
        .sort((a, b) => {
          for (let i = 0; i < fields.length; i++) {
            const order = compareValues(a.values[i], b.values[i]);
            if (order !== 0) return order;
          }
          return 0;
        })
        .map(({ values, count }) => ({
          ...Object.fromEntries(fields.map((field, i) => [field, values[i]])),
          count,
        }));

      return JSON.stringify({
        path: collection.path,
        total: inScope.length,
        group_by: fields,
        ...(filter.length > 0 ? { filter: Object.fromEntries(filter) } : {}),
        rows,
      });
    },
  },
  {
    name: "get_item",
    title: "Read one item",
    description: "Return a single item from a collection by its id, with the rev to pass back as if_rev when you write. " + REVS,
    inputSchema: object({ path: { type: "string" }, id: { type: "string" } }, ["path", "id"]),
    handler: async (args, ctx) => {
      const path = requirePath(args.path);
      const collection = await getCollection(path);
      const item = collection?.items.find((i) => i.id === String(args.id));
      if (!item) throw new Error(`No item ${args.id} in ${path}`);
      return JSON.stringify(
        { path, url: dataUrl(ctx, path), id: item.id, rev: revOf(collection!, item.id), item },
      );
    },
  },
  {
    name: "put_item",
    title: "Create or update an item",
    description:
      "Write one item without rewriting the collection. By default the given fields are merged into the existing item and everything else is left alone; pass merge false to replace it outright. Creates the collection when it does not exist. Omit id to append a new item with a generated id. " +
      "Updating an item needs the if_rev you read from get_item, list_items or search_items, so a write from a stale read is refused rather than clobbering a newer one; pass overwrite true only when you mean to discard whatever is there. " +
      "fields takes any JSON value, nested objects and arrays of objects included, and they round-trip unchanged. Merging is shallow: a nested object or array you pass replaces the stored one outright rather than being merged key by key, so send the whole nested value. " +
      SERVING +
      " " +
      REVS,
    inputSchema: object(
      {
        path: { type: "string", description: "Collection path, for example /products" },
        id: { type: "string", description: "Item id. Omit to create a new item." },
        fields: { type: "object", description: "Field values to write", additionalProperties: true },
        merge: { type: "boolean", description: "Merge into the existing item. Defaults to true." },
        index: { type: "number", description: "Position in the collection. Defaults to the end for new items." },
        if_rev: {
          type: "number",
          description:
            "The rev you read for this item. Required to update an existing item, and the write is refused if the item has changed since. Leave it out when creating.",
        },
        overwrite: {
          type: "boolean",
          description: "Update an existing item without checking its rev. Use only when you mean to discard whatever is there.",
        },
      },
      ["path", "fields"],
    ),
    handler: async (args, ctx) => {
      const path = requirePath(args.path);
      if (typeof args.fields !== "object" || args.fields === null || Array.isArray(args.fields))
        throw new Error("fields must be an object");

      const { item, created, rev } = await putItem({
        path,
        id: args.id === undefined ? undefined : String(args.id),
        fields: args.fields as Record<string, unknown>,
        merge: args.merge !== false,
        index: args.index === undefined ? undefined : Number(args.index),
        ifRev: args.if_rev === undefined ? undefined : Number(args.if_rev),
        overwrite: args.overwrite === true,
      });
      return `${created ? "Created" : "Updated"} ${item.id} at rev ${rev} in collection ${path}, served at ${dataUrl(ctx, path)}`;
    },
  },
  {
    name: "delete_item",
    title: "Delete an item",
    description:
      "Remove one item from a collection by its id. The rest of the collection is untouched. Pass the rev you read as if_rev and the delete is refused if the item changed since. " +
      "If other records reference this id through a declared collection reference, the delete is refused and names how many; repoint those records first, or pass force true to orphan them deliberately. " +
      "When force orphans records, the reply lists what it broke, so they can be repointed without a separate check_refs.",
    inputSchema: object(
      {
        path: { type: "string" },
        id: { type: "string" },
        if_rev: { type: "number", description: "The rev you read for this item" },
        force: {
          type: "boolean",
          description: "Delete even though other records reference this id, leaving them pointing at nothing",
        },
      },
      ["path", "id"],
    ),
    handler: async (args) => {
      const path = requirePath(args.path);
      const ifRev = args.if_rev === undefined ? undefined : Number(args.if_rev);
      const id = String(args.id);
      const { deleted, orphaned } = await deleteItem(path, id, ifRev, args.force === true);
      if (!deleted) throw new Error(`No item ${id} in ${path}`);
      if (orphaned.length === 0) return `Deleted ${id} from ${path}`;
      return JSON.stringify({ deleted: id, path, orphaned });
    },
  },
  {
    name: "reorder_items",
    title: "Reorder a collection",
    description:
      "Move the given ids to the front of the collection, in the order listed. Items left out keep their relative order behind them, so moving one item to the top only needs one id. " +
      "Pass the collection rev as if_rev and the reorder is refused if the collection changed since you read it.",
    inputSchema: object(
      {
        path: { type: "string" },
        ids: { type: "array", items: { type: "string" }, description: "Ids in the order they should appear" },
        if_rev: {
          type: "number",
          description: "The collection rev you read from list_items or list_collections",
        },
      },
      ["path", "ids"],
    ),
    handler: async (args) => {
      const path = requirePath(args.path);
      if (!Array.isArray(args.ids) || args.ids.length === 0) throw new Error("ids must be a non-empty array");
      const ifRev = args.if_rev === undefined ? undefined : Number(args.if_rev);
      const moved = args.ids.map(String);
      const items = await reorderItems(path, moved, ifRev);
      const rest = items.length - moved.length;
      // Naming the ids that did not move would return the whole collection to answer a call that named one item.
      return `Order in ${path}: ${moved.join(", ")}${
        rest > 0 ? `, then the other ${rest} item${rest === 1 ? "" : "s"} in their previous order` : ""
      }.`;
    },
  },
  {
    name: "search_items",
    title: "Search items",
    description:
      "Find items across one collection or all of them. Returns each match with its collection path, id and rev so it can be edited straight away with put_item or delete_item. " +
      "Query syntax: bare words match any field; field:value matches part of a field; field=value matches it exactly; field>10, field<10, field>=10 and field<=10 compare numbers; " +
      'field!=value excludes; has:field requires the field to be set; -term excludes matches; "quoted words" match a phrase. Terms combine with AND, and dotted paths reach nested fields.',
    inputSchema: object(
      {
        query: { type: "string", description: 'For example: status=draft price>10 -sale has:image "winter coat"' },
        path: { type: "string", description: "Collection to search. Defaults to every collection." },
        fields: { type: "array", items: { type: "string" }, description: "Field names to include in results" },
        limit: { type: "number", description: "Maximum matches to return. Defaults to 25." },
      },
      ["query"],
    ),
    handler: async (args, ctx) => {
      if (typeof args.query !== "string" || args.query.trim() === "") throw new Error("query is required");
      const terms = parseQuery(args.query);
      const limit = Math.max(1, Number(args.limit) || 25);

      const paths = args.path
        ? [requirePath(args.path)]
        : (await listCollections()).map((c) => c.path);

      const matches: Record<string, unknown>[] = [];
      for (const path of paths) {
        const collection = await getCollection(path);
        if (!collection) continue;
        collection.items.forEach((item, index) => {
          if (matchItem(item, terms))
            matches.push({
              path,
              url: dataUrl(ctx, path),
              id: item.id,
              rev: revOf(collection, item.id),
              index,
              item: project(item, args.fields),
            });
        });
      }

      if (matches.length === 0) return `No items match ${args.query}`;
      return JSON.stringify({ total: matches.length, matches: matches.slice(0, limit) });
    },
  },
  {
    name: "match_names",
    title: "Find existing items by name",
    description:
      "Check a batch of candidate names against a collection before creating anything, so the same entity is not added twice under a different spelling. " +
      "Matching ignores case, diacritics, punctuation and word order, and tolerates trailing qualifiers and abbreviations that prefix the full word, " +
      "so \"Acme Corp.\" finds \"ACME Corporation\" and \"Cafe Rouge\" finds \"Café Rouge\". " +
      "It compares one short field, by default name, and does not read descriptions or other long text, which mention other entities and generate false matches. " +
      "When a collection is partitioned by another field, pass filter to compare only within one partition, for example filter {\"section\": \"coburg\"} so Coburg candidates are never matched against Bamberg records. " +
      "The same name legitimately recurs once per partition, and without a filter those come back as duplicates. " +
      "Returns a result for every candidate in the order given, each with its matches sorted best first and an empty list where nothing was close enough. " +
      "A match carries the id and rev, so a duplicate can be updated with put_item instead of created. " +
      "Nothing here understands meaning, translation or transliteration between scripts: it compares how names are written. " +
      "Treat a result as a candidate to judge, not a verdict, and remember a missed match leaves a visible duplicate while a wrong one silently swallows a record that should have been created.",
    inputSchema: object(
      {
        path: { type: "string", description: "Collection to match against, for example /venues" },
        names: {
          type: "array",
          items: { type: "string" },
          description: "Candidate names to look for, at most 50 per call",
        },
        field: { type: "string", description: "Field to compare against. Defaults to name." },
        filter: {
          type: "object",
          additionalProperties: true,
          description:
            "Compare only records where every named field equals the given value. Exact equality, combined with AND, and the values are not normalized the way the match field is, because these are identifiers rather than prose. Omit to compare against the whole collection.",
        },
        threshold: { type: "number", description: "Lowest score worth returning, 0 to 1. Defaults to 0.6." },
        limit_per_name: { type: "number", description: "Most matches to return per candidate. Defaults to 3." },
      },
      ["path", "names"],
    ),
    handler: async (args) => {
      const path = requirePath(args.path);
      if (!Array.isArray(args.names) || args.names.length === 0)
        throw new Error("names must be a non-empty array of strings");
      if (args.names.length > 50) throw new Error(`names holds ${args.names.length} entries; 50 is the most per call`);

      const collection = await getCollection(path);
      if (!collection) throw new Error(`No collection exists at ${path}. Nothing to match against.`);

      const field = typeof args.field === "string" && args.field ? args.field : "name";
      const threshold = args.threshold === undefined ? 0.6 : Math.min(1, Math.max(0, Number(args.threshold)));
      const limit = Math.max(1, Number(args.limit_per_name) || 3);

      const filter = parseFilter(args.filter);

      const inScope = collection.items.filter((item) => filter.every(([key, value]) => item[key] === value));
      const candidates = inScope
        .map((item) => ({ item, value: item[field] }))
        .filter((entry): entry is { item: Item; value: string } => typeof entry.value === "string");

      const results = args.names.map((raw) => {
        const name = String(raw);
        const matches = candidates
          .map(({ item, value }) => ({
            id: item.id,
            value,
            rev: revOf(collection, item.id),
            score: Math.round(similarity(name, value) * 1000) / 1000,
          }))
          .filter((match) => match.score >= threshold)
          .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
          .slice(0, limit);
        return { name, matches };
      });

      return JSON.stringify(
        {
          path: collection.path,
          field,
          ...(filter.length > 0 ? { filter: Object.fromEntries(filter) } : {}),
          threshold,
          compared: candidates.length,
          skipped: inScope.length - candidates.length,
          results,
        });
    },
  },
  {
    name: "set_collection_refs",
    title: "Constrain a field to ids in another collection",
    description:
      "Declare that a field on this collection holds ids from another collection, so writes with a mistyped or stale value are rejected instead of stored. " +
      "Use this whenever records carry a value that must line up with something else: a category, a section, a status, an owner. " +
      "Without it, a typo in such a field is silent at every level. The record stores, the JSON stays valid, the page renders, and the record simply stops appearing wherever that value is used to select it. " +
      "Nobody finds out until someone goes looking for something they know should be there. " +
      "Declare the constraint when you create the collection, before the records exist, because the cost of adopting it later is auditing everything already written.",
    inputSchema: object(
      {
        path: { type: "string", description: "Collection being constrained, for example /trip/items" },
        refs: {
          type: "object",
          additionalProperties: { type: "string" },
          description:
            'Field name to referenced collection path, for example {"group": "/trip/filters"}. An empty object clears every constraint.',
        },
      },
      ["path", "refs"],
    ),
    handler: async (args) => {
      const path = requirePath(args.path);
      if (typeof args.refs !== "object" || args.refs === null || Array.isArray(args.refs))
        throw new Error("refs must be an object of field name to collection path");

      const { refs, violations, missing } = await setRefs(path, args.refs as Record<string, string>);
      const declared = Object.entries(refs);

      if (declared.length === 0) return `Cleared every reference constraint on ${path}.`;

      const lines = [
        `${path}: ${declared.map(([field, target]) => `${field} references ids in ${target}`).join(", ")}.`,
        violations === 0
          ? "No existing record violates that."
          : violations === 1
            ? "1 existing record already violates it; run check_refs to see it."
            : `${violations} existing records already violate it; run check_refs to see them.`,
      ];
      if (missing.length > 0)
        lines.push(`Note that ${missing.join(" and ")} does not exist yet, so every value will be rejected until it does.`);
      return lines.join(" ");
    },
  },
  {
    name: "check_refs",
    title: "Find broken references",
    description:
      "Find records whose reference fields point at ids that do not exist. " +
      "This only checks fields declared with set_collection_refs; if a collection has none declared, nothing is checked and the reply says so rather than reporting a clean bill of health. " +
      "Check refs_declared to see what was actually verified before trusting an empty result. " +
      "Run it after any bulk load, after deleting or renaming ids in a referenced collection, and whenever count_items shows an unexpected value in a grouping, since a group of one is usually a typo rather than a real category. " +
      "Declaring the reference is the stronger fix where the collection is new enough to allow it, because put_item then rejects the bad value at the moment it is written; this audit is for records created before the constraint existed.",
    inputSchema: object(
      {
        path: { type: "string", description: "Collection to audit" },
        field: { type: "string", description: "One reference field. Omit to check every declared reference." },
      },
      ["path"],
    ),
    handler: async (args) => {
      const path = requirePath(args.path);
      const field = args.field === undefined ? undefined : String(args.field);
      return JSON.stringify(await brokenRefs(path, field));
    },
  },
  transferTool("collection", "copy", {
    title: "Copy a collection",
    what: "collection",
    lead:
      "Duplicate a collection at another path with every id, position and nested value intact. The copy is a new " +
      "collection, so its items start at fresh revs and the source keeps its own. Reference declarations come with " +
      "it, pointing where they pointed.",
  }),
  transferTool("collection", "move", {
    title: "Move or rename a collection",
    what: "collection",
    lead:
      "Rename a collection, keeping every id, position, nested value and item rev. Its /data URL stops serving the " +
      "moment this returns, so every page fetching it breaks until you edit that page; the reply gives the lines. " +
      "When you cannot take that gap, copy_collection instead, repoint the page, check it renders, then " +
      "delete_collection. To move a collection together with the page that renders it, use move_bundle.",
  }),
  transferTool("collection", "delete", {
    title: "Delete a collection",
    what: "collection",
    lead:
      "Remove a whole collection and every item in it. Records in other collections that reference its ids are " +
      "listed in the reply, because they are about to point at nothing.",
  }),
  {
    name: "get_site",
    title: "Get site info",
    description: "Return the site title, description, address and page count.",
    inputSchema: object({}),
    handler: async (_args, ctx) => {
      const [settings, pages] = await Promise.all([getSettings(), listPages()]);
      return JSON.stringify(
        { title: settings.title, description: settings.description, url: ctx.siteUrl, pages: pages.length },
      );
    },
  },
  {
    name: "set_site_info",
    title: "Set site title and description",
    description: "Update the site title and description shown in the header of every themed page.",
    inputSchema: object({ title: { type: "string" }, description: { type: "string" } }),
    handler: async (args) => {
      await saveSettings({
        ...(typeof args.title === "string" ? { title: args.title } : {}),
        ...(typeof args.description === "string" ? { description: args.description } : {}),
      });
      return "Site info updated.";
    },
  },
];
