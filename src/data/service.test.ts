import { readFileSync, readdirSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeKey, stores } from "../store";
import { resetBlobs } from "../test/blobs";
import type { Item } from "../types";
import {
  deleteCollection,
  deleteItem,
  getCollection,
  isValidId,
  listCollections,
  normalizeCollectionPath,
  putItem,
  brokenRefs,
  reorderItems,
  revOf,
  saveCollection,
  setRefs,
} from "./service";

beforeEach(resetBlobs);

async function ids(path: string): Promise<string[]> {
  return ((await getCollection(path))?.items ?? []).map((item) => item.id);
}

describe("normalizeCollectionPath", () => {
  it("strips a .json suffix", () => {
    expect(normalizeCollectionPath("/products.json")).toBe("/products");
    expect(normalizeCollectionPath("products.JSON")).toBe("/products");
  });

  it("lowercases and anchors the path", () => {
    expect(normalizeCollectionPath("Products")).toBe("/products");
    expect(normalizeCollectionPath("/Shop/Items/")).toBe("/shop/items");
  });

  it("refuses to climb out of the namespace", () => {
    expect(normalizeCollectionPath("/../../etc/passwd")).toBe("/etc/passwd");
  });
});

describe("isValidId", () => {
  it("accepts slug-like ids", () => {
    expect(isValidId("snow-boot")).toBe(true);
    expect(isValidId("SKU_12.3~a")).toBe(true);
  });

  it("rejects ids that would break a key or a lookup", () => {
    expect(isValidId("")).toBe(false);
    expect(isValidId("a/b")).toBe(false);
    expect(isValidId("has space")).toBe(false);
    expect(isValidId("x".repeat(129))).toBe(false);
  });
});

