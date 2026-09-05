import { beforeEach, describe, expect, it } from "vitest";
import { resetBlobs } from "../test/blobs";
import {
  deleteCollection,
  deleteItem,
  getCollection,
  isValidId,
  listCollections,
  normalizeCollectionPath,
  putItem,
  reorderItems,
  saveCollection,
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
    await putItem({ path: "/p", id: "coat", fields: { title: "Coat", price: 120 }, merge: true });
    const { created } = await putItem({ path: "/p", id: "coat", fields: { price: 99 }, merge: true });

    expect(created).toBe(false);
    const item = (await getCollection("/p"))!.items[0];
    expect(item).toEqual({ id: "coat", title: "Coat", price: 99 });
  });

  it("replaces the item outright when merge is false", async () => {
    await putItem({ path: "/p", id: "coat", fields: { title: "Coat", price: 120 }, merge: false });
    await putItem({ path: "/p", id: "coat", fields: { title: "Parka" }, merge: false });
    expect((await getCollection("/p"))!.items[0]).toEqual({ id: "coat", title: "Parka" });
  });

  it("keeps an update in place rather than moving it", async () => {
    await putItem({ path: "/p", id: "a", fields: {}, merge: true });
    await putItem({ path: "/p", id: "b", fields: {}, merge: true });
    await putItem({ path: "/p", id: "a", fields: { x: 1 }, merge: true });
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
    await putItem({ path: "/p", id: "c", fields: {}, merge: true });
    await putItem({ path: "/p", id: "c", fields: {}, merge: true, index: 0 });
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

    expect(await deleteItem("/p", "a")).toBe(true);
    expect(await ids("/p")).toEqual(["b"]);
  });

  it("reports a miss rather than throwing", async () => {
    await putItem({ path: "/p", id: "a", fields: {}, merge: true });
    expect(await deleteItem("/p", "nope")).toBe(false);
    expect(await deleteItem("/missing", "a")).toBe(false);
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
