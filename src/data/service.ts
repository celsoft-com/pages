import { similarity } from "./match";
import { normalizePath } from "../pages/path";
import { encodeKey, stores } from "../store";
import type { Collection, CollectionSummary, Item } from "../types";

const ID_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;

// Reserved: served as the browser-readable index of every collection.
export const MANIFEST_PATH = "/_collections";

export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export function normalizeCollectionPath(input: string): string {
  return normalizePath(input.replace(/\.json$/i, ""));
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

// Every read goes through this. A blob written before a field existed still has to
// come back with that field, and there is more than one way into storage.
function hydrate(stored: Collection): Collection {
  return {
    ...stored,
    items: stored.items ?? [],
    refs: stored.refs ?? {},
    rev: stored.rev ?? 0,
    revs: stored.revs ?? {},
  };
}

export async function getCollection(path: string): Promise<Collection | null> {
  const stored = (await stores.data().get(encodeKey(normalizeCollectionPath(path)), { type: "json" })) as
    | Collection
    | null;
  return stored ? hydrate(stored) : null;
}

export function revOf(collection: Collection, id: string): number {
  return collection.revs[id] ?? 0;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`).join(",")}}`;
}

// Bumped whenever CollectionSummary gains a field. Metadata written under an older number is not
// trusted or patched up: the blob is read and the summary derived, which is slower and always right.
const SUMMARY_VERSION = 1;

function summarize(collection: Collection): CollectionSummary & { v: number } {
  return {
    v: SUMMARY_VERSION,
    path: collection.path,
    count: collection.items.length,
    refs: collection.refs,
    rev: collection.rev,
    updatedAt: collection.updatedAt,
  };
}

// The only way a collection blob is written, transfer.ts included. The summary rides along as
// metadata so listCollections can answer without reading every item of every collection, and it
// cannot drift from the blob because nothing else writes one.
export async function writeCollectionBlob(key: string, collection: Collection): Promise<void> {
  await stores.data().setJSON(key, collection, { metadata: { ...summarize(collection) } });
}

export async function listCollections(): Promise<CollectionSummary[]> {
  const { blobs } = await stores.data().list();
  const summaries = await Promise.all(
    blobs.map(async (blob) => {
      const found = await stores.data().getMetadata(blob.key);
      const summary = found?.metadata as unknown as (CollectionSummary & { v?: number }) | undefined;
      if (summary?.v === SUMMARY_VERSION) {
        const { v: _version, ...rest } = summary;
        return rest satisfies CollectionSummary;
      }
      const stored = (await stores.data().get(blob.key, { type: "json" })) as Collection | null;
      if (!stored) return null;
      const { v: _v, ...rest } = summarize(hydrate(stored));
      return rest satisfies CollectionSummary;
    }),
  );
  return summaries.filter((c): c is CollectionSummary => c !== null).sort((a, b) => a.path.localeCompare(b.path));
}

export async function saveCollection(path: string, items: Item[]): Promise<Collection> {
  const normalized = normalizeCollectionPath(path);
  if (normalized === MANIFEST_PATH)
    throw new Error(`${MANIFEST_PATH} is reserved for the index of collections. Pick another path.`);

  const existing = await getCollection(normalized);
  const now = Date.now();
  const rev = (existing?.rev ?? 0) + 1;

  const before = new Map((existing?.items ?? []).map((item) => [item.id, canonical(item)]));
  const revs: Record<string, number> = {};
  for (const item of items) {
    const unchanged = before.get(item.id) === canonical(item);
    revs[item.id] = unchanged ? (existing?.revs[item.id] ?? rev) : rev;
  }

  const collection: Collection = {
    path: normalized,
    items,
    refs: existing?.refs ?? {},
    rev,
    revs,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await writeCollectionBlob(encodeKey(normalized), collection);
  return collection;
}

export async function manifest(): Promise<
  { path: string; url: string; count: number; rev: number; updatedAt: number }[]
> {
  return (await listCollections()).map((c) => ({
    path: c.path,
    url: `/data${c.path === "/" ? "/index" : c.path}.json`,
    count: c.count,
    rev: c.rev,
    updatedAt: c.updatedAt,
  }));
}

export async function deleteCollection(path: string): Promise<boolean> {
  const normalized = normalizeCollectionPath(path);
  if (!(await getCollection(normalized))) return false;
  await stores.data().delete(encodeKey(normalized));
  return true;
}

function freshId(fields: Record<string, unknown>, taken: Set<string>): string {
  const source = fields.slug ?? fields.title ?? fields.name;
  const base = typeof source === "string" ? slugify(source) : "";
  if (base && !taken.has(base)) return base;

  const prefix = base || "item";
  for (let n = base ? 2 : 1; ; n++) {
    const candidate = `${prefix}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export async function putItem(input: {
  path: string;
  id?: string;
  fields: Record<string, unknown>;
  merge: boolean;
  index?: number;
  ifRev?: number;
  overwrite?: boolean;
}): Promise<{ item: Item; created: boolean; rev: number }> {
  const path = normalizeCollectionPath(input.path);
  const collection = await getCollection(path);
  const items = collection?.items ?? [];
  const taken = new Set(items.map((i) => i.id));

  const id = input.id ?? freshId(input.fields, taken);
  if (!isValidId(id))
    throw new Error(`id "${id}" is not usable. Use letters, numbers, dashes, dots or underscores.`);

  await validateRefs(path, input.fields);

  const at = items.findIndex((i) => i.id === id);

  if (at === -1 && input.ifRev !== undefined)
    throw new Error(
      `No item "${id}" in ${path} to match if_rev ${input.ifRev}. It may have been deleted. ` +
        `Call list_items to see what is there, then write without if_rev to create it.`,
    );

  if (at !== -1) {
    const current = revOf(collection!, id);
    if (input.ifRev === undefined && input.overwrite !== true)
      throw new Error(
        `Item "${id}" in ${path} already exists at rev ${current}. Read it with get_item and pass ` +
          `if_rev: ${current}, or pass overwrite: true to write without checking.`,
      );
    if (input.ifRev !== undefined && input.ifRev !== current)
      throw new Error(
        `Item "${id}" in ${path} has changed since you read it: you have rev ${input.ifRev}, it is now ` +
          `rev ${current}. Read it again with get_item and reapply your change.`,
      );
  }
  const { id: _ignored, ...fields } = input.fields;
  const item: Item = at === -1 || !input.merge ? { id, ...fields } : { ...items[at], ...fields, id };

  if (at === -1) {
    const position = input.index === undefined ? items.length : Math.max(0, Math.min(input.index, items.length));
    items.splice(position, 0, item);
  } else {
    items[at] = item;
    if (input.index !== undefined && input.index !== at) {
      items.splice(at, 1);
      items.splice(Math.max(0, Math.min(input.index, items.length)), 0, item);
    }
  }

  const saved = await saveCollection(path, items);
  return { item, created: at === -1, rev: revOf(saved, id) };
}

export async function deleteItem(
  path: string,
  id: string,
  ifRev?: number,
  force = false,
): Promise<{ deleted: boolean; orphaned: Referrer[] }> {
  const normalized = normalizeCollectionPath(path);
  const collection = await getCollection(normalized);
  if (!collection) return { deleted: false, orphaned: [] };

  const remaining = collection.items.filter((i) => i.id !== id);
  if (remaining.length === collection.items.length) return { deleted: false, orphaned: [] };

  const current = revOf(collection, id);
  if (ifRev !== undefined && ifRev !== current)
    throw new Error(
      `Item "${id}" in ${normalized} has changed since you read it: you have rev ${ifRev}, it is now ` +
        `rev ${current}. Read it again with get_item before deleting it.`,
    );

  const orphaned = await referrers(normalized, id);
  const total = orphaned.reduce((sum, entry) => sum + entry.count, 0);
  if (total > 0 && !force)
    throw new Error(
      `Deleting "${id}" from ${normalized} would orphan ${total} record${total === 1 ? "" : "s"} that reference it: ` +
        `${orphaned.map((e) => `${e.count} in ${e.path} via ${e.field}`).join(", ")}. ` +
        `Repoint them first, or pass force: true to delete anyway.`,
    );

  await saveCollection(normalized, remaining);
  return { deleted: true, orphaned };
}

export async function reorderItems(path: string, ids: string[], ifRev?: number): Promise<Item[]> {
  const normalized = normalizeCollectionPath(path);
  const collection = await getCollection(normalized);
  if (!collection) throw new Error(`No collection exists at ${normalized}`);

  if (ifRev !== undefined && ifRev !== collection.rev)
    throw new Error(
      `Collection ${normalized} has changed since you read it: you have rev ${ifRev}, it is now ` +
        `rev ${collection.rev}. Call list_items again before reordering.`,
    );

  const byId = new Map(collection.items.map((i) => [i.id, i]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new Error(`No item with id ${missing.join(", ")} in ${normalized}`);

  const named = ids.map((id) => byId.get(id)!);
  const rest = collection.items.filter((i) => !ids.includes(i.id));
  const items = [...named, ...rest];

  await saveCollection(normalized, items);
  return items;
}

export async function setRefs(
  path: string,
  refs: Record<string, string>,
): Promise<{ refs: Record<string, string>; violations: number; missing: string[] }> {
  const normalized = normalizeCollectionPath(path);
  const collection = await getCollection(normalized);
  if (!collection) throw new Error(`No collection exists at ${normalized}. Create it before constraining it.`);

  const cleaned: Record<string, string> = {};
  for (const [field, target] of Object.entries(refs)) {
    if (typeof target !== "string" || target.trim() === "")
      throw new Error(`refs.${field} must be the path of the collection its ids come from, for example /filters`);
    cleaned[field] = normalizeCollectionPath(target);
  }

  await writeCollectionBlob(encodeKey(normalized), { ...collection, refs: cleaned, updatedAt: Date.now() });

  const missing: string[] = [];
  for (const target of new Set(Object.values(cleaned)))
    if (!(await getCollection(target))) missing.push(target);

  const { broken } = await brokenRefs(normalized);
  return { refs: cleaned, violations: broken.length, missing };
}

async function idsIn(path: string): Promise<Set<string>> {
  return new Set(((await getCollection(path))?.items ?? []).map((item) => item.id));
}

function suggest(value: unknown, ids: Set<string>): string {
  if (ids.size === 0) return "That collection has no items yet.";

  const close = [...ids]
    .map((id) => ({ id, score: similarity(String(value), id) }))
    .filter((entry) => entry.score >= 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((entry) => entry.id);

  if (close.length > 0) return `Closest ids: ${close.join(", ")}.`;
  return `Ids there include: ${[...ids].slice(0, 5).join(", ")}.`;
}

export async function validateRefs(path: string, fields: Record<string, unknown>): Promise<void> {
  const collection = await getCollection(normalizeCollectionPath(path));
  for (const [field, target] of Object.entries(collection?.refs ?? {})) {
    if (!(field in fields)) continue;

    const value = fields[field];
    if (value === null || value === undefined) continue;

    const ids = await idsIn(target);
    if (typeof value === "string" && ids.has(value)) continue;

    throw new Error(
      `Field "${field}" value ${JSON.stringify(value)} is not an id in ${target}. ${suggest(value, ids)}`,
    );
  }
}

export async function brokenRefs(
  path: string,
  field?: string,
): Promise<{
  path: string;
  checked: number;
  refs_declared: Record<string, string>;
  broken: { id: string; field: string; value: unknown; references: string }[];
  warning?: string;
}> {
  const normalized = normalizeCollectionPath(path);
  const collection = await getCollection(normalized);
  if (!collection) throw new Error(`No collection exists at ${normalized}`);

  if (field !== undefined && !(field in collection.refs))
    throw new Error(
      `Field "${field}" on ${normalized} does not reference another collection. ` +
        `Declared references: ${Object.keys(collection.refs).join(", ") || "none"}.`,
    );

  const fields = field === undefined ? Object.keys(collection.refs) : [field];

  // An audit that verified nothing must not look like an audit that passed.
  if (fields.length === 0)
    return {
      path: normalized,
      checked: 0,
      refs_declared: {},
      broken: [],
      warning:
        `No references are declared on ${normalized}, so nothing was checked. ` +
        `Declare them with set_collection_refs.`,
    };

  const known = new Map<string, Set<string>>();
  for (const target of new Set(fields.map((name) => collection.refs[name])))
    known.set(target, await idsIn(target));

  const broken: { id: string; field: string; value: unknown; references: string }[] = [];
  for (const item of collection.items)
    for (const name of fields) {
      const value = item[name];
      if (value === null || value === undefined) continue;
      const target = collection.refs[name];
      if (typeof value === "string" && known.get(target)!.has(value)) continue;
      broken.push({ id: item.id, field: name, value, references: target });
    }

  return {
    path: normalized,
    checked: collection.items.length,
    refs_declared: collection.refs,
    broken,
  };
}

const ORPHAN_ID_CAP = 20;

export interface Referrer {
  path: string;
  field: string;
  count: number;
  ids: string[];
}

export async function referrers(target: string, id: string): Promise<Referrer[]> {
  const normalized = normalizeCollectionPath(target);
  const found: Referrer[] = [];

  for (const summary of await listCollections()) {
    const collection = await getCollection(summary.path);
    if (!collection) continue;
    for (const [field, points] of Object.entries(collection.refs)) {
      if (points !== normalized) continue;
      const pointing = collection.items.filter((item) => item[field] === id);
      if (pointing.length > 0)
        found.push({
          path: collection.path,
          field,
          count: pointing.length,
          ids: pointing.slice(0, ORPHAN_ID_CAP).map((item) => item.id),
        });
    }
  }

  return found;
}