describe("putItem", () => {
  it("creates the collection on first write", async () => {
    const { created } = await putItem({ path: "/products", id: "coat", fields: { title: "Coat" }, merge: true });
    expect(created).toBe(true);
    expect(await ids("/products")).toEqual(["coat"]);
  });

  it("appends new items in call order", async () => {
    await putItem({ path: "/p", id: "a", fields: {}, merge: true });
    await putItem({ path: "/p", id: "b", fields: {}, merge: true });
    expect(await ids("/p")).toEqual(["a", "b"]);
  });

  it("merges into an existing item by default", async () => {
    const first = await putItem({ path: "/p", id: "coat", fields: { title: "Coat", price: 120 }, merge: true });
    const { created } = await putItem({
      path: "/p",
      id: "coat",
      fields: { price: 99 },
      merge: true,
      ifRev: first.rev,
    });

    expect(created).toBe(false);
    const item = (await getCollection("/p"))!.items[0];
    expect(item).toEqual({ id: "coat", title: "Coat", price: 99 });
  });

  it("replaces the item outright when merge is false", async () => {
    const first = await putItem({ path: "/p", id: "coat", fields: { title: "Coat", price: 120 }, merge: false });
    await putItem({ path: "/p", id: "coat", fields: { title: "Parka" }, merge: false, ifRev: first.rev });
    expect((await getCollection("/p"))!.items[0]).toEqual({ id: "coat", title: "Parka" });
  });

  it("keeps an update in place rather than moving it", async () => {
    const a = await putItem({ path: "/p", id: "a", fields: {}, merge: true });
    await putItem({ path: "/p", id: "b", fields: {}, merge: true });
    await putItem({ path: "/p", id: "a", fields: { x: 1 }, merge: true, ifRev: a.rev });
    expect(await ids("/p")).toEqual(["a", "b"]);
  });

  it("derives an id from slug, title or name", async () => {
    const fromTitle = await putItem({ path: "/p", fields: { title: "Snow Boot" }, merge: true });
    const fromSlug = await putItem({ path: "/p", fields: { slug: "Winter-Coat", title: "x" }, merge: true });
    const fromName = await putItem({ path: "/p", fields: { name: "Wool Hat" }, merge: true });

    expect(fromTitle.item.id).toBe("snow-boot");
    expect(fromSlug.item.id).toBe("winter-coat");
    expect(fromName.item.id).toBe("wool-hat");
  });

  it("falls back to a numbered id when nothing names the item", async () => {
    const first = await putItem({ path: "/p", fields: { price: 1 }, merge: true });
    const second = await putItem({ path: "/p", fields: { price: 2 }, merge: true });
    expect(first.item.id).toBe("item-1");
    expect(second.item.id).toBe("item-2");
  });

  it("never reuses an id that is taken", async () => {
    await putItem({ path: "/p", fields: { title: "Coat" }, merge: true });
    const second = await putItem({ path: "/p", fields: { title: "Coat" }, merge: true });
    expect(second.item.id).toBe("coat-2");
    expect(await ids("/p")).toEqual(["coat", "coat-2"]);
  });

  it("ignores an id smuggled in through fields", async () => {
    const { item } = await putItem({ path: "/p", id: "real", fields: { id: "fake", x: 1 }, merge: true });
    expect(item.id).toBe("real");
    expect(await ids("/p")).toEqual(["real"]);
  });

  it("inserts at a requested index", async () => {
    await putItem({ path: "/p", id: "a", fields: {}, merge: true });
    await putItem({ path: "/p", id: "b", fields: {}, merge: true });
    await putItem({ path: "/p", id: "c", fields: {}, merge: true, index: 0 });
    expect(await ids("/p")).toEqual(["c", "a", "b"]);
  });

  it("clamps an out of range index", async () => {
    await putItem({ path: "/p", id: "a", fields: {}, merge: true });
    await putItem({ path: "/p", id: "b", fields: {}, merge: true, index: 99 });
    await putItem({ path: "/p", id: "c", fields: {}, merge: true, index: -5 });
    expect(await ids("/p")).toEqual(["c", "a", "b"]);
  });

  it("moves an existing item when given an index", async () => {
    await putItem({ path: "/p", id: "a", fields: {}, merge: true });
    await putItem({ path: "/p", id: "b", fields: {}, merge: true });
    const c = await putItem({ path: "/p", id: "c", fields: {}, merge: true });
    await putItem({ path: "/p", id: "c", fields: {}, merge: true, index: 0, ifRev: c.rev });
    expect(await ids("/p")).toEqual(["c", "a", "b"]);
  });

  it("rejects an unusable id", async () => {
    await expect(putItem({ path: "/p", id: "a/b", fields: {}, merge: true })).rejects.toThrow("not usable");
  });

  it("treats paths that normalize the same as one collection", async () => {
    await putItem({ path: "/Products.json", id: "a", fields: {}, merge: true });
    await putItem({ path: "products", id: "b", fields: {}, merge: true });
    expect(await ids("/products")).toEqual(["a", "b"]);
  });

  it("keeps createdAt across writes and advances updatedAt", async () => {
    await putItem({ path: "/p", id: "a", fields: {}, merge: true });
    const first = (await getCollection("/p"))!;
    await new Promise((resolve) => setTimeout(resolve, 2));
    await putItem({ path: "/p", id: "b", fields: {}, merge: true });
    const second = (await getCollection("/p"))!;

    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
  });
});

describe("deleteItem", () => {
  it("removes only the named item", async () => {
    await putItem({ path: "/p", id: "a", fields: {}, merge: true });
    await putItem({ path: "/p", id: "b", fields: {}, merge: true });

    expect(await deleteItem("/p", "a")).toEqual({ deleted: true, orphaned: [] });
    expect(await ids("/p")).toEqual(["b"]);
  });

  it("reports a miss rather than throwing", async () => {
    await putItem({ path: "/p", id: "a", fields: {}, merge: true });
    expect(await deleteItem("/p", "nope")).toMatchObject({ deleted: false });
    expect(await deleteItem("/missing", "a")).toMatchObject({ deleted: false });
  });

  it("leaves an empty collection behind", async () => {
    await putItem({ path: "/p", id: "a", fields: {}, merge: true });
    await deleteItem("/p", "a");
    expect((await getCollection("/p"))!.items).toEqual([]);
  });
});

