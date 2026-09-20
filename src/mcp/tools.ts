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
import { geocodeQuery, parsePrefer, parseProfile, parseStops, routeToAsset } from "../geo/service";
import { PREFERS, PROFILES } from "../geo/providers";
import { deriveTitle, editPage, getPage, listPages, noPageAt, savePage, slicePage } from "../pages/service";
import {
  privacyChanges,
  restOfBundle,
  runTransfer,
  staleReferences,
  type Kind,
  type Scope,
  type Transfer,
  type Verb,
} from "../transfer";
import { ROOT_BUNDLE, isValidPath, normalizePath } from "../pages/path";
import {
  getPrivacy,
  mintShare,
  privateScope,
  revokeShares,
  setPrivate,
  setPublic,
} from "../private/service";
import { getSettings, saveSettings } from "../settings";
import type { Access, Item } from "../types";

export interface ToolContext {
  siteUrl: string;
}

// One definition, two presentations. `handler` returns the result and nothing else; `render` turns
// that result into the text MCP has always returned, and the REST surface serializes the result
// itself. Neither door keeps a table of its own, so a tool cannot exist on one and not the other,
// and a result shape cannot drift from the words describing it: they are produced from the same
// value in the same file. `access` is required rather than derived from the name, because a naming
// convention mislabels a tool silently and a missing field does not compile.
export interface ToolDefinition<R = unknown> {
  name: string;
  title: string;
  // What this tool is about, which is how /docs groups the reference. One registry, so the
  // documentation's own navigation cannot list a tool that does not exist or miss one that does.
  group: string;
  access: "read" | "write";
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  handler: (args: Record<string, any>, ctx: ToolContext) => Promise<R>;
  render: (result: R) => string;
}

export type AnyTool = ToolDefinition<any>;

// The one gate, sitting in front of the registry rather than inside either door, so a read-only
// credential behaves identically over MCP and over HTTP. A write tool is hidden as well as refused:
// a client that cannot see it never builds a call it was never going to be allowed to make.
export function toolsFor(access: Access): AnyTool[] {
  return access === "write" ? TOOLS : TOOLS.filter((t) => t.access === "read");
}

export function allows(access: Access, tool: AnyTool): boolean {
  return access === "write" || tool.access === "read";
}

// Infers each tool's own result type without it being written twice.
function tool<R>(definition: ToolDefinition<R>): ToolDefinition<R> {
  return definition;
}

// Every JSON reply is compact: indenting one page of list_items measured 30% more characters for
// nothing a reader of it needs.
function asJson(value: unknown): string {
  return JSON.stringify(value);
}

// A Netlify synchronous function caps the whole request, and base64 inflates a file by a third on
// the way in. Well under that, and stated, so an upload fails with a sentence rather than at the
// platform boundary with nothing to read.
const MAX_ASSET_MB = 4;
const MAX_ASSET_BYTES = MAX_ASSET_MB * 1024 * 1024;

function object(properties: Record<string, unknown>, required: string[] = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

// A result shape, written in the same JSON Schema vocabulary as an input schema, so /docs draws
// both with one renderer. A handler's result is the REST body byte for byte, so the shape is
// published API: results.test.ts holds every reply against the one declared here and fails on a
// key that is returned and not declared, which is what stops the documentation drifting from it.
function described(schema: Record<string, unknown>, description?: string): Record<string, unknown> {
  return description === undefined ? schema : { ...schema, description };
}

function str(description?: string) {
  return described({ type: "string" }, description);
}

function num(description?: string) {
  return described({ type: "number" }, description);
}

function bool(description?: string) {
  return described({ type: "boolean" }, description);
}

function nullable(type: string, description?: string) {
  return described({ type: [type, "null"] }, description);
}

// A JSON value of whatever type the caller stored.
function anyValue(description?: string) {
  return described({}, description);
}

function list(items: unknown, description?: string) {
  return described({ type: "array", items }, description);
}

function map(values: unknown, description?: string) {
  return described({ type: "object", additionalProperties: values }, description);
}

// Required unless named as optional, which is the right way round for a reply: a field the caller
// cannot count on is the exception, and saying so is the whole value of writing the shape down.
function shape(properties: Record<string, unknown>, optional: string[] = []) {
  return object(
    properties,
    Object.keys(properties).filter((key) => !optional.includes(key)),
  );
}

// A reply that has more than one shape: one branch per way the call can go, each titled with the
// case it answers, because "sometimes there is a warning field" is not what the caller needs to know.
function either(...branches: Record<string, unknown>[]) {
  return { anyOf: branches };
}

function branch(title: string, properties: Record<string, unknown>, optional: string[] = []) {
  return { title, ...shape(properties, optional) };
}

const COLLECTION_ENTRY = shape({
  path: str(),
  items: num("How many items it holds"),
  rev: num("The collection rev, for reorder_items"),
  refs: map(str(), "Field name to the collection its ids come from"),
  url: str("Serves the items as a bare JSON array"),
});

const BROKEN_REFERENCE = shape({
  path: str("The collection holding the records"),
  field: str(),
  references: str("The collection path they point into"),
  count: num(),
});

const REFERRER = shape({
  path: str(),
  field: str(),
  count: num(),
  ids: list(str(), "Up to twenty of them"),
});

const PAGE_MATCH = shape({
  path: str(),
  lines: list(shape({ line: num("1 based"), text: str() })),
  more: num("Matching lines beyond the ones listed"),
});

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

// The URL a browser uses for a path. /root is served at /, and a share link built on it has to be
// the one the recipient opens: a redirect that carried the fragment would still be a second URL.
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
  "stored and served unchanged. Writing an item is live at once: nothing is rebuilt and no deploy is involved, and the CDN copy is cleared by the write itself. " +
  "The served JSON is unauthenticated. Under a private path it is served only to a browser holding a share link and is left out of the index; anywhere else it is public to anyone who guesses the path. " +
  "GET /data/_collections.json for the index of every collection: an array of {path, url, count, rev, updatedAt} " +
  "sorted by path, so a page can discover collections over plain HTTP with no access to these tools.";

export const BUNDLES =
  "Organization is a folder tree and nothing more. A path is a bundle and holds everything at or under it: /trip " +
  "holds /trip/items, /trip/images/photo.jpg and /trip/day1/items alike, and /trip/day1 holds that last one too. " +
  "Pages, collections and assets are all just resources at paths. None of them owns or belongs to another, there " +
  "is no owner and no owning page, and nothing is ever unfiled or ungrouped: a resource's own path already says " +
  "which bundles hold it, so publishing a page at /trip changes nothing about what is under /trip. Matching is on " +
  "whole path segments, so /photos does not hold /photos-archive/lessons. One exception: / is not a bundle, " +
  "because it would hold the entire site. A resource may still sit at /, and what a browser gets at / is the site " +
  "contents, a generated list of every public page that no tool writes or deletes. The /root bundle is an ordinary " +
  "folder holding the favicon and whatever else is filed there. This is organization only, never a boundary: " +
  "nothing is rejected, moved or blocked by it, " +
  "any page may fetch any collection, and references may cross bundles.";

const PRIVACY =
  "A private path is closed to the public and opened only by a share link. It covers a path and everything at or " +
  "under it, the same folder rule as a bundle, so making /trip private closes the page at /trip, every page under " +
  "it, /data/trip/*.json and every asset under /assets/trip/. To everyone without a link those all answer exactly " +
  "as if nothing were published there, so a private path never reveals that it exists. Privacy does not nest: a " +
  "path inside an already private path cannot be a second scope. A share link carries its secret in the URL " +
  "fragment, after the #, which browsers never send to a server, so the link appears in no server log and no " +
  "Referer header, and a chat or mail app that previews links cannot open it. Anyone holding a link is in, so it " +
  "is only as private as the channel it is sent through, and it opens in a browser with JavaScript on. Revoke a " +
  "link with revoke_share and it stops working on the next request.";

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
  if (kind === "page") return urlFor(ctx, path);
  if (kind === "collection") return dataUrl(ctx, path);
  return `${ctx.siteUrl}/assets${path}`;
}

