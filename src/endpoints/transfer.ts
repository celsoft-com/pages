import { EndpointError, endpoint } from "@celsoft/platform";
import { z } from "zod";
import { bundleContents, ROOT_IS_NOT_A_BUNDLE } from "../inventory";
import { getPage } from "../pages/service";
import { type PagesApp, pointsFor } from "../pages-app";
import {
  type Kind,
  normalizeFor,
  privacyChanges,
  restOfBundle,
  runTransfer,
  type Scope,
  staleReferences,
  type Transfer,
  type Verb,
} from "../transfer";
import { atPath, BUNDLES, dataUrl, requirePath, urlFor } from "./shared";

const TRANSFER =
  "One shape at every level: page, collection, asset and bundle take the same arguments and return the same reply. " +
  "It runs on the server, so ids, array order, nested values, revs and reference declarations survive exactly and no " +
  "record passes through this conversation. Page content is never rewritten: the reply lists any page line still " +
  "naming a path that has gone, and any record left pointing at nothing. A copy or move refuses an occupied target " +
  "unless you pass overwrite, and changes nothing when it refuses.";

const BROKEN_REFERENCE = z.object({
  path: z.string().describe("The collection holding the records"),
  field: z.string(),
  references: z.string().describe("The collection path they point into"),
  count: z.number(),
});

const PAGE_MATCH = z.object({
  path: z.string(),
  lines: z.array(z.object({ line: z.number().describe("1 based"), text: z.string() })),
  more: z.number().describe("Matching lines beyond the ones listed"),
});

const TRANSFER_OUTPUT = z.object({
  operation: z.enum(["copy", "move", "delete"]),
  scope: z.enum(["page", "collection", "asset", "bundle"]),
  from: z.string().describe("The path it read"),
  to: z.string().optional().describe("The path it wrote. Absent on a delete."),
  applied: z
    .boolean()
    .describe(
      "False when a bundle verb was called without confirm: nothing was written and the rest of this reply is the inventory it would have written.",
    ),
  resources: z
    .array(
      z.object({
        kind: z.enum(["page", "collection", "asset"]),
        from: z.string().describe("Where it was"),
        to: z.string().nullable().describe("Where it is now, null on a delete"),
        url: z.string().optional().describe("Where it is served now. Absent on a delete."),
        replaced: z.boolean().optional().describe("It overwrote something already there. Absent on a delete."),
        title: z.string().optional().describe("Pages only"),
        items: z.number().optional().describe("Collections only: how many items travelled"),
        rev: z.number().optional().describe("Collections only: the rev it now holds"),
        refs: z
          .record(z.string(), z.string())
          .optional()
          .describe("Collections only: the reference constraints that came with it"),
        bytes: z.number().optional().describe("Assets only"),
      }),
    )
    .describe("Every resource the operation touched, one entry each"),
  breaks: z.array(BROKEN_REFERENCE).describe("Records in other collections left pointing at ids this removed"),
  pages_to_update: z
    .array(PAGE_MATCH)
    .describe(
      "Page lines still naming a path that has gone. No page content is ever edited, so these are yours to fix.",
    ),
  privacy_changes: z
    .array(z.object({ kind: z.string(), path: z.string(), was: z.string(), now: z.string() }))
    .optional()
    .describe("Resources that changed hands between public and private. Absent when none did."),
  rest_of_bundle: z
    .array(z.object({ kind: z.string(), path: z.string() }))
    .optional()
    .describe("What stayed exactly where it was. Page scope only, and absent when nothing else sits under the path."),
  notes: z.array(z.string()).describe("What to tell the owner, already in sentences"),
});

function resourceUrl(app: PagesApp, kind: Kind, path: string): string {
  if (kind === "page") return urlFor(app, path);
  if (kind === "collection") return dataUrl(app, path);
  return `${app.env.APP_URL}/assets${path}`;
}