describe("reorderItems", () => {
  beforeEach(async () => {
    for (const id of ["a", "b", "c", "d"]) await putItem({ path: "/p", id, fields: {}, merge: true });
  });

  it("moves the named ids to the front in order", async () => {
    await reorderItems("/p", ["c", "a"]);
    expect(await ids("/p")).toEqual(["c", "a", "b", "d"]);
  });

  it("keeps the untouched items in their relative order", async () => {
    await reorderItems("/p", ["d"]);
    expect(await ids("/p")).toEqual(["d", "a", "b", "c"]);
  });

  it("accepts a full ordering", async () => {
    await reorderItems("/p", ["d", "c", "b", "a"]);
    expect(await ids("/p")).toEqual(["d", "c", "b", "a"]);
  });

  it("names every id it could not find", async () => {
    await expect(reorderItems("/p", ["a", "nope", "gone"])).rejects.toThrow("nope, gone");
  });

  it("leaves the order untouched when an id is unknown", async () => {
    await expect(reorderItems("/p", ["c", "nope"])).rejects.toThrow();
    expect(await ids("/p")).toEqual(["a", "b", "c", "d"]);
  });

  it("fails on a missing collection", async () => {
    await expect(reorderItems("/missing", ["a"])).rejects.toThrow("No collection exists");
  });
});

describe("collections", () => {
  it("lists paths, counts and nothing else", async () => {
    await putItem({ path: "/products", id: "a", fields: {}, merge: true });
    await putItem({ path: "/products", id: "b", fields: {}, merge: true });
    await putItem({ path: "/posts", id: "c", fields: {}, merge: true });

    expect((await listCollections()).map((c) => ({ path: c.path, count: c.count }))).toEqual([
      { path: "/posts", count: 1 },
      { path: "/products", count: 2 },
    ]);
  });

  it("returns nothing before anything is written", async () => {
    expect(await listCollections()).toEqual([]);
    expect(await getCollection("/products")).toBeNull();
  });

  it("deletes a whole collection once", async () => {
    await saveCollection("/p", [{ id: "a" }]);
    expect(await deleteCollection("/p")).toBe(true);
    expect(await deleteCollection("/p")).toBe(false);
    expect(await getCollection("/p")).toBeNull();
  });

  it("stores nested paths without a slash in the blob key", async () => {
    await saveCollection("/shop/items", [{ id: "a" }]);
    expect((await getCollection("/shop/items"))!.path).toBe("/shop/items");
    expect((await listCollections()).map((c) => c.path)).toEqual(["/shop/items"]);
  });
});

