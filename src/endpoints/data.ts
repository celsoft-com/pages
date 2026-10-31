import { EndpointError, endpoint, jsonPath, query } from "@celsoft/platform";
import { z } from "zod";
import { similarity } from "../data/match";
import { matchItem, parseQuery } from "../data/query";
import {
  brokenRefs,
  deleteItem,
  getCollection,
  listCollections,
  normalizeCollectionPath,
  putItem,
  reorderItems,
  revOf,
  setRefs,
} from "../data/service";
import { collectionEntries } from "../inventory";
import type { Item } from "../types";
import { atPath, BUNDLES, dataUrl, requirePath as requireAnyPath, site } from "./shared";

const SERVING =
  "How it is served: take the collection path, prefix /data and add .json. Collection /a/b is served at /data/a/b.json, " +
  "/products at /data/products.json. Paths are lowercased and any .json you pass is ignored, so /Products, products " +
  "and /products.json are all the collection /products; the address always uses the normalized path, which every reply " +
  "echoes back as url. A GET returns a bare JSON array of the items, with no wrapper object, and each served item " +
  "includes its id along with the fields you wrote. Array order is the collection order set by reorder_items and by " +
  "put_item's index, and is preserved exactly, so a page needs no sort field. Nested objects and arrays of objects are " +
  "stored and served unchanged. Writing an item is live at once: nothing is rebuilt and no deploy is involved. " +
  "GET /data/_collections.json for the index of every collection: an array of {path, url, count, rev, updatedAt} " +
  "sorted by path, so a page can discover collections over plain HTTP with no access to these tools.";

const ENVELOPE = "GET the url returns just the items array, without this envelope";

const REVS =
  "Every item carries a rev, a number that changes whenever that item changes. It is kept outside the stored JSON, " +
  "so it never appears in what the url serves. Pass the rev you read back as if_rev when you write, and a write " +
  "built on a stale read is refused instead of silently clobbering someone else's edit.";

const COLLECTION = z.string().describe("Collection path, for example /products");
const FIELDS = z.record(z.string(), z.unknown());
const FILTER = jsonPath().describe(
  "An RFC 9535 JSONPath query run against the collection's items array, selecting the items in scope, for example " +
    '$[?@.stars == 4] or $[?@.section == "north" && @.open == true]. It must select whole items, never fields inside them.',
);

const REFERRER = z.object({
  path: z.string(),
  field: z.string(),
  count: z.number(),
  ids: z.array(z.string()).describe("Up to twenty of them"),
});

const PAGE = 1000;

function selectItems(items: Item[], filter: string | undefined): Item[] {
  if (filter === undefined) return items;
  const picked = new Set<number>();
  for (let offset = 0, total = 1; offset < total; offset += PAGE) {
    const page = query(items, filter, { limit: PAGE, offset });
    total = page.total;
    for (const { path } of page.items) {
      const index = /^\$\[(\d+)\]$/.exec(path);
      if (!index)
        throw new EndpointError(
          400,
          `filter selected ${path}, which is not a whole item. Select items, for example $[?@.stars == 4].`,
        );
      picked.add(Number(index[1]));
    }
  }
  return items.filter((_, index) => picked.has(index));
}

// A collection path ignores a trailing .json, which a page path would keep.
const requirePath = (raw: string) => requireAnyPath(raw, normalizeCollectionPath);
const atCollection = atPath(normalizeCollectionPath);

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

function project(item: Item, fields: string[] | undefined): Record<string, unknown> {
  if (!fields || fields.length === 0) return item;
  const picked: Record<string, unknown> = { id: item.id };
  for (const field of fields) if (field !== "id") picked[field] = item[field];
  return picked;
}

