import { AsyncLocalStorage } from "node:async_hooks";
import type { Files } from "@celsoft/platform";
import { and, eq, inArray, like } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { resourceMeta, siteValues } from "./schema";
import type * as schema from "./schema";

type Metadata = Record<string, unknown>;
type ReadType = "json" | "arrayBuffer" | "text";

// The shape every service was written against when this was Netlify Blobs, kept so that moving
// storage changed one file rather than every caller.
export interface BlobStore {
  get(key: string, options?: { type?: ReadType }): Promise<any>;
  getWithMetadata(key: string, options?: { type?: ReadType }): Promise<{ data: any; metadata: Metadata } | null>;
  getMetadata(key: string): Promise<{ metadata: Metadata } | null>;
  set(key: string, value: ArrayBuffer | string, options?: { metadata?: Metadata }): Promise<void>;
  // onlyIfNew leaves an existing value alone, which is how a race to create one is lost safely.
  setJSON(key: string, value: unknown, options?: { metadata?: Metadata; onlyIfNew?: boolean }): Promise<void>;
  delete(key: string): Promise<void>;
  // Each key comes back with its metadata, read in one query, so a listing never asks per key.
  list(options?: { prefix?: string }): Promise<{ blobs: { key: string; metadata: Metadata | null }[] }>;
}

export interface Backend {
  store(name: StoreName): BlobStore;
}

type StoreName = "site" | "pages" | "assets" | "data" | "oauth";

const context = new AsyncLocalStorage<Backend>();
let fallback: Backend | undefined;

export function withBackend<T>(backend: Backend, run: () => T): T {
  return context.run(backend, run);
}

// Tests have no request to run inside, so they install one backend for the whole suite.
export function setDefaultBackend(backend: Backend | undefined): void {
  fallback = backend;
}

function backend(): Backend {
  const found = context.getStore() ?? fallback;
  if (!found) throw new Error("storage used outside a request");
  return found;
}

export const stores = {
  site: () => backend().store("site"),
  pages: () => backend().store("pages"),
  assets: () => backend().store("assets"),
  data: () => backend().store("data"),
  oauth: () => backend().store("oauth"),
};