describe("revisions", () => {
  it("starts a new item at rev 1", async () => {
    const { rev } = await putItem({ path: "/p", id: "a", fields: {}, merge: true });
    expect(rev).toBe(1);
  });

  it("refuses to update an existing item without a rev", async () => {
    await putItem({ path: "/p", id: "a", fields: { x: 1 }, merge: true });
    await expect(putItem({ path: "/p", id: "a", fields: { x: 2 }, merge: true })).rejects.toThrow(
      /already exists at rev 1/,
    );
  });

  it("tells the caller how to proceed when it refuses", async () => {
    await putItem({ path: "/p", id: "a", fields: { x: 1 }, merge: true });
    await expect(putItem({ path: "/p", id: "a", fields: { x: 2 }, merge: true })).rejects.toThrow(
      /if_rev: 1, or pass overwrite: true/,
    );
  });

  it("accepts a matching rev", async () => {
    const first = await putItem({ path: "/p", id: "a", fields: { x: 1 }, merge: true });
    const second = await putItem({ path: "/p", id: "a", fields: { x: 2 }, merge: true, ifRev: first.rev });
    expect(second.rev).toBeGreaterThan(first.rev);
  });

  it("refuses a stale rev after someone else wrote", async () => {
    const mine = await putItem({ path: "/p", id: "a", fields: { x: 1 }, merge: true });
    await putItem({ path: "/p", id: "a", fields: { x: 2 }, merge: true, ifRev: mine.rev });

    await expect(putItem({ path: "/p", id: "a", fields: { x: 3 }, merge: true, ifRev: mine.rev })).rejects.toThrow(
      /you have rev 1, it is now rev 2/,
    );
  });

  it("leaves the item untouched when it refuses", async () => {
    await putItem({ path: "/p", id: "a", fields: { x: 1 }, merge: true });
    await expect(putItem({ path: "/p", id: "a", fields: { x: 99 }, merge: true, ifRev: 7 })).rejects.toThrow();
    expect((await getCollection("/p"))!.items[0]).toEqual({ id: "a", x: 1 });
  });

  it("lets overwrite through without a rev", async () => {
    await putItem({ path: "/p", id: "a", fields: { x: 1 }, merge: true });
    const forced = await putItem({ path: "/p", id: "a", fields: { x: 2 }, merge: true, overwrite: true });
    expect(forced.created).toBe(false);
    expect((await getCollection("/p"))!.items[0]).toEqual({ id: "a", x: 2 });
  });

  it("rejects a rev on an item that is not there", async () => {
    await expect(putItem({ path: "/p", id: "ghost", fields: {}, merge: true, ifRev: 1 })).rejects.toThrow(
      /may have been deleted/,
    );
  });

  it("only bumps the rev of the item that changed", async () => {
    const a = await putItem({ path: "/p", id: "a", fields: { x: 1 }, merge: true });
    const b = await putItem({ path: "/p", id: "b", fields: { y: 1 }, merge: true });
    await putItem({ path: "/p", id: "a", fields: { x: 2 }, merge: true, ifRev: a.rev });

    const collection = (await getCollection("/p"))!;
    expect(revOf(collection, "b")).toBe(b.rev);
    expect(revOf(collection, "a")).toBeGreaterThan(a.rev);
  });

  it("does not bump a rev when the write changes nothing", async () => {
    const a = await putItem({ path: "/p", id: "a", fields: { x: 1 }, merge: true });
    const again = await putItem({ path: "/p", id: "a", fields: { x: 1 }, merge: true, ifRev: a.rev });
    expect(again.rev).toBe(a.rev);
  });

  it("advances the collection rev on every write", async () => {
    await putItem({ path: "/p", id: "a", fields: {}, merge: true });
    const first = (await getCollection("/p"))!.rev;
    await putItem({ path: "/p", id: "b", fields: {}, merge: true });
    expect((await getCollection("/p"))!.rev).toBeGreaterThan(first);
  });

  it("checks the rev on delete and leaves the item when it is stale", async () => {
    const a = await putItem({ path: "/p", id: "a", fields: { x: 1 }, merge: true });
    await putItem({ path: "/p", id: "a", fields: { x: 2 }, merge: true, ifRev: a.rev });

    await expect(deleteItem("/p", "a", a.rev)).rejects.toThrow(/you have rev 1, it is now rev 2/);
    expect(await ids("/p")).toEqual(["a"]);
  });

  it("deletes with a matching rev", async () => {
    const a = await putItem({ path: "/p", id: "a", fields: {}, merge: true });
    expect(await deleteItem("/p", "a", a.rev)).toMatchObject({ deleted: true });
  });

  it("checks the collection rev on reorder", async () => {
    await putItem({ path: "/p", id: "a", fields: {}, merge: true });
    await putItem({ path: "/p", id: "b", fields: {}, merge: true });
    const stale = 1;

    await expect(reorderItems("/p", ["b"], stale)).rejects.toThrow(/you have rev 1, it is now rev 2/);
    expect(await ids("/p")).toEqual(["a", "b"]);
  });

  it("reorders with the current collection rev", async () => {
    await putItem({ path: "/p", id: "a", fields: {}, merge: true });
    await putItem({ path: "/p", id: "b", fields: {}, merge: true });
    const rev = (await getCollection("/p"))!.rev;

    await reorderItems("/p", ["b"], rev);
    expect(await ids("/p")).toEqual(["b", "a"]);
  });

  it("treats a collection stored before revs existed as rev 0", async () => {
    await saveCollection("/p", [{ id: "a" }]);
    const collection = (await getCollection("/p"))!;
    expect(typeof collection.rev).toBe("number");
    expect(revOf(collection, "missing")).toBe(0);
  });

  it("keeps revs out of the items themselves", async () => {
    await putItem({ path: "/p", id: "a", fields: { x: 1 }, merge: true });
    expect((await getCollection("/p"))!.items[0]).toEqual({ id: "a", x: 1 });
  });
});

