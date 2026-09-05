import { normalizePath } from "../pages/path";
import { encodeKey, stores } from "../store";
import type { Collection, CollectionSummary, Item } from "../types";

const ID_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;

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

export async function getCollection(path: string): Promise<Collection | null> {
  const stored = (await stores.data().get(encodeKey(normalizeCollectionPath(path)), { type: "json" })) as
    | Collection
    | null;
  if (!stored) return null;
  return { ...stored, rev: stored.rev ?? 0, revs: stored.revs ?? {} };
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

export async function listCollections(): Promise<CollectionSummary[]> {
  const { blobs } = await stores.data().list();
  const summaries = await Promise.all(
    blobs.map(async (blob) => {
      const collection = (await stores.data().get(blob.key, { type: "json" })) as Collection | null;
      if (!collection) return null;
      return {
        path: collection.path,
        count: collection.items.length,
        rev: collection.rev ?? 0,
        updatedAt: collection.updatedAt,
      } satisfies CollectionSummary;
    }),
  );
  return summaries.filter((c): c is CollectionSummary => c !== null).sort((a, b) => a.path.localeCompare(b.path));
}

export async function saveCollection(path: string, items: Item[]): Promise<Collection> {
  const normalized = normalizeCollectionPath(path);
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
    rev,
    revs,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await stores.data().setJSON(encodeKey(normalized), collection);
  return collection;
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

export async function deleteItem(path: string, id: string, ifRev?: number): Promise<boolean> {
  const normalized = normalizeCollectionPath(path);
  const collection = await getCollection(normalized);
  if (!collection) return false;

  const remaining = collection.items.filter((i) => i.id !== id);
  if (remaining.length === collection.items.length) return false;

  const current = revOf(collection, id);
  if (ifRev !== undefined && ifRev !== current)
    throw new Error(
      `Item "${id}" in ${normalized} has changed since you read it: you have rev ${ifRev}, it is now ` +
        `rev ${current}. Read it again with get_item before deleting it.`,
    );

  await saveCollection(normalized, remaining);
  return true;
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
