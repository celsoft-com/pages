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
  const stored = await stores.data().get(encodeKey(normalizeCollectionPath(path)), { type: "json" });
  return (stored as Collection | null) ?? null;
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
  const collection: Collection = {
    path: normalized,
    items,
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
}): Promise<{ item: Item; created: boolean }> {
  const path = normalizeCollectionPath(input.path);
  const items = (await getCollection(path))?.items ?? [];
  const taken = new Set(items.map((i) => i.id));

  const id = input.id ?? freshId(input.fields, taken);
  if (!isValidId(id))
    throw new Error(`id "${id}" is not usable. Use letters, numbers, dashes, dots or underscores.`);

  const at = items.findIndex((i) => i.id === id);
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

  await saveCollection(path, items);
  return { item, created: at === -1 };
}

export async function deleteItem(path: string, id: string): Promise<boolean> {
  const normalized = normalizeCollectionPath(path);
  const collection = await getCollection(normalized);
  if (!collection) return false;

  const remaining = collection.items.filter((i) => i.id !== id);
  if (remaining.length === collection.items.length) return false;

  await saveCollection(normalized, remaining);
  return true;
}

export async function reorderItems(path: string, ids: string[]): Promise<Item[]> {
  const normalized = normalizeCollectionPath(path);
  const collection = await getCollection(normalized);
  if (!collection) throw new Error(`No collection exists at ${normalized}`);

  const byId = new Map(collection.items.map((i) => [i.id, i]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new Error(`No item with id ${missing.join(", ")} in ${normalized}`);

  const named = ids.map((id) => byId.get(id)!);
  const rest = collection.items.filter((i) => !ids.includes(i.id));
  const items = [...named, ...rest];

  await saveCollection(normalized, items);
  return items;
}