async function transferResult(ctx: ToolContext, transfer: Transfer) {
  const [stale, rest, privacy] = await Promise.all([
    staleReferences(transfer),
    restOfBundle(transfer),
    privacyChanges(transfer),
  ]);
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
  if (privacy.some((change) => change.now === "public"))
    notes.push(
      "Something in privacy_changes left a private path and is now public to anyone who has the URL. Tell the " +
        "owner before they find out another way, and use set_privacy on the new path if it should stay closed.",
    );
  else if (privacy.length > 0)
    notes.push("Something in privacy_changes moved into a private path and is now closed to the public.");
  return {
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
    ...(privacy.length === 0 ? {} : { privacy_changes: privacy }),
    ...(rest.length === 0 ? {} : { rest_of_bundle: rest }),
    notes,
  };
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

const SCOPE_GROUPS: Record<Scope, string> = {
  page: "Pages",
  collection: "Data",
  asset: "Assets",
  bundle: "Bundles",
};

function transferTool(scope: Scope, verb: Verb, spec: { title: string; what: string; lead: string }) {
  return tool({
    name: `${verb}_${scope}`,
    title: spec.title,
    access: "write" as const,
    group: SCOPE_GROUPS[scope],
    description: `${spec.lead} ${TRANSFER}${scope === "bundle" ? ` ${BUNDLES}` : ""}`,
    inputSchema: transferSchema(scope, verb, spec.what),
    outputSchema: shape(
      {
        operation: str("copy, move or delete"),
        scope: str("page, collection, asset or bundle"),
        from: str("The path it read"),
        to: str("The path it wrote. Absent on a delete."),
        applied: bool(
          "False when a bundle verb was called without confirm: nothing was written and the rest of this reply is the inventory it would have written.",
        ),
        resources: list(
          shape(
            {
              kind: str("page, collection or asset"),
              from: str("Where it was"),
              to: nullable("string", "Where it is now, null on a delete"),
              url: str("Where it is served now. Absent on a delete."),
              replaced: bool("It overwrote something already there. Absent on a delete."),
              title: str("Pages only"),
              items: num("Collections only: how many items travelled"),
              rev: num("Collections only: the rev it now holds"),
              refs: map(str(), "Collections only: the reference constraints that came with it"),
              bytes: num("Assets only"),
            },
            ["url", "replaced", "title", "items", "rev", "refs", "bytes"],
          ),
          "Every resource the operation touched, one entry each",
        ),
        breaks: list(BROKEN_REFERENCE, "Records in other collections left pointing at ids this removed"),
        pages_to_update: list(
          PAGE_MATCH,
          "Page lines still naming a path that has gone. No page content is ever edited, so these are yours to fix.",
        ),
        privacy_changes: list(
          shape({ kind: str(), path: str(), was: str(), now: str() }),
          "Resources that changed hands between public and private. Absent when none did.",
        ),
        rest_of_bundle: list(
          shape({ kind: str(), path: str() }),
          "What stayed exactly where it was. Page scope only, and absent when nothing else sits under the path.",
        ),
        notes: list(str(), "What to tell the owner, already in sentences"),
      },
      ["to", "privacy_changes", "rest_of_bundle"],
    ),
    handler: async (args, ctx) => transferResult(ctx, await runTransfer(transferArgs(args, scope, verb))),
    render: asJson,
  });
}

export const TOOLS: AnyTool[] = [
  tool({
    name: "list_pages",
    title: "List pages",
    access: "read",
    group: "Pages",
    description: "List every page published on this site. " + BUNDLES,
    inputSchema: object({}),
    outputSchema: shape({
      pages: list(
        shape({
          path: str(),
          title: str(),
          format: str("markdown or html"),
          url: str("Where a browser reads it"),
        }),
      ),
    }),
    handler: async (_args, ctx) => ({
      pages: (await listPages()).map((p) => ({
        path: p.path,
        title: p.title,
        format: p.contentType,
        url: urlFor(ctx, p.path),
      })),
    }),
    render: (r) =>
      r.pages.length === 0
        ? "No pages published yet."
        : r.pages.map((p) => `${p.path}  ${p.title}  (${p.format})  ${p.url}`).join("\n"),
  }),
  tool({
    name: "get_page",
    title: "Read a page",
    access: "read",
    group: "Pages",
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
    outputSchema: either(
      branch("The whole page, when nothing narrowed the read", {
        path: str(),
        title: str(),
        format: str("markdown or html"),
        content: str("The stored source, byte for byte"),
      }),
      branch("Numbered lines, when find, offset or limit was passed", {
        path: str(),
        title: str(),
        format: str("markdown or html"),
        total: num("Lines in the whole page"),
        more: num("Matching lines beyond the ones returned"),
        lines: list(shape({ line: num("1 based"), text: str() })),
      }),
    ),
    handler: async (args) => {
      const path = requirePath(args.path);
      const page = await getPage(path);
      if (!page) throw new Error(noPageAt(path));

      const whole = args.find === undefined && args.offset === undefined && args.limit === undefined;
      if (whole) return { path: page.path, title: page.title, format: page.contentType, content: page.body };

      const slice = slicePage(page, {
        find: args.find === undefined ? undefined : String(args.find),
        offset: args.offset === undefined ? undefined : Number(args.offset),
        limit: args.limit === undefined ? undefined : Number(args.limit),
      });
      return {
        path: page.path,
        title: page.title,
        format: page.contentType,
        total: slice.total,
        more: slice.more,
        lines: slice.lines,
      };
    },
    render: asJson,
  }),
  tool({
    name: "edit_page",
    title: "Edit part of a page",
    access: "write",
    group: "Pages",
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
    outputSchema: shape({
      path: str(),
      url: str(),
      replaced: num("Occurrences replaced"),
      lines: list(num(), "Line numbers that changed"),
    }),
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
      return { path: page.path, url: urlFor(ctx, page.path), replaced, lines };
    },
    render: (r) => {
      const where =
        r.lines.length > 3 ? `${r.lines.slice(0, 3).join(", ")} and ${r.lines.length - 3} more` : r.lines.join(", ");
      return `Replaced ${r.replaced} occurrence${r.replaced === 1 ? "" : "s"} at line ${where} in ${r.url}`;
    },
  }),
  tool({
    name: "publish_page",
    title: "Publish a page",
    access: "write",
    group: "Pages",
    description:
      "Create a page at a path. Markdown is rendered into the site theme; HTML is served exactly as written. Fails if the path is taken unless overwrite is true. " +
      "If the page lists repeating things, offer the owner a data collection first: keep the items in one with put_item and have the page fetch /data/<path>.json, so editing one of them later does not mean rewriting the page. " +
      BUNDLES,
    inputSchema: object(
      {
        path: {
          type: "string",
          description:
            "Page path, for example /about. / is the generated site contents, so a page cannot be published there; " +
            "every page you publish is listed on it.",
        },
        content: { type: "string", description: "Markdown or a full HTML document" },
        format: { type: "string", enum: ["markdown", "html"], description: "Defaults to auto-detect" },
        title: { type: "string", description: "Defaults to the first heading" },
        overwrite: { type: "boolean", description: "Replace an existing page at this path" },
      },
      ["path", "content"],
    ),
    outputSchema: shape({
      path: str(),
      url: str("Where a browser reads it"),
      title: str(),
      format: str("markdown or html"),
    }),
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
      return { path: page.path, url: urlFor(ctx, page.path), title: page.title, format: page.contentType };
    },
    render: (r) => `Published ${r.title} at ${r.url}`,
  }),
  tool({
    name: "update_page",
    title: "Update a page",
    access: "write",
    group: "Pages",
    description:
      "Replace the content of an existing page. If you are rewriting the page only to change items in a list, move that list into a data collection instead and let the page fetch it. " +
      BUNDLES,
    inputSchema: object({ path: { type: "string" }, content: { type: "string" }, title: { type: "string" } }, [
      "path",
      "content",
    ]),
    outputSchema: shape({
      path: str(),
      url: str("Where a browser reads it"),
      title: str(),
      format: str("markdown or html"),
    }),
    handler: async (args, ctx) => {
      const path = requirePath(args.path);
      const existing = await getPage(path);
      if (!existing) throw new Error(`${noPageAt(path)}. Use publish_page to create it.`);
      if (typeof args.content !== "string" || args.content.length === 0)
        throw new Error("content is required");

      const page = await savePage({
        path,
        contentType: detectFormat(args.content, existing.contentType),
        title: typeof args.title === "string" && args.title ? args.title : existing.title,
        body: args.content,
      });
      return { path: page.path, url: urlFor(ctx, page.path), title: page.title, format: page.contentType };
    },
    render: (r) => `Updated ${r.url}`,
  }),
  transferTool("page", "copy", {
    title: "Copy a page",
    what: "page",
    lead:
      "Duplicate a page at another path, body byte for byte. The copy keeps every URL written into its body, so it " +
      "fetches the original's collections and assets until you edit it.",
  }),
  transferTool("page", "move", {
    title: "Move or rename a page",
    what: "page",
    lead:
      "Rename a page. Collections and assets under its old path are untouched and stay exactly where they are; the " +
      "reply names every one of them, because the page no longer sits in the same bundle as them. The old URL stops " +
      "resolving at once, so any link to it breaks. To take a page and its data together, use move_bundle.",
  }),
  transferTool("page", "delete", {
    title: "Delete a page",
    what: "page",
    lead:
      "Remove one page. Collections and assets under its path are untouched and stay exactly where they are, and " +
      "the reply names every one of them. To delete a page together with everything under it, use delete_bundle.",
  }),
  tool({
    name: "upload_asset",
    title: "Upload an asset",
    access: "write",
    group: "Assets",
    description:
      "Store an image or file and return its public URL for use on any page. Pass path to file it into a bundle; " +
      "without one it is stored under a content hash, which keeps working forever but sits in no bundle. " +
      "An image uploaded to /root/favicon.ico, .svg, .png, .webp or .jpg becomes the site icon, served at " +
      "/favicon.ico; until one is uploaded the site serves a built-in default. " +
      `A file is at most ${MAX_ASSET_MB} MB once decoded, and one over that is refused before it is read. ` +
      "That ceiling is the host's own request limit rather than a setting, so there is no larger endpoint " +
      "and no way to send a file in pieces. Something bigger has to be made smaller before it is uploaded. " +
      BUNDLES,
    inputSchema: object(
      {
        filename: { type: "string" },
        content_base64: { type: "string", description: "File contents, base64 encoded" },
        content_type: { type: "string", description: "MIME type, for example image/png" },
        path: {
          type: "string",
          description:
            "Optional path to file this asset under, for example /gallery/images/photo.jpg. It is served " +
            "at /assets plus that path, and sits in the bundle that path names.",
        },
      },
      ["filename", "content_base64", "content_type"],
    ),
    outputSchema: shape({
      url: str("The only way to read the bytes back. No tool returns them."),
      path: nullable("string", "Null when it was stored under a content hash instead"),
      filename: str(),
      content_type: str(),
      bytes: num("Size once decoded"),
    }),
    handler: async (args, ctx) => {
      if (typeof args.content_base64 !== "string") throw new Error("content_base64 is required");
      // Checked from the encoded length, before decoding: the point is to refuse an oversized file
      // in this API's own words rather than let the platform truncate the request with nothing to read.
      const declared = Math.floor((args.content_base64.length * 3) / 4);
      if (declared > MAX_ASSET_BYTES)
        throw new Error(
          `That file is about ${Math.round(declared / (1024 * 1024))} MB; ${MAX_ASSET_MB} MB is the most that can be uploaded.`,
        );
      const binary = atob(args.content_base64);
      const bytes = new Uint8Array(new ArrayBuffer(binary.length));
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const asset = await putAsset({
        filename: String(args.filename),
        contentType: String(args.content_type),
        bytes: bytes.buffer,
        path: args.path === undefined ? undefined : String(args.path),
      });
      return {
        url: `${ctx.siteUrl}${assetUrlFor(asset)}`,
        path: asset.path ?? null,
        filename: asset.filename,
        content_type: asset.contentType,
        bytes: asset.size,
      };
    },
    render: (r) => (r.path ? `${r.url}\npath ${r.path}` : r.url),
  }),
  tool({
    name: "list_assets",
    title: "List assets",
    access: "read",
    group: "Assets",
    description:
      "List uploaded images and files with their URLs and, where they have one, their path. An asset " +
      "uploaded before paths existed is named by a hash of its bytes instead and sits in no bundle. " +
      "The url is also how a file is read back: no tool returns the contents of one, so fetch that address " +
      "over HTTP and save it where you are working. One under a private path needs an API token on the " +
      "request and otherwise answers as though nothing were there. " +
      BUNDLES,
    inputSchema: object({}),
    outputSchema: shape({
      assets: list(
        shape(
          {
            filename: str(),
            path: str("Absent for an asset stored under a content hash, which sits in no bundle"),
            url: str("Fetch this over HTTP to read the file"),
            bytes: num(),
          },
          ["path"],
        ),
      ),
    }),
    handler: async (_args, ctx) => ({
      assets: (await assetEntries()).map((a) => ({
        filename: a.filename,
        path: a.path,
        url: `${ctx.siteUrl}/assets/${a.path ? a.path.replace(/^\//, "") : a.key}`,
        bytes: a.size,
      })),
    }),
    render: (r) =>
      r.assets.length === 0
        ? "No assets uploaded yet."
        : r.assets
            .map(
              (a) =>
                `${a.filename}  ${a.url}  (${a.bytes} bytes)` +
                `${a.path ? `  in ${a.path}` : "  stored under a content hash, in no bundle"}`,
            )
            .join("\n"),
  }),
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
  tool({
    name: "list_bundle",
    title: "List a bundle",
    access: "read",
    group: "Bundles",
    description:
      "List every page, collection and asset at or under one path, including deeper pages and everything under " +
      "them. Use it to see everything one page's content is made of. " +
      BUNDLES,
    inputSchema: object(
      { path: { type: "string", description: "Bundle path, for example /gallery. It need not have a page." } },
      ["path"],
    ),
    outputSchema: shape({
      path: str(),
      has_page: bool("False when things are filed under a path that has no page at it"),
      pages: list(shape({ path: str(), title: str(), url: str() })),
      collections: list(COLLECTION_ENTRY),
      assets: list(shape({ path: str(), bytes: num(), url: str() })),
    }),
    handler: async (args, ctx) => {
      const path = requirePath(args.path);
      if (path === "/") throw new Error(ROOT_IS_NOT_A_BUNDLE);
      const [contents, page] = await Promise.all([bundleContents(path), getPage(path)]);

      const pages = contents.pages.map((entry) => ({
        path: entry.path,
        title: entry.title,
        url: urlFor(ctx, entry.path),
      }));
      const collections = contents.collections.map((c) => ({
        path: c.path,
        items: c.count,
        rev: c.rev,
        refs: c.refs,
        url: dataUrl(ctx, c.path),
      }));
      const assets = contents.assets.map((a) => ({
        path: a.path!,
        bytes: a.size,
        url: `${ctx.siteUrl}/assets/${a.path!.replace(/^\//, "")}`,
      }));

      // A bundle holding a page and nothing else, and a path where nothing exists, are different situations.
      if (!page && pages.length === 0 && collections.length === 0 && assets.length === 0)
        throw new Error(
          `Nothing is published at ${path}: no page there, and no collection or asset under it. ` +
            `Call list_pages or list_collections to see what does exist.`,
        );

      return { path, has_page: Boolean(page), pages, collections, assets };
    },
    render: (r) => {
      const out: string[] = [];
      if (!r.has_page) out.push(`No page is published at ${r.path}. These are grouped under it by path alone.`);
      for (const entry of r.pages) out.push(`page ${entry.path}  ${entry.title}  ${entry.url}`);
      for (const c of r.collections)
        out.push(`collection ${c.path}  ${c.items} items  rev ${c.rev}${refsOf(c.refs)}  ${c.url}`);
      for (const a of r.assets) out.push(`asset ${a.path}  ${a.bytes} bytes  ${a.url}`);
      if (r.has_page && r.collections.length === 0 && r.assets.length === 0)
        out.push(`Nothing else is in ${r.path} yet.`);
      return out.join("\n");
    },
  }),
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
  tool({
    name: "list_collections",
    title: "List data collections",
    access: "read",
    group: "Data",
    description:
      "List every JSON data collection on this site with its item count and public URL. " +
      "A collection is an ordered array of items a page fetches and renders. " +
      BUNDLES +
      " " +
      SERVING,
    inputSchema: object({}),
    outputSchema: shape({ collections: list(COLLECTION_ENTRY) }),
    handler: async (_args, ctx) => ({
      collections: (await collectionEntries()).map((c) => ({
        path: c.path,
        items: c.count,
        rev: c.rev,
        refs: c.refs,
        url: dataUrl(ctx, c.path),
      })),
    }),
    render: (r) =>
      r.collections.length === 0
        ? "No data collections yet. Use put_item to create one."
        : r.collections
            .map((c) => `${c.path}  ${c.items} items  rev ${c.rev}${refsOf(c.refs)}  served at ${c.url}`)
            .join("\n"),
  }),
  tool({
    name: "list_items",
    title: "List items in a collection",
    access: "read",
    group: "Data",
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
    outputSchema: shape({
      path: str(),
      url: str("Serves the bare items array, without this envelope"),
      served: str("Says so in the reply itself, because the two shapes are easy to confuse"),
      rev: num("The collection rev, for reorder_items"),
      total: num("Items in the whole collection, not in this page of them"),
      offset: num(),
      items: list(
        shape({
          id: str(),
          rev: num("Pass back as if_rev when you write this item"),
          item: map(true, "The item's fields, cut down to the ones you asked for"),
        }),
      ),
    }),
    handler: async (args, ctx) => {
      const path = requirePath(args.path);
      const collection = await getCollection(path);
      if (!collection) throw new Error(`No collection exists at ${path}. Use put_item to create it.`);

      const offset = Math.max(0, Number(args.offset) || 0);
      const limit = Math.max(1, Number(args.limit) || 50);
      const page = collection.items.slice(offset, offset + limit);

      return {
        path: collection.path,
        url: dataUrl(ctx, collection.path),
        served: ENVELOPE,
        rev: collection.rev,
        total: collection.items.length,
        offset,
        items: page.map((item) => ({ id: item.id, rev: revOf(collection, item.id), item: project(item, args.fields) })),
      };
    },
    render: asJson,
  }),
  tool({
    name: "count_items",
    title: "Count items by field",
    access: "read",
    group: "Data",
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
    outputSchema: shape(
      {
        path: str(),
        total: num("Records counted, after any filter"),
        group_by: list(str()),
        filter: map(true, "Echoed back when one was passed"),
        rows: list(
          map(true, "One row per combination: each grouped field, plus count"),
          "Sorted by the grouped values. A combination with no records has no row.",
        ),
      },
      ["filter"],
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

      return {
        path: collection.path,
        total: inScope.length,
        group_by: fields,
        ...(filter.length > 0 ? { filter: Object.fromEntries(filter) } : {}),
        rows,
      };
    },
    render: asJson,
  }),
  tool({
    name: "get_item",
    title: "Read one item",
    access: "read",
    group: "Data",
    description: "Return a single item from a collection by its id, with the rev to pass back as if_rev when you write. " + REVS,
    inputSchema: object({ path: { type: "string" }, id: { type: "string" } }, ["path", "id"]),
    outputSchema: shape({
      path: str(),
      url: str(),
      id: str(),
      rev: num("Pass back as if_rev when you write"),
      item: map(true, "Every stored field, nested values unchanged"),
    }),
    handler: async (args, ctx) => {
      const path = requirePath(args.path);
      const collection = await getCollection(path);
      const item = collection?.items.find((i) => i.id === String(args.id));
      if (!item) throw new Error(`No item ${args.id} in ${path}`);
      return { path, url: dataUrl(ctx, path), id: item.id, rev: revOf(collection!, item.id), item };
    },
    render: asJson,
  }),
  tool({
    name: "put_item",
    title: "Create or update an item",
    access: "write",
    group: "Data",
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
    outputSchema: shape({
      path: str(),
      url: str(),
      id: str("Generated when you did not pass one"),
      rev: num("The item's new rev"),
      created: bool("False when an existing item was updated"),
    }),
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
      return { path, url: dataUrl(ctx, path), id: item.id, rev, created };
    },
    render: (r) =>
      `${r.created ? "Created" : "Updated"} ${r.id} at rev ${r.rev} in collection ${r.path}, served at ${r.url}`,
  }),
  tool({
    name: "delete_item",
    title: "Delete an item",
    access: "write",
    group: "Data",
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
    outputSchema: shape({
      deleted: str("The id that was removed"),
      path: str(),
      orphaned: list(
        REFERRER,
        "Records left pointing at nothing, which only happens when force was passed. Empty otherwise.",
      ),
    }),
    handler: async (args) => {
      const path = requirePath(args.path);
      const ifRev = args.if_rev === undefined ? undefined : Number(args.if_rev);
      const id = String(args.id);
      const { deleted, orphaned } = await deleteItem(path, id, ifRev, args.force === true);
      if (!deleted) throw new Error(`No item ${id} in ${path}`);
      return { deleted: id, path, orphaned };
    },
    // A clean delete says so in one line; one that orphaned records owes the caller the list, and the
    // caller who reached for force is the least likely to go looking for it afterwards.
    render: (r) => (r.orphaned.length === 0 ? `Deleted ${r.deleted} from ${r.path}` : asJson(r)),
  }),
  tool({
    name: "reorder_items",
    title: "Reorder a collection",
    access: "write",
    group: "Data",
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
    outputSchema: shape({
      path: str(),
      moved: list(str(), "The ids now at the front, in this order"),
      rest: num("Items behind them, keeping their previous order. They are counted, not listed."),
    }),
    handler: async (args) => {
      const path = requirePath(args.path);
      if (!Array.isArray(args.ids) || args.ids.length === 0) throw new Error("ids must be a non-empty array");
      const ifRev = args.if_rev === undefined ? undefined : Number(args.if_rev);
      const moved = args.ids.map(String);
      const items = await reorderItems(path, moved, ifRev);
      // Naming the ids that did not move would return the whole collection to answer a call that named one item.
      return { path, moved, rest: items.length - moved.length };
    },
    render: (r) =>
      `Order in ${r.path}: ${r.moved.join(", ")}${
        r.rest > 0 ? `, then the other ${r.rest} item${r.rest === 1 ? "" : "s"} in their previous order` : ""
      }.`,
  }),
  tool({
    name: "search_items",
    title: "Search items",
    access: "read",
    group: "Data",
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
    outputSchema: shape({
      query: str("Echoed back"),
      total: num("Matches found, which can exceed the number returned"),
      matches: list(
        shape({
          path: str("The collection it was found in"),
          url: str(),
          id: str(),
          rev: num("Pass back as if_rev when you write it"),
          index: num("Its position in that collection"),
          item: map(true, "The fields you asked for"),
        }),
      ),
    }),
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

      return { query: args.query, total: matches.length, matches: matches.slice(0, limit) };
    },
    render: (r) => (r.total === 0 ? `No items match ${r.query}` : asJson({ total: r.total, matches: r.matches })),
  }),
  tool({
    name: "match_names",
    title: "Find existing items by name",
    access: "read",
    group: "Data",
    description:
      "Check a batch of candidate names against a collection before creating anything, so the same entity is not added twice under a different spelling. " +
      "Matching ignores case, diacritics, punctuation and word order, and tolerates trailing qualifiers and abbreviations that prefix the full word, " +
      "so \"Acme Corp.\" finds \"ACME Corporation\" and \"Cafe Rouge\" finds \"Café Rouge\". " +
      "It compares one short field, by default name, and does not read descriptions or other long text, which mention other entities and generate false matches. " +
      "When a collection is partitioned by another field, pass filter to compare only within one partition, for example filter {\"section\": \"north\"} so north candidates are never matched against south records. " +
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
    outputSchema: shape(
      {
        path: str(),
        field: str("The field compared, name unless you said otherwise"),
        filter: map(true, "Echoed back when one was passed"),
        threshold: num(),
        compared: num("Records that carried the field and were compared"),
        skipped: num("Records in scope with no string in that field"),
        results: list(
          shape({
            name: str("The candidate, exactly as given"),
            matches: list(
              shape({
                id: str(),
                value: str("The stored name it matched"),
                rev: num(),
                score: num("0 to 1. Judge it, rather than trusting it."),
              }),
              "Best first, and empty where nothing was close enough",
            ),
          }),
          "One entry per candidate, in the order given",
        ),
      },
      ["filter"],
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

      return {
        path: collection.path,
        field,
        ...(filter.length > 0 ? { filter: Object.fromEntries(filter) } : {}),
        threshold,
        compared: candidates.length,
        skipped: inScope.length - candidates.length,
        results,
      };
    },
    render: asJson,
  }),
  tool({
    name: "set_collection_refs",
    title: "Constrain a field to ids in another collection",
    access: "write",
    group: "Data",
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
    outputSchema: shape({
      path: str(),
      refs: map(str(), "Field name to the collection its ids come from, as now declared"),
      violations: num("Records already holding a value the new constraint rejects. Run check_refs to see them."),
      missing: list(str(), "Referenced collections that do not exist yet, so every value is rejected until they do"),
    }),
    handler: async (args) => {
      const path = requirePath(args.path);
      if (typeof args.refs !== "object" || args.refs === null || Array.isArray(args.refs))
        throw new Error("refs must be an object of field name to collection path");

      const { refs, violations, missing } = await setRefs(path, args.refs as Record<string, string>);
      return { path, refs, violations, missing };
    },
    render: (r) => {
      const declared = Object.entries(r.refs);
      if (declared.length === 0) return `Cleared every reference constraint on ${r.path}.`;

      const lines = [
        `${r.path}: ${declared.map(([field, target]) => `${field} references ids in ${target}`).join(", ")}.`,
        r.violations === 0
          ? "No existing record violates that."
          : r.violations === 1
            ? "1 existing record already violates it; run check_refs to see it."
            : `${r.violations} existing records already violate it; run check_refs to see them.`,
      ];
      if (r.missing.length > 0)
        lines.push(
          `Note that ${r.missing.join(" and ")} does not exist yet, so every value will be rejected until it does.`,
        );
      return lines.join(" ");
    },
  }),
  tool({
    name: "check_refs",
    title: "Find broken references",
    access: "read",
    group: "Data",
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
    outputSchema: either(
      branch("References were declared, so something was checked", {
        path: str(),
        checked: num("Records examined"),
        refs_declared: map(str(), "What was verified"),
        broken: list(
          shape({
            id: str(),
            field: str(),
            value: anyValue("The stored value that matches no id"),
            references: str("The collection it should have named"),
          }),
        ),
      }),
      branch("Nothing is declared, so nothing was checked", {
        path: str(),
        checked: num("0"),
        refs_declared: map(str(), "Empty"),
        broken: list(anyValue(), "Empty, and it means nothing was looked at"),
        warning: str("Says so, so an empty broken list is not read as a clean bill of health"),
      }),
    ),
    handler: async (args) => {
      const path = requirePath(args.path);
      const field = args.field === undefined ? undefined : String(args.field);
      return brokenRefs(path, field);
    },
    render: asJson,
  }),
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
  tool({
    name: "get_site",
    title: "Get site info",
    access: "read",
    group: "Site",
    description:
      "Return the site title, description, address, page count and every private path with its live share count.",
    inputSchema: object({}),
    outputSchema: shape({
      title: str(),
      description: str(),
      url: str("The site's own address"),
      pages: num("How many pages are published"),
      private: list(shape({ path: str(), shares: num("Live share links on it") })),
    }),
    handler: async (_args, ctx) => {
      const [settings, pages, privacy] = await Promise.all([getSettings(), listPages(), getPrivacy()]);
      return {
        title: settings.title,
        description: settings.description,
        url: ctx.siteUrl,
        pages: pages.length,
        private: privacy.scopes.map((scope) => ({ path: scope.path, shares: scope.shares.length })),
      };
    },
    render: asJson,
  }),
  tool({
    name: "set_privacy",
    title: "Make a path private or public",
    access: "write",
    group: "Privacy",
    description:
      "Close a path to the public, or reopen it. " +
      PRIVACY +
      " Making a path private takes it away from everyone immediately, including anyone holding an " +
      "older link to something under it; call share_path to mint the link that opens it. Making it " +
      "public again revokes every share on it, because those links exist only to open something " +
      "closed, and reopens everything under it to anyone. / cannot be private: it would close the " +
      "whole site, and " +
      ROOT_IS_NOT_A_BUNDLE,
    inputSchema: object(
      {
        path: { type: "string", description: "The path to close or reopen, for example /trip" },
        private: { type: "boolean", description: "true closes the path, false reopens it" },
      },
      ["path", "private"],
    ),
    outputSchema: either(
      branch("Closed", {
        path: str(),
        private: bool("true"),
        url: str(),
        closed: shape({ pages: num(), collections: num(), assets: num() }),
        next: str("Nobody reaches any of it until share_path mints a link"),
      }),
      branch("Reopened", {
        path: str(),
        private: bool("false"),
        url: str(),
        revoked: list(str(), "Labels of the share links this killed, because reopening ends them"),
        note: str(),
      }),
      branch("It was already public", { path: str(), private: bool("false"), note: str() }),
    ),
    handler: async (args, ctx) => {
      const path = requirePath(args.path);
      if (typeof args.private !== "boolean") throw new Error("private must be true or false");
      if (path === "/") throw new Error(`/ cannot be private. ${ROOT_IS_NOT_A_BUNDLE}`);

      if (args.private) {
        await setPrivate(path);
        const held = await bundleContents(path);
        return {
          path,
          private: true,
          url: urlFor(ctx, path),
          closed: { pages: held.pages.length, collections: held.collections.length, assets: held.assets.length },
          next: "Nobody can reach any of it until you call share_path to mint a link.",
        };
      }

      const scope = await setPublic(path);
      if (!scope) return { path, private: false, note: `${path} was already public.` };
      return {
        path,
        private: false,
        url: urlFor(ctx, path),
        revoked: scope.shares.map((share) => share.label),
        note: "Everything at or under this path is public again, and every share link on it is dead.",
      };
    },
    render: asJson,
  }),
  tool({
    name: "share_path",
    title: "Mint a share link",
    access: "write",
    group: "Privacy",
    description:
      "Return a link that opens a private path, and make the path private if it is not already. " +
      PRIVACY +
      " Mint one link per recipient and label it with who it is for: revoke_share takes a label, so " +
      "one recipient's link can be killed without disturbing anybody else's. The link is returned " +
      "once and cannot be shown again, because only its hash is stored; losing it means minting " +
      "another. Give the whole link to the owner exactly as returned, fragment and all: everything " +
      "after the # is the secret, and a link with that part trimmed opens nothing.",
    inputSchema: object(
      {
        path: { type: "string", description: "The path to share, for example /trip" },
        label: {
          type: "string",
          description: "Who this link is for, for example \"Dana\" or \"the builders\". Unique per path.",
        },
      },
      ["path", "label"],
    ),
    outputSchema: shape({
      path: str(),
      label: str(),
      link: str("The whole link, fragment included. Shown once: only a hash is stored."),
      created: num("Epoch milliseconds"),
      note: str(),
    }),
    handler: async (args, ctx) => {
      const path = requirePath(args.path);
      if (typeof args.label !== "string" || args.label.trim() === "") throw new Error("label is required");
      if (path === "/") throw new Error(`/ cannot be private. ${ROOT_IS_NOT_A_BUNDLE}`);

      const label = args.label.trim();
      const { token: secret, share } = await mintShare(path, label);
      return {
        path,
        label,
        link: `${urlFor(ctx, path)}#${secret}`,
        created: share.createdAt,
        note: "Shown once. Only a hash is stored, so this link cannot be printed again.",
      };
    },
    render: asJson,
  }),
  tool({
    name: "list_shares",
    title: "List private paths and their share links",
    access: "read",
    group: "Privacy",
    description:
      "List every private path with its share links: label, when it was minted and when it was last " +
      "redeemed. Pass a path for just that one. The links themselves are not stored and cannot be " +
      "listed, only their labels, so this answers who has access and not what to send them. A path " +
      "with no shares is closed to everyone, which is a normal state for something still being written.",
    inputSchema: object({ path: { type: "string", description: "Optional: one private path" } }),
    outputSchema: either(
      branch("Every private path, or the one you named", {
        private: list(
          shape({
            path: str(),
            url: str(),
            shares: list(
              shape({
                label: str("Who it is for. The link itself is not stored and cannot be listed."),
                created: num("Epoch milliseconds"),
                last_used: nullable("number", "Null until somebody opens it"),
              }),
            ),
          }),
        ),
      }),
      branch(
        "The path you named has no scope of its own",
        {
          path: str(),
          private: bool("True when another path closes it"),
          closed_by: str("The private path covering it, whose shares open this one. Absent when it is public."),
          note: str(),
        },
        ["closed_by"],
      ),
    ),
    handler: async (args, ctx) => {
      const privacy = await getPrivacy();
      const wanted = args.path === undefined ? null : requirePath(args.path);
      const scopes = wanted ? privacy.scopes.filter((scope) => scope.path === wanted) : privacy.scopes;

      if (wanted && scopes.length === 0) {
        const covering = privateScope(privacy, wanted);
        return {
          path: wanted,
          private: Boolean(covering),
          ...(covering ? { closed_by: covering.path } : {}),
          note: covering
            ? `${wanted} is private because ${covering.path} is. Its shares are listed under that path.`
            : `${wanted} is public.`,
        };
      }

      return {
        private: scopes.map((scope) => ({
          path: scope.path,
          url: urlFor(ctx, scope.path),
          shares: scope.shares.map((share) => ({
            label: share.label,
            created: share.createdAt,
            last_used: share.lastUsedAt ?? null,
          })),
        })),
      };
    },
    render: asJson,
  }),
  tool({
    name: "revoke_share",
    title: "Revoke a share link",
    access: "write",
    group: "Privacy",
    description:
      "Kill a share link. Pass a label to revoke that one recipient's link, or omit it to revoke " +
      "every link on the path. Effective on the holder's next request, not whenever their browser " +
      "would have forgotten it, because every request checks the link against the stored list. The " +
      "path stays private, so revoking the last link leaves it closed to everyone rather than " +
      "quietly publishing it; call set_privacy with private false to reopen it.",
    inputSchema: object(
      {
        path: { type: "string", description: "The private path, for example /trip" },
        label: { type: "string", description: "Optional: revoke only the link with this label" },
      },
      ["path"],
    ),
    outputSchema: shape(
      {
        path: str(),
        revoked: list(str(), "Labels killed. Empty when there was nothing to revoke."),
        remaining: num("Links still open on the path. Absent when nothing was revoked."),
        note: str(),
      },
      ["remaining"],
    ),
    handler: async (args) => {
      const path = requirePath(args.path);
      const label = typeof args.label === "string" && args.label.trim() !== "" ? args.label.trim() : undefined;
      const gone = await revokeShares(path, label);

      if (gone.length === 0)
        return {
          path,
          revoked: [],
          note: label ? `${path} has no share labelled "${label}".` : `${path} has no share links to revoke.`,
        };

      const privacy = await getPrivacy();
      const left = privacy.scopes.find((scope) => scope.path === path)?.shares.length ?? 0;
      return {
        path,
        revoked: gone.map((share) => share.label),
        remaining: left,
        note:
          left === 0
            ? `${path} is still private and now has no working links, so nobody can reach it.`
            : `${left} other link${left === 1 ? "" : "s"} still open ${path}.`,
      };
    },
    render: asJson,
  }),
  tool({
    name: "set_site_info",
    title: "Set site title and description",
    access: "write",
    group: "Site",
    description: "Update the site title and description shown in the header of every themed page.",
    inputSchema: object({ title: { type: "string" }, description: { type: "string" } }),
    outputSchema: shape({ title: str(), description: str() }),
    handler: async (args) => {
      const settings = await saveSettings({
        ...(typeof args.title === "string" ? { title: args.title } : {}),
        ...(typeof args.description === "string" ? { description: args.description } : {}),
      });
      return { title: settings.title, description: settings.description };
    },
    render: () => "Site info updated.",
  }),
  tool({
    name: "geocode",
    title: "Find coordinates for a place",
    access: "read",
    group: "Maps",
    description:
      "Turn a place name or address into candidate coordinates. It returns several candidates with the place around " +
      "each one, never a single answer, because a geocoder is a guess and only the caller can tell which candidate is " +
      "the place meant. Read them, choose one, and store its lat and lon on a collection item. " +
      "Ask for the specific thing rather than the town when precision matters: a town is an area and its station " +
      "is a point, and they can be kilometres apart. An empty result means nothing matched, which is not a bad match but no " +
      "match at all, and over-qualifying a query is the usual cause. " +
      "Store the pair as separate numeric lat and lon fields, never as a two-element array: GeoJSON writes [lon, lat] " +
      "and most map libraries take [lat, lon], so a transposed pair validates, renders and is silently wrong. " +
      "Show the attribution in the reply on any page built from these coordinates.",
    inputSchema: object(
      {
        query: { type: "string", description: "A place name or address, for example 'Union Station, Springfield'" },
        limit: { type: "number", description: "How many candidates to return, 1 to 10. Default 5." },
      },
      ["query"],
    ),
    outputSchema: shape({
      query: str("Echoed back, trimmed"),
      provider: str(),
      attribution: str("Show this on any page built from these coordinates. It is a licence condition."),
      candidates: list(
        shape({
          lat: num(),
          lon: num(),
          name: str(),
          context: nullable("string", "The place around the place, in components rather than a label"),
          kind: nullable("string", "Provider supplied and advisory: city, locality, railway"),
          confidence: nullable("number", "Comparable between candidates in one response and nowhere else"),
        }),
        "Candidates to judge, never an answer. Empty means nothing matched at all.",
      ),
      count: num(),
    }),
    handler: async (args) => geocodeQuery(args.query, args.limit),
    render: asJson,
  }),
  tool({
    name: "route",
    title: "Route between stops and store the line",
    access: "write",
    group: "Maps",
    description:
      "Route through stops in the order given and write the geometry to an asset as a GeoJSON LineString, returning " +
      "only a summary. The line itself is never returned: a road route runs to thousands of points, and sending it out " +
      "so that it can be sent back spends the whole thing twice. " +
      "Routing happens once, here, and the page fetches the stored asset. Never route when a visitor opens a page: the " +
      "answer cannot change, and it would put a third party in front of every reader. " +
      "profile is cycling, walking or driving, cycling by default. Cycling and walking are routed by BRouter, whose " +
      "lines carry elevation and whose reply reports ascent; driving by OSRM. Setting ORS_API_KEY routes everything " +
      "through openrouteservice instead. " +
      "prefer is safety, balanced or speed, and applies to cycling only. It is a real trade rather than a label: on one " +
      "67 km ride, safety spent 1.6 km extra to cut main-road riding from 4.5 km to 2.7 km, while speed put 49 km of the " +
      "same ride on primary and secondary roads. Asking for safety on a walking or driving route is refused rather than " +
      "ignored. " +
      "The reply reports what the ways are actually made of, under ways: metres by surface and by highway type, how much " +
      "is on a signed cycle route, and warnings for explicit prohibitions such as bicycle=no. Check those before telling " +
      "anyone a route is rideable. analyzed_m is how much of the route carried tags at all, and it is 0 when the router " +
      "reports none: that means nothing was examined, which is not the same as nothing being wrong, and untagged ground " +
      "is counted under its own name rather than quietly left out. None of it is a safety score, because safe depends on " +
      "the rider; it is what OpenStreetMap records, and OpenStreetMap can be wrong or silent. " +
      "The stored asset also carries a per-way segments table keyed to coordinate indices, so a page can colour the line " +
      "by surface and point at the stretch it warns about. " +
      "The full line is stored unless simplify_m is passed, because how much detail a line needs depends on the zoom it " +
      "will be drawn at, and that is the page's decision rather than storage's. " +
      "Keep the stops themselves in a collection so the owner can edit them, and put the attribution from the reply on " +
      "any page that draws the line.",
    inputSchema: object(
      {
        stops: {
          type: "array",
          description: "Ordered stops, two to 50, each an object with numeric lat and lon.",
          items: object({ lat: { type: "number" }, lon: { type: "number" } }, ["lat", "lon"]),
        },
        to: { type: "string", description: "Asset path to write, for example /trip/route.geojson" },
        profile: { type: "string", enum: PROFILES, description: "cycling, walking or driving. Default cycling." },
        prefer: {
          type: "string",
          enum: PREFERS,
          description: "Cycling only: safety, balanced or speed. Default balanced.",
        },
        simplify_m: {
          type: "number",
          description: "Optional. Drop points that move the line by less than this many metres.",
        },
      },
      ["stops", "to"],
    ),
    outputSchema: shape({
      path: str("The asset the GeoJSON was written to"),
      url: str("Where the page fetches the line"),
      provider: str(),
      attribution: str("Put this on any page that draws the line"),
      profile: str("cycling, walking or driving"),
      prefer: str("safety, balanced or speed"),
      distance_m: num(),
      duration_s: num(),
      ascent_m: nullable("number", "Null where the router reports none, which is not the same as no climb"),
      descent_m: nullable("number"),
      points: num("Coordinates in the stored line, after any simplification"),
      has_elevation: bool("The stored coordinates carry a third number"),
      bytes: num("Size of the stored GeoJSON"),
      legs: list(
        shape({ distance_m: num(), duration_s: num() }),
        "One per pair of stops. Empty where the router does not break the line down.",
      ),
      ways: shape({
        analyzed_m: num("How much of the route carried tags at all. 0 means nothing was examined, not that nothing is wrong."),
        surface_m: map(num(), "Metres by surface. Untagged ground is counted under its own name."),
        way_type_m: map(num(), "Metres by highway type"),
        on_cycle_route_m: num("Metres on a signed cycle route"),
        warnings: list(
          shape({
            kind: str("An explicit prohibition, for example bicycle=no"),
            metres: num(),
            where: list(list(num()), "Ranges of coordinate indices into the stored line"),
          }),
          "Prohibitions somebody wrote down, never opinions about traffic",
        ),
        segment_count: num("Rows in the per-way table stored in the asset"),
      }),
    }),
    handler: async (args, ctx) =>
      routeToAsset({
        stops: parseStops(args.stops),
        profile: parseProfile(args.profile),
        prefer: parsePrefer(args.prefer),
        to: typeof args.to === "string" ? args.to : "",
        simplifyMetres: Number(args.simplify_m) || 0,
        siteUrl: ctx.siteUrl,
      }),
    render: asJson,
  }),
];