describe("collections stored before a field existed", () => {
  async function writeLegacyBlob(path: string, items: Item[]): Promise<void> {
    // Exactly what saveCollection wrote before refs, rev and revs were added.
    await stores.data().setJSON(encodeKey(path), {
      path,
      items,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  it("comes back from getCollection with every field filled in", async () => {
    await writeLegacyBlob("/trip/items", [{ id: "a" }]);
    const collection = (await getCollection("/trip/items"))!;

    expect(collection.refs).toEqual({});
    expect(collection.revs).toEqual({});
    expect(collection.rev).toBe(0);
  });

  it("comes back from listCollections with every field filled in", async () => {
    await writeLegacyBlob("/trip/items", [{ id: "a" }, { id: "b" }]);
    const [summary] = await listCollections();

    expect(summary).toMatchObject({ path: "/trip/items", count: 2, refs: {}, rev: 0 });
  });

  it("agrees between the two read paths", async () => {
    await writeLegacyBlob("/trip/items", [{ id: "a" }]);
    const listed = (await listCollections())[0];
    const fetched = (await getCollection("/trip/items"))!;

    expect(listed.refs).toEqual(fetched.refs);
    expect(listed.rev).toBe(fetched.rev);
    expect(listed.count).toBe(fetched.items.length);
  });

  it("takes a constraint and a write without being rewritten first", async () => {
    await writeLegacyBlob("/trip/filters", [{ id: "outdoors" }]);
    await writeLegacyBlob("/trip/items", [{ id: "a", group: "outdoors" }]);
    await setRefs("/trip/items", { group: "/trip/filters" });

    await expect(putItem({ path: "/trip/items", fields: { group: "nope" }, merge: true })).rejects.toThrow(
      /not an id/,
    );
    expect((await brokenRefs("/trip/items")).broken).toEqual([]);
  });
});

describe("collection summaries", () => {
  it("rides along with the blob, written in the same call", async () => {
    await saveCollection("/trip/items", [{ id: "a" }, { id: "b" }]);
    const found = await stores.data().getMetadata(encodeKey("/trip/items"));

    expect(found!.metadata).toMatchObject({ path: "/trip/items", count: 2, rev: 1 });
  });

  it("answers listCollections without touching the items", async () => {
    await saveCollection("/trip/items", [{ id: "a" }, { id: "b" }]);

    const real = stores.data();
    const spy = vi.spyOn(stores, "data").mockReturnValue({
      ...real,
      get: async () => {
        throw new Error("the items were read to build a summary");
      },
    } as unknown as ReturnType<typeof stores.data>);

    expect(await listCollections()).toEqual([
      { path: "/trip/items", count: 2, refs: {}, rev: 1, updatedAt: expect.any(Number) },
    ]);
    spy.mockRestore();
  });

  // The summary is a cache in front of the blob, so every miss has to end at the blob.
  it("ignores a summary written under an older shape and reads the items", async () => {
    await stores.data().setJSON(
      encodeKey("/trip/items"),
      { path: "/trip/items", items: [{ id: "a" }, { id: "b" }, { id: "c" }], createdAt: 1, updatedAt: 1 },
      { metadata: { v: 0, path: "/trip/items", count: 99, refs: {}, rev: 7, updatedAt: 1 } },
    );

    expect(await listCollections()).toEqual([
      { path: "/trip/items", count: 3, refs: {}, rev: 0, updatedAt: 1 },
    ]);
  });

  // list() names a key, then the blob is gone by the time it is read. Nothing to summarize, and
  // nothing to report either.
  it("drops a key whose blob is no longer there", async () => {
    await saveCollection("/trip/items", [{ id: "a" }]);

    const real = stores.data();
    const spy = vi.spyOn(stores, "data").mockReturnValue({
      ...real,
      getMetadata: async () => null,
      get: async () => null,
    } as unknown as ReturnType<typeof stores.data>);

    expect(await listCollections()).toEqual([]);
    spy.mockRestore();
  });

  // A blob written anywhere but writeCollectionBlob is one whose summary can be wrong.
  it("is written in exactly one place", async () => {
    const files = readdirSync("src", { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .filter((name) => name !== "data/service.ts");
    const offenders = files.filter((name) => readFileSync(`src/${name}`, "utf8").includes("stores.data().setJSON"));

    expect(offenders).toEqual([]);
  });
});