export function encodeKey(path: string): string {
  if (path === "/") return "_root";
  return path.replace(/^\//, "").replace(/\//g, "~");
}

export function decodeKey(key: string): string {
  if (key === "_root") return "/";
  return `/${key.replace(/~/g, "/")}`;
}

function decode(bytes: ArrayBuffer, type: ReadType | undefined): unknown {
  if (type === "arrayBuffer") return bytes;
  const text = new TextDecoder().decode(bytes);
  return type === "json" ? JSON.parse(text) : text;
}

function encode(value: ArrayBuffer | string): ArrayBuffer {
  return typeof value === "string" ? (new TextEncoder().encode(value).buffer as ArrayBuffer) : value;
}

export function memoryBackend(): Backend {
  const buckets = new Map<string, Map<string, { bytes: ArrayBuffer; metadata: Metadata }>>();
  const bucket = (name: string) => {
    const found = buckets.get(name) ?? new Map();
    buckets.set(name, found);
    return found;
  };
  const store = (name: StoreName): BlobStore => {
    const read = (key: string, type?: ReadType) => {
      const entry = bucket(name).get(key);
      return entry ? { data: decode(entry.bytes, type), metadata: entry.metadata } : null;
    };
    const set = async (key: string, value: ArrayBuffer | string, options?: { metadata?: Metadata }) => {
      bucket(name).set(key, { bytes: encode(value).slice(0), metadata: options?.metadata ?? {} });
    };
    return {
      get: async (key: string, options?: { type?: ReadType }) => read(key, options?.type)?.data ?? null,
      getWithMetadata: async (key: string, options?: { type?: ReadType }) => read(key, options?.type) as any,
      getMetadata: async (key) => {
        const entry = bucket(name).get(key);
        return entry ? { metadata: entry.metadata } : null;
      },
      set,
      setJSON: async (key, value, options) => {
        if (options?.onlyIfNew && bucket(name).has(key)) return;
        await set(key, JSON.stringify(value), options);
      },
      delete: async (key) => void bucket(name).delete(key),
      list: async (options) => ({
        blobs: [...bucket(name).entries()]
          .filter(([key]) => key.startsWith(options?.prefix ?? ""))
          .map(([key, entry]) => ({ key, metadata: entry.metadata })),
      }),
    };
  };
  return { store };
}

type Db = NodePgDatabase<typeof schema>;

// Pages, collections and assets are one R2 object each under a folder named for the store, with
// what the object says about itself in resource_meta. The object is the truth and listing comes
// from R2, so a metadata row with no object is never seen.
function objectStore(files: Files, db: Db, name: "pages" | "data" | "assets"): BlobStore {
  const path = (key: string) => `${name}/${key}`;
  const where = (key: string) => and(eq(resourceMeta.store, name), eq(resourceMeta.key, key));

  const getMetadata = async (key: string) => {
    const [found] = await db.select({ metadata: resourceMeta.metadata }).from(resourceMeta).where(where(key));
    return found ? { metadata: found.metadata } : null;
  };
  const read = async (key: string, type?: ReadType) => {
    const object = await files.get(path(key));
    return object ? decode(await new Response(object.body).arrayBuffer(), type) : null;
  };
  const upsert = (key: string, metadata: Metadata) =>
    db
      .insert(resourceMeta)
      .values({ store: name, key, metadata })
      .onConflictDoUpdate({ target: [resourceMeta.store, resourceMeta.key], set: { metadata, updatedAt: new Date() } });

  // A page or collection summary is a cache of its object, so the old one goes before the object
  // changes and the new one after: a failure in between leaves a summary missing, never wrong.
  // An asset's metadata is its only record of name and type, so it is written first instead, and
  // a failure leaves a row that listing never reaches because the object is not there.
  const set = async (key: string, value: ArrayBuffer | string, options?: { metadata?: Metadata }) => {
    const metadata = options?.metadata;
    const contentType = typeof metadata?.contentType === "string" ? metadata.contentType : undefined;
    if (name === "assets") {
      await upsert(key, metadata ?? {});
      await files.put(path(key), value, contentType);
      return;
    }
    await db.delete(resourceMeta).where(where(key));
    await files.put(path(key), value, "application/json");
    if (metadata) await upsert(key, metadata);
  };

  return {
    get: (key: string, options?: { type?: ReadType }) => read(key, options?.type),
    getWithMetadata: async (key: string, options?: { type?: ReadType }) => {
      const [data, found] = await Promise.all([read(key, options?.type), getMetadata(key)]);
      return data === null ? null : ({ data, metadata: found?.metadata ?? {} } as any);
    },
    getMetadata,
    set,
    setJSON: (key, value, options) => set(key, JSON.stringify(value), options),
    delete: async (key) => {
      await files.delete(path(key));
      await db.delete(resourceMeta).where(where(key));
    },
    list: async (options) => {
      const { files: found } = await files.list(name);
      const keys = found
        .map((file) => file.path.slice(name.length + 1))
        .filter((key) => key.startsWith(options?.prefix ?? ""));
      if (keys.length === 0) return { blobs: [] };
      const rows = await db
        .select({ key: resourceMeta.key, metadata: resourceMeta.metadata })
        .from(resourceMeta)
        .where(and(eq(resourceMeta.store, name), inArray(resourceMeta.key, keys)));
      const metadata = new Map(rows.map((row) => [row.key, row.metadata]));
      return { blobs: keys.map((key) => ({ key, metadata: metadata.get(key) ?? null })) };
    },
  };
}

// Small site-wide values, one row each, named store:key so the stores never share a key.
function valueStore(db: Db, name: "site" | "oauth"): BlobStore {
  const full = (key: string) => `${name}:${key}`;
  const read = async (key: string) => {
    const [found] = await db.select({ value: siteValues.value }).from(siteValues).where(eq(siteValues.key, full(key)));
    return found ? found.value : null;
  };
  const write = async (key: string, value: unknown, onlyIfNew = false) => {
    const insert = db.insert(siteValues).values({ key: full(key), value });
    await (onlyIfNew
      ? insert.onConflictDoNothing()
      : insert.onConflictDoUpdate({ target: siteValues.key, set: { value, updatedAt: new Date() } }));
  };
  const unsupported = (): never => {
    throw new Error(`the ${name} store holds JSON values only`);
  };
  return {
    get: (key: string, options?: { type?: ReadType }) => (options?.type === "json" ? read(key) : unsupported()),
    getWithMetadata: async (key: string) => {
      const data = await read(key);
      return data === null ? null : { data, metadata: {} };
    },
    getMetadata: async (key) => ((await read(key)) === null ? null : { metadata: {} }),
    set: async () => unsupported(),
    setJSON: (key, value, options) => write(key, value, options?.onlyIfNew),
    delete: async (key) => {
      await db.delete(siteValues).where(eq(siteValues.key, full(key)));
    },
    list: async (options) => {
      const rows = await db
        .select({ key: siteValues.key })
        .from(siteValues)
        .where(like(siteValues.key, `${full(options?.prefix ?? "").replace(/[\\%_]/g, "\\$&")}%`));
      return { blobs: rows.map((row) => ({ key: row.key.slice(name.length + 1), metadata: {} })) };
    },
  };
}

export function platformBackend(app: { files: Files; db: Db }): Backend {
  const made = new Map<StoreName, BlobStore>();
  return {
    store(name) {
      const found = made.get(name);
      if (found) return found;
      const created =
        name === "site" || name === "oauth" ? valueStore(app.db, name) : objectStore(app.files, app.db, name);
      made.set(name, created);
      return created;
    },
  };
}
