import { deleteAsset, listAssets, putAsset } from "../assets/service";
import { similarity } from "../data/match";
import { matchItem, parseQuery } from "../data/query";
import {
  deleteCollection,
  deleteItem,
  getCollection,
  listCollections,
  putItem,
  reorderItems,
  revOf,
} from "../data/service";
import { deletePage, deriveTitle, getPage, listPages, savePage } from "../pages/service";
import { isValidPath, normalizePath } from "../pages/path";
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
  return `${ctx.siteUrl}${path === "/" ? "" : path}`;
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

const ENVELOPE = "GET the url returns just the items array, without this envelope";

const REVS =
  "Every item carries a rev, a number that changes whenever that item changes. It is kept outside the stored JSON, " +
  "so it never appears in what the url serves. Pass the rev you read back as if_rev when you write, and a write " +
  "built on a stale read is refused instead of silently clobbering someone else's edit.";

function project(item: Item, fields: unknown): Record<string, unknown> {
  if (!Array.isArray(fields) || fields.length === 0) return item;
  const picked: Record<string, unknown> = { id: item.id };
  for (const field of fields) if (field !== "id") picked[String(field)] = item[String(field)];
  return picked;
}

export const TOOLS: ToolDefinition[] = [
  {
    name: "list_pages",
    title: "List pages",
    description: "List every page published on this site.",
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
    description: "Return the stored source of one page so it can be edited.",
    inputSchema: object({ path: { type: "string", description: "Page path, for example /about" } }, ["path"]),
    handler: async (args) => {
      const path = requirePath(args.path);
      const page = await getPage(path);
      if (!page) throw new Error(`No page exists at ${path}`);
      return JSON.stringify(
        { path: page.path, title: page.title, format: page.contentType, content: page.body },
        null,
        2,
      );
    },
  },
  {
    name: "publish_page",
    title: "Publish a page",
    description:
      "Create a page at a path. Markdown is rendered into the site theme; HTML is served exactly as written. Fails if the path is taken unless overwrite is true. " +
      "If the page lists repeating things, offer the owner a data collection first: keep the items in one with put_item and have the page fetch /data/<path>.json, so editing one of them later does not mean rewriting the page.",
    inputSchema: object(
      {
        path: { type: "string", description: "Page path, for example /about or / for the home page" },
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
      "Replace the content of an existing page. If you are rewriting the page only to change items in a list, move that list into a data collection instead and let the page fetch it.",
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
  {
    name: "delete_page",
    title: "Delete a page",
    description: "Remove a page permanently.",
    inputSchema: object({ path: { type: "string" } }, ["path"]),
    handler: async (args) => {
      const path = requirePath(args.path);
      if (!(await deletePage(path))) throw new Error(`No page exists at ${path}`);
      return `Deleted ${path}`;
    },
  },
  {
    name: "upload_asset",
    title: "Upload an asset",
    description: "Store an image or file and return its public URL for use on any page.",
    inputSchema: object(
      {
        filename: { type: "string" },
        content_base64: { type: "string", description: "File contents, base64 encoded" },
        content_type: { type: "string", description: "MIME type, for example image/png" },
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
      });
      return `${ctx.siteUrl}/assets/${asset.key}`;
    },
  },
  {
    name: "list_assets",
    title: "List assets",
    description: "List uploaded images and files with their public URLs.",
    inputSchema: object({}),
    handler: async (_args, ctx) => {
      const assets = await listAssets();
      if (assets.length === 0) return "No assets uploaded yet.";
      return assets.map((a) => `${a.filename}  ${ctx.siteUrl}/assets/${a.key}  (${a.size} bytes)`).join("\n");
    },
  },
  {
    name: "delete_asset",
    title: "Delete an asset",
    description: "Remove an uploaded file by its key.",
    inputSchema: object({ key: { type: "string" } }, ["key"]),
    handler: async (args) => {
      if (!(await deleteAsset(String(args.key)))) throw new Error(`No asset with key ${args.key}`);
      return `Deleted asset ${args.key}`;
    },
  },
  {
    name: "list_collections",
    title: "List data collections",
    description:
      "List every JSON data collection on this site with its item count and public URL. A collection is an ordered array of items a page fetches and renders. " +
      SERVING,
    inputSchema: object({}),
    handler: async (_args, ctx) => {
      const collections = await listCollections();
      if (collections.length === 0) return "No data collections yet. Use put_item to create one.";
      return collections
        .map((c) => `${c.path}  ${c.count} items  rev ${c.rev}  served at ${dataUrl(ctx, c.path)}`)
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
        },
        null,
        2,
      );
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
        null,
        2,
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
      "Remove one item from a collection by its id. The rest of the collection is untouched. Pass the rev you read as if_rev and the delete is refused if the item changed since.",
    inputSchema: object(
      {
        path: { type: "string" },
        id: { type: "string" },
        if_rev: { type: "number", description: "The rev you read for this item" },
      },
      ["path", "id"],
    ),
    handler: async (args) => {
      const path = requirePath(args.path);
      const ifRev = args.if_rev === undefined ? undefined : Number(args.if_rev);
      if (!(await deleteItem(path, String(args.id), ifRev))) throw new Error(`No item ${args.id} in ${path}`);
      return `Deleted ${args.id} from ${path}`;
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
      const items = await reorderItems(path, args.ids.map(String), ifRev);
      return `Order in ${path}: ${items.map((i) => i.id).join(", ")}`;
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
      return JSON.stringify({ total: matches.length, matches: matches.slice(0, limit) }, null, 2);
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

      const candidates = collection.items
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
          threshold,
          compared: candidates.length,
          skipped: collection.items.length - candidates.length,
          results,
        },
        null,
        2,
      );
    },
  },
  {
    name: "delete_collection",
    title: "Delete a collection",
    description: "Remove a whole data collection and every item in it.",
    inputSchema: object({ path: { type: "string" } }, ["path"]),
    handler: async (args) => {
      const path = requirePath(args.path);
      if (!(await deleteCollection(path))) throw new Error(`No collection exists at ${path}`);
      return `Deleted collection ${path}`;
    },
  },
  {
    name: "get_site",
    title: "Get site info",
    description: "Return the site title, description, address and page count.",
    inputSchema: object({}),
    handler: async (_args, ctx) => {
      const [settings, pages] = await Promise.all([getSettings(), listPages()]);
      return JSON.stringify(
        { title: settings.title, description: settings.description, url: ctx.siteUrl, pages: pages.length },
        null,
        2,
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