export const dataEndpoints = {
  list_collections: endpoint(
    {
      serve: ["api", "mcp"],
      method: "GET",
      path: "/api/v1/list_collections",
      description:
        "List every JSON data collection on this site with its item count and public URL. " +
        "A collection is an ordered array of items a page fetches and renders. " +
        BUNDLES +
        " " +
        SERVING,
      access: { point: site, level: "read" },
      input: z.object({}),
      output: z.object({
        collections: z.array(
          z.object({
            path: z.string(),
            items: z.number().describe("How many items it holds"),
            rev: z.number().describe("The collection rev, for reorder_items"),
            refs: z.record(z.string(), z.string()).describe("Field name to the collection its ids come from"),
            url: z.string().describe("Serves the items as a bare JSON array"),
          }),
        ),
      }),
    },
    async (_input, app) => ({
      collections: (await collectionEntries(app)).map((c) => ({
        path: c.path,
        items: c.count,
        rev: c.rev,
        refs: c.refs,
        url: dataUrl(app, c.path),
      })),
    }),
  ),

  list_items: endpoint(
    {
      serve: ["api", "mcp"],
      method: "GET",
      path: "/api/v1/list_items",
      description:
        "Return items from a collection in order. Ask for only the fields you need and page with limit and offset; the whole collection is rarely worth reading. " +
        "The reply wraps the items in an envelope with the collection total, its public url and a rev for each item; the url itself serves the bare array. " +
        SERVING +
        " " +
        REVS,
      access: { point: atCollection, level: "read" },
      input: z.object({
        path: COLLECTION,
        fields: z
          .array(z.string())
          .optional()
          .describe("Field names to include. Defaults to every field. id is always included."),
        limit: z.number().optional().describe("Maximum items to return. Defaults to 50."),
        offset: z.number().optional().describe("Items to skip. Defaults to 0."),
      }),
      output: z.object({
        path: z.string(),
        url: z.string().describe("Serves the bare items array, without this envelope"),
        served: z.string().describe("Says so in the reply itself, because the two shapes are easy to confuse"),
        rev: z.number().describe("The collection rev, for reorder_items"),
        total: z.number().describe("Items in the whole collection, not in this page of them"),
        offset: z.number(),
        items: z.array(
          z.object({
            id: z.string(),
            rev: z.number().describe("Pass back as if_rev when you write this item"),
            item: FIELDS.describe("The item's fields, cut down to the ones you asked for"),
          }),
        ),
      }),
    },
    async ({ path: raw, fields, limit, offset }, app) => {
      const path = requirePath(raw);
      const collection = await getCollection(app, path);
      if (!collection) throw new EndpointError(400, `No collection exists at ${path}. Use put_item to create it.`);
      const start = Math.max(0, offset ?? 0);
      const page = collection.items.slice(start, start + Math.max(1, limit || 50));
      return {
        path: collection.path,
        url: dataUrl(app, collection.path),
        served: ENVELOPE,
        rev: collection.rev,
        total: collection.items.length,
        offset: start,
        items: page.map((item) => ({
          id: item.id,
          rev: revOf(collection, item.id),
          item: project(item, fields),
        })),
      };
    },
  ),

  count_items: endpoint(
    {
      serve: ["api", "mcp"],
      method: "GET",
      path: "/api/v1/count_items",
      description:
        "Count records grouped by one or more fields, without reading them. " +
        "Use this when the question is about the shape of a collection rather than its contents: what is missing, what is thin, where coverage is uneven, how many of each kind there are. " +
        'Gaps show up as combinations that return no row, so this answers "what haven\'t we covered" as well as "how many". ' +
        "Reach for it before proposing additions to a collection, so suggestions target the actual holes rather than areas already well covered. " +
        "Prefer it over list_items whenever you only need counts: on a collection of a few hundred records the response is a small table rather than tens of kilobytes, and it does not fill your context with prose you will not use. " +
        "Use list_items when you need record contents, search_items when looking for particular records, and match_names when checking whether one specific thing already exists. " +
        "On collections of only a few dozen records this is not worth it; the value scales with size and is substantial by a couple of hundred.",
      access: { point: atCollection, level: "read" },
      input: z.object({
        path: z.string().describe("Collection to aggregate, for example /trip/items"),
        group_by: z
          .array(z.string())
          .min(1)
          .max(3)
          .describe("Field names to group by, at most 3, applied in the order given"),
        filter: FILTER.optional().describe(
          "Count only the items this RFC 9535 JSONPath query selects, for example $[?@.stars >= 4]. Omit to count the whole collection.",
        ),
      }),
      output: z.object({
        path: z.string(),
        total: z.number().describe("Records counted, after any filter"),
        group_by: z.array(z.string()),
        filter: z.string().optional().describe("Echoed back when one was passed"),
        rows: z
          .array(FIELDS.describe("One row per combination: each grouped field, plus count"))
          .describe("Sorted by the grouped values. A combination with no records has no row."),
      }),
    },
    async ({ path: raw, group_by: fields, filter }, app) => {
      const path = requirePath(raw);
      const collection = await getCollection(app, path);
      if (!collection) throw new EndpointError(400, `No collection exists at ${path}. Nothing to count.`);

      const inScope = selectItems(collection.items, filter);
      for (const item of inScope)
        for (const field of fields) {
          const value = item[field];
          if (typeof value === "object" && value !== null)
            throw new EndpointError(
              400,
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
          throw new EndpointError(
            400,
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
        ...(filter === undefined ? {} : { filter }),
        rows,
      };
    },
  ),

  get_item: endpoint(
    {
      serve: ["api", "mcp"],
      method: "GET",
      path: "/api/v1/get_item",
      description:
        "Return a single item from a collection by its id, with the rev to pass back as if_rev when you write. " + REVS,
      access: { point: atCollection, level: "read" },
      input: z.object({ path: z.string(), id: z.string() }),
      output: z.object({
        path: z.string(),
        url: z.string(),
        id: z.string(),
        rev: z.number().describe("Pass back as if_rev when you write"),
        item: FIELDS.describe("Every stored field, nested values unchanged"),
      }),
    },
    async ({ path: raw, id }, app) => {
      const path = requirePath(raw);
      const collection = await getCollection(app, path);
      const item = collection?.items.find((i) => i.id === id);
      if (!collection || !item) throw new EndpointError(400, `No item ${id} in ${path}`);
      return {
        path,
        url: dataUrl(app, path),
        id: item.id,
        rev: revOf(collection, item.id),
        item,
      };
    },
  ),

  put_item: endpoint(
    {
      serve: ["api", "mcp"],
      method: "POST",
      path: "/api/v1/put_item",
      description:
        "Write one item without rewriting the collection. By default the given fields are merged into the existing item and everything else is left alone; pass merge false to replace it outright. Creates the collection when it does not exist. Omit id to append a new item with a generated id. " +
        "Updating an item needs the if_rev you read from get_item, list_items or search_items, so a write from a stale read is refused rather than clobbering a newer one; pass overwrite true only when you mean to discard whatever is there. " +
        "fields takes any JSON value, nested objects and arrays of objects included, and they round-trip unchanged. Merging is shallow: a nested object or array you pass replaces the stored one outright rather than being merged key by key, so send the whole nested value. " +
        SERVING +
        " " +
        REVS,
      access: { point: atCollection, level: "write" },
      input: z.object({
        path: COLLECTION,
        id: z.string().optional().describe("Item id. Omit to create a new item."),
        fields: FIELDS.describe("Field values to write"),
        merge: z.boolean().optional().describe("Merge into the existing item. Defaults to true."),
        index: z.number().optional().describe("Position in the collection. Defaults to the end for new items."),
        if_rev: z
          .number()
          .optional()
          .describe(
            "The rev you read for this item. Required to update an existing item, and the write is refused if the item has changed since. Leave it out when creating.",
          ),
        overwrite: z
          .boolean()
          .optional()
          .describe(
            "Update an existing item without checking its rev. Use only when you mean to discard whatever is there.",
          ),
      }),
      output: z.object({
        path: z.string(),
        url: z.string(),
        id: z.string().describe("Generated when you did not pass one"),
        rev: z.number().describe("The item's new rev"),
        created: z.boolean().describe("False when an existing item was updated"),
      }),
    },
    async ({ path: raw, id, fields, merge, index, if_rev, overwrite }, app) => {
      const path = requirePath(raw);
      const { item, created, rev } = await putItem(app, {
        path,
        id,
        fields,
        merge: merge !== false,
        index,
        ifRev: if_rev,
        overwrite: overwrite === true,
      });
      return { path, url: dataUrl(app, path), id: item.id, rev, created };
    },
  ),

  delete_item: endpoint(
    {
      serve: ["api", "mcp"],
      method: "POST",
      path: "/api/v1/delete_item",
      description:
        "Remove one item from a collection by its id. The rest of the collection is untouched. Pass the rev you read as if_rev and the delete is refused if the item changed since. " +
        "If other records reference this id through a declared collection reference, the delete is refused and names how many; repoint those records first, or pass force true to orphan them deliberately. " +
        "When force orphans records, the reply lists what it broke, so they can be repointed without a separate check_refs.",
      access: { point: atCollection, level: "write" },
      input: z.object({
        path: z.string(),
        id: z.string(),
        if_rev: z.number().optional().describe("The rev you read for this item"),
        force: z
          .boolean()
          .optional()
          .describe("Delete even though other records reference this id, leaving them pointing at nothing"),
      }),
      output: z.object({
        deleted: z.string().describe("The id that was removed"),
        path: z.string(),
        orphaned: z
          .array(REFERRER)
          .describe("Records left pointing at nothing, which only happens when force was passed. Empty otherwise."),
      }),
    },
    async ({ path: raw, id, if_rev, force }, app) => {
      const path = requirePath(raw);
      const { deleted, orphaned } = await deleteItem(app, path, id, if_rev, force === true);
      if (!deleted) throw new EndpointError(400, `No item ${id} in ${path}`);
      return { deleted: id, path, orphaned };
    },
  ),

  reorder_items: endpoint(
    {
      serve: ["api", "mcp"],
      method: "POST",
      path: "/api/v1/reorder_items",
      description:
        "Move the given ids to the front of the collection, in the order listed. Items left out keep their relative order behind them, so moving one item to the top only needs one id. " +
        "Pass the collection rev as if_rev and the reorder is refused if the collection changed since you read it.",
      access: { point: atCollection, level: "write" },
      input: z.object({
        path: z.string(),
        ids: z.array(z.string()).min(1).describe("Ids in the order they should appear"),
        if_rev: z.number().optional().describe("The collection rev you read from list_items or list_collections"),
      }),
      output: z.object({
        path: z.string(),
        moved: z.array(z.string()).describe("The ids now at the front, in this order"),
        rest: z.number().describe("Items behind them, keeping their previous order. They are counted, not listed."),
      }),
    },
    async ({ path: raw, ids, if_rev }, app) => {
      const path = requirePath(raw);
      const items = await reorderItems(app, path, ids, if_rev);
      // Naming the ids that did not move would return the whole collection to answer a call that named one item.
      return { path, moved: ids, rest: items.length - ids.length };
    },
  ),

  search_items: endpoint(
    {
      serve: ["api", "mcp"],
      method: "GET",
      path: "/api/v1/search_items",
      description:
        "Find items across one collection or all of them. Returns each match with its collection path, id and rev so it can be edited straight away with put_item or delete_item. " +
        "Query syntax: bare words match any field; field:value matches part of a field; field=value matches it exactly; field>10, field<10, field>=10 and field<=10 compare numbers; " +
        'field!=value excludes; has:field requires the field to be set; -term excludes matches; "quoted words" match a phrase. Terms combine with AND, and dotted paths reach nested fields.',
      access: { point: site, level: "read" },
      input: z.object({
        query: z.string().describe('For example: status=draft price>10 -sale has:image "winter coat"'),
        path: z.string().optional().describe("Collection to search. Defaults to every collection."),
        fields: z.array(z.string()).optional().describe("Field names to include in results"),
        limit: z.number().optional().describe("Maximum matches to return. Defaults to 25."),
      }),
      output: z.object({
        query: z.string().describe("Echoed back"),
        total: z.number().describe("Matches found, which can exceed the number returned"),
        matches: z.array(
          z.object({
            path: z.string().describe("The collection it was found in"),
            url: z.string(),
            id: z.string(),
            rev: z.number().describe("Pass back as if_rev when you write it"),
            index: z.number().describe("Its position in that collection"),
            item: FIELDS.describe("The fields you asked for"),
          }),
        ),
      }),
    },
    async ({ query, path, fields, limit }, app) => {
      if (query.trim() === "") throw new EndpointError(400, "query is required");
      const terms = parseQuery(query);
      const paths = path ? [requirePath(path)] : (await listCollections(app)).map((c) => c.path);

      const matches: {
        path: string;
        url: string;
        id: string;
        rev: number;
        index: number;
        item: Record<string, unknown>;
      }[] = [];
      for (const at of paths) {
        const collection = await getCollection(app, at);
        if (!collection) continue;
        collection.items.forEach((item, index) => {
          if (matchItem(item, terms))
            matches.push({
              path: at,
              url: dataUrl(app, at),
              id: item.id,
              rev: revOf(collection, item.id),
              index,
              item: project(item, fields),
            });
        });
      }
      return {
        query,
        total: matches.length,
        matches: matches.slice(0, Math.max(1, limit || 25)),
      };
    },
  ),

  match_names: endpoint(
    {
      serve: ["api", "mcp"],
      method: "GET",
      path: "/api/v1/match_names",
      description:
        "Check a batch of candidate names against a collection before creating anything, so the same entity is not added twice under a different spelling. " +
        "Matching ignores case, diacritics, punctuation and word order, and tolerates trailing qualifiers and abbreviations that prefix the full word, " +
        'so "Acme Corp." finds "ACME Corporation" and "Cafe Rouge" finds "Café Rouge". ' +
        "It compares one short field, by default name, and does not read descriptions or other long text, which mention other entities and generate false matches. " +
        'When a collection is partitioned by another field, pass filter to compare only within one partition, for example the JSONPath query $[?@.section == "north"] so north candidates are never matched against south records. ' +
        "The same name legitimately recurs once per partition, and without a filter those come back as duplicates. " +
        "Returns a result for every candidate in the order given, each with its matches sorted best first and an empty list where nothing was close enough. " +
        "A match carries the id and rev, so a duplicate can be updated with put_item instead of created. " +
        "Nothing here understands meaning, translation or transliteration between scripts: it compares how names are written. " +
        "Treat a result as a candidate to judge, not a verdict, and remember a missed match leaves a visible duplicate while a wrong one silently swallows a record that should have been created.",
      access: { point: atCollection, level: "read" },
      input: z.object({
        path: z.string().describe("Collection to match against, for example /venues"),
        names: z.array(z.string()).min(1).max(50).describe("Candidate names to look for, at most 50 per call"),
        field: z.string().optional().describe("Field to compare against. Defaults to name."),
        filter: FILTER.optional().describe(
          'Compare only the items this RFC 9535 JSONPath query selects, for example $[?@.section == "north"]. Its comparisons are exact and not normalized the way the match field is, because partition values are identifiers rather than prose. Omit to compare against the whole collection.',
        ),
        threshold: z.number().optional().describe("Lowest score worth returning, 0 to 1. Defaults to 0.6."),
        limit_per_name: z.number().optional().describe("Most matches to return per candidate. Defaults to 3."),
      }),
      output: z.object({
        path: z.string(),
        field: z.string().describe("The field compared, name unless you said otherwise"),
        filter: z.string().optional().describe("Echoed back when one was passed"),
        threshold: z.number(),
        compared: z.number().describe("Records that carried the field and were compared"),
        skipped: z.number().describe("Records in scope with no string in that field"),
        results: z
          .array(
            z.object({
              name: z.string().describe("The candidate, exactly as given"),
              matches: z
                .array(
                  z.object({
                    id: z.string(),
                    value: z.string().describe("The stored name it matched"),
                    rev: z.number(),
                    score: z.number().describe("0 to 1. Judge it, rather than trusting it."),
                  }),
                )
                .describe("Best first, and empty where nothing was close enough"),
            }),
          )
          .describe("One entry per candidate, in the order given"),
      }),
    },
    async ({ path: raw, names, field: rawField, filter, threshold: rawThreshold, limit_per_name }, app) => {
      const path = requirePath(raw);
      const collection = await getCollection(app, path);
      if (!collection) throw new EndpointError(400, `No collection exists at ${path}. Nothing to match against.`);

      const field = rawField || "name";
      const threshold = rawThreshold === undefined ? 0.6 : Math.min(1, Math.max(0, rawThreshold));
      const limit = Math.max(1, limit_per_name || 3);
      const inScope = selectItems(collection.items, filter);
      const candidates = inScope
        .map((item) => ({ item, value: item[field] }))
        .filter((entry): entry is { item: Item; value: string } => typeof entry.value === "string");

      const results = names.map((name) => ({
        name,
        matches: candidates
          .map(({ item, value }) => ({
            id: item.id,
            value,
            rev: revOf(collection, item.id),
            score: Math.round(similarity(name, value) * 1000) / 1000,
          }))
          .filter((match) => match.score >= threshold)
          .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
          .slice(0, limit),
      }));

      return {
        path: collection.path,
        field,
        ...(filter === undefined ? {} : { filter }),
        threshold,
        compared: candidates.length,
        skipped: inScope.length - candidates.length,
        results,
      };
    },
  ),

  set_collection_refs: endpoint(
    {
      serve: ["api", "mcp"],
      method: "POST",
      path: "/api/v1/set_collection_refs",
      description:
        "Declare that a field on this collection holds ids from another collection, so writes with a mistyped or stale value are rejected instead of stored. " +
        "Use this whenever records carry a value that must line up with something else: a category, a section, a status, an owner. " +
        "Without it, a typo in such a field is silent at every level. The record stores, the JSON stays valid, the page renders, and the record simply stops appearing wherever that value is used to select it. " +
        "Nobody finds out until someone goes looking for something they know should be there. " +
        "Declare the constraint when you create the collection, before the records exist, because the cost of adopting it later is auditing everything already written.",
      access: { point: atCollection, level: "write" },
      input: z.object({
        path: z.string().describe("Collection being constrained, for example /trip/items"),
        refs: z
          .record(z.string(), z.string())
          .describe(
            'Field name to referenced collection path, for example {"group": "/trip/filters"}. An empty object clears every constraint.',
          ),
      }),
      output: z.object({
        path: z.string(),
        refs: z
          .record(z.string(), z.string())
          .describe("Field name to the collection its ids come from, as now declared"),
        violations: z
          .number()
          .describe("Records already holding a value the new constraint rejects. Run check_refs to see them."),
        missing: z
          .array(z.string())
          .describe("Referenced collections that do not exist yet, so every value is rejected until they do"),
      }),
    },
    async ({ path: raw, refs: wanted }, app) => {
      const path = requirePath(raw);
      const { refs, violations, missing } = await setRefs(app, path, wanted);
      return { path, refs, violations, missing };
    },
  ),

  check_refs: endpoint(
    {
      serve: ["api", "mcp"],
      method: "GET",
      path: "/api/v1/check_refs",
      description:
        "Find records whose reference fields point at ids that do not exist. " +
        "This only checks fields declared with set_collection_refs; if a collection has none declared, nothing is checked and the reply says so rather than reporting a clean bill of health. " +
        "Check refs_declared to see what was actually verified before trusting an empty result. " +
        "Run it after any bulk load, after deleting or renaming ids in a referenced collection, and whenever count_items shows an unexpected value in a grouping, since a group of one is usually a typo rather than a real category. " +
        "Declaring the reference is the stronger fix where the collection is new enough to allow it, because put_item then rejects the bad value at the moment it is written; this audit is for records created before the constraint existed.",
      access: { point: atCollection, level: "read" },
      input: z.object({
        path: z.string().describe("Collection to audit"),
        field: z.string().optional().describe("One reference field. Omit to check every declared reference."),
      }),
      output: z.union([
        z
          .object({
            path: z.string(),
            checked: z.number().describe("0"),
            refs_declared: z.record(z.string(), z.string()).describe("Empty"),
            broken: z.array(z.unknown()).describe("Empty, and it means nothing was looked at"),
            warning: z.string().describe("Says so, so an empty broken list is not read as a clean bill of health"),
          })
          .describe("Nothing is declared, so nothing was checked"),
        z
          .object({
            path: z.string(),
            checked: z.number().describe("Records examined"),
            refs_declared: z.record(z.string(), z.string()).describe("What was verified"),
            broken: z.array(
              z.object({
                id: z.string(),
                field: z.string(),
                value: z.unknown().describe("The stored value that matches no id"),
                references: z.string().describe("The collection it should have named"),
              }),
            ),
          })
          .describe("References were declared, so something was checked"),
      ]),
    },
    async ({ path, field }, app) => brokenRefs(app, requirePath(path), field),
  ),
};