async function transferResult(app: PagesApp, transfer: Transfer): Promise<z.infer<typeof TRANSFER_OUTPUT>> {
  const [stale, rest, privacy] = await Promise.all([
    staleReferences(app, transfer),
    restOfBundle(app, transfer),
    privacyChanges(app, transfer),
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
      ...(r.to === null ? {} : { url: resourceUrl(app, r.kind, r.to), replaced: r.replaced }),
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

function transferEndpoint(scope: Scope, verb: Verb, spec: { what: string; lead: string }) {
  const name = `${verb}_${scope}`;
  return endpoint(
    {
      serve: ["api", "mcp"],
      method: "POST",
      path: `/api/v1/${name}`,
      description: `${spec.lead} ${TRANSFER}${scope === "bundle" ? ` ${BUNDLES}` : ""}`,
      access: {
        point: (input: { path?: string; from?: string }) =>
          pointsFor(normalizeFor(scope, input.path ?? input.from ?? "")),
        level: verb === "delete" ? "delete" : "write",
      },
      input: z.object({
        ...(verb === "delete"
          ? { path: z.string().describe(`The ${spec.what} to delete`) }
          : {
              from: z.string().describe(`The ${spec.what} to ${verb}`),
              to: z.string().describe(`Path to ${verb} it to`),
              overwrite: z.boolean().optional().describe("Replace whatever already sits at the target. Default false."),
            }),
        ...(scope === "bundle"
          ? {
              confirm: z
                .boolean()
                .optional()
                .describe("Must be true to apply. Without it nothing changes and you get the inventory instead."),
            }
          : {}),
        ...(scope === "collection"
          ? {
              if_rev: z.number().optional().describe("Refuse unless the collection is still at this rev."),
            }
          : {}),
      }),
      output: TRANSFER_OUTPUT,
    },
    async (input: Record<string, unknown>, app) => {
      // The gate saw where it comes from; where it lands is checked here, at the same level a write there needs.
      if (verb !== "delete") await app.access.require(pointsFor(normalizeFor(scope, String(input.to))), "write");
      return transferResult(
        app,
        await runTransfer(app, {
          scope,
          verb,
          from: String(verb === "delete" ? input.path : input.from),
          ...(verb === "delete" ? {} : { to: String(input.to) }),
          overwrite: input.overwrite === true,
          confirm: input.confirm === true,
          ifRev: typeof input.if_rev === "number" ? input.if_rev : undefined,
        }),
      );
    },
  );
}

export const transferEndpoints = {
  list_bundle: endpoint(
    {
      serve: ["api", "mcp"],
      method: "GET",
      path: "/api/v1/list_bundle",
      description:
        "List every page, collection and asset at or under one path, including deeper pages and everything under " +
        "them. Use it to see everything one page's content is made of. " +
        BUNDLES,
      access: { point: atPath(), level: "read" },
      input: z.object({
        path: z.string().describe("Bundle path, for example /gallery. It need not have a page."),
      }),
      output: z.object({
        path: z.string(),
        has_page: z.boolean().describe("False when things are filed under a path that has no page at it"),
        pages: z.array(z.object({ path: z.string(), title: z.string(), url: z.string() })),
        collections: z.array(
          z.object({
            path: z.string(),
            items: z.number().describe("How many items it holds"),
            rev: z.number().describe("The collection rev, for reorder_items"),
            refs: z.record(z.string(), z.string()).describe("Field name to the collection its ids come from"),
            url: z.string().describe("Serves the items as a bare JSON array"),
          }),
        ),
        assets: z.array(z.object({ path: z.string(), bytes: z.number(), url: z.string() })),
      }),
    },
    async ({ path: raw }, app) => {
      const path = requirePath(raw);
      if (path === "/") throw new EndpointError(400, ROOT_IS_NOT_A_BUNDLE);
      const [contents, page] = await Promise.all([bundleContents(app, path), getPage(app, path)]);

      const pages = contents.pages.map((entry) => ({
        path: entry.path,
        title: entry.title,
        url: urlFor(app, entry.path),
      }));
      const collections = contents.collections.map((c) => ({
        path: c.path,
        items: c.count,
        rev: c.rev,
        refs: c.refs,
        url: dataUrl(app, c.path),
      }));
      const assets = contents.assets.map((a) => ({
        path: a.path!,
        bytes: a.size,
        url: resourceUrl(app, "asset", a.path!),
      }));

      // A bundle holding a page and nothing else, and a path where nothing exists, are different situations.
      if (!page && pages.length === 0 && collections.length === 0 && assets.length === 0)
        throw new EndpointError(
          400,
          `Nothing is published at ${path}: no page there, and no collection or asset under it. ` +
            `Call list_pages or list_collections to see what does exist.`,
        );

      return { path, has_page: Boolean(page), pages, collections, assets };
    },
  ),

  copy_page: transferEndpoint("page", "copy", {
    what: "page",
    lead:
      "Duplicate a page at another path, body byte for byte. The copy keeps every URL written into its body, so it " +
      "fetches the original's collections and assets until you edit it.",
  }),
  move_page: transferEndpoint("page", "move", {
    what: "page",
    lead:
      "Rename a page. Collections and assets under its old path are untouched and stay exactly where they are; the " +
      "reply names every one of them, because the page no longer sits in the same bundle as them. The old URL stops " +
      "resolving at once, so any link to it breaks. To take a page and its data together, use move_bundle.",
  }),
  delete_page: transferEndpoint("page", "delete", {
    what: "page",
    lead:
      "Remove one page. Collections and assets under its path are untouched and stay exactly where they are, and " +
      "the reply names every one of them. To delete a page together with everything under it, use delete_bundle.",
  }),

  copy_collection: transferEndpoint("collection", "copy", {
    what: "collection",
    lead:
      "Duplicate a collection at another path with every id, position and nested value intact. The copy is a new " +
      "collection, so its items start at fresh revs and the source keeps its own. Reference declarations come with " +
      "it, pointing where they pointed.",
  }),
  move_collection: transferEndpoint("collection", "move", {
    what: "collection",
    lead:
      "Rename a collection, keeping every id, position, nested value and item rev. Its /data URL stops serving the " +
      "moment this returns, so every page fetching it breaks until you edit that page; the reply gives the lines. " +
      "When you cannot take that gap, copy_collection instead, repoint the page, check it renders, then " +
      "delete_collection. To move a collection together with the page that renders it, use move_bundle.",
  }),
  delete_collection: transferEndpoint("collection", "delete", {
    what: "collection",
    lead:
      "Remove a whole collection and every item in it. Records in other collections that reference its ids are " +
      "listed in the reply, because they are about to point at nothing.",
  }),

  copy_asset: transferEndpoint("asset", "copy", {
    what: "asset path",
    lead:
      "Duplicate a stored file at another path, bytes unchanged. An asset stored under a content hash has no path " +
      "to copy from.",
  }),
  move_asset: transferEndpoint("asset", "move", {
    what: "asset path",
    lead:
      "Rename a stored file. Its old /assets URL stops resolving at once, so every page holding that URL breaks " +
      "until you edit it; the reply gives the lines. An asset stored under a content hash has no path and cannot be " +
      "moved to one.",
  }),
  delete_asset: transferEndpoint("asset", "delete", {
    what: "asset path, or hash key for an older upload",
    lead: "Remove one stored file, by its path or, for one uploaded before paths existed, by its content hash key.",
  }),

  copy_bundle: transferEndpoint("bundle", "copy", {
    what: "bundle path",
    lead:
      "Duplicate everything at and under one path in a single operation: the page there, every page beneath it, " +
      "every collection and every asset. A reference from one copied collection to another is rewritten to the new " +
      "path, so the copy is internally consistent; one pointing outside the bundle is left alone. Called without " +
      "confirm: true it copies nothing and returns the full inventory it would write.",
  }),
  move_bundle: transferEndpoint("bundle", "move", {
    what: "bundle path",
    lead:
      "Move everything at and under one path in a single operation, keeping a page together with the collections " +
      "and assets it renders. One call, nothing read into this conversation, every id, position, rev and reference " +
      "preserved. References between collections in the bundle are rewritten to the new paths; references from " +
      "outside it break, and the reply names them. Called without confirm: true it moves nothing and returns the " +
      "full inventory it would move.",
  }),
  delete_bundle: transferEndpoint("bundle", "delete", {
    what: "bundle path",
    lead:
      "Delete everything at and under one path: the page there, every page beneath it, every collection and every " +
      "asset. This is the only tool that deletes more than one thing, and it cannot be undone. Called without " +
      "confirm: true it deletes nothing and returns the full inventory it would delete, including records in other " +
      "bundles that reference ids it would remove; read that before confirming. To remove only the page and leave " +
      "its data alone, use delete_page.",
  }),
};
