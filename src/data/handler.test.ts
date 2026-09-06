import { beforeEach, describe, expect, it } from "vitest";
import { resetBlobs } from "../test/blobs";
import { handleData } from "./handler";
import { putItem, reorderItems, saveCollection } from "./service";

beforeEach(resetBlobs);

function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return handleData(new Request(`https://example.com${path}`, { headers }));
}

describe("serving a collection", () => {
  beforeEach(async () => {
    await saveCollection("/products", [
      { id: "coat", title: "Coat" },
      { id: "hat", title: "Hat" },
    ]);
  });

  it("returns the items as a bare array", async () => {
    const response = await get("/data/products.json");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { id: "coat", title: "Coat" },
      { id: "hat", title: "Hat" },
    ]);
  });

  it("serves json, not html", async () => {
    const response = await get("/data/products.json");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });

  it("preserves the stored order", async () => {
    await saveCollection("/products", [{ id: "hat" }, { id: "coat" }]);
    const items = (await (await get("/data/products.json")).json()) as { id: string }[];
    expect(items.map((i) => i.id)).toEqual(["hat", "coat"]);
  });

  it("is readable from another origin", async () => {
    const response = await get("/data/products.json");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("matches the address regardless of case", async () => {
    expect((await get("/data/Products.json")).status).toBe(200);
  });

  it("serves a nested path", async () => {
    await saveCollection("/shop/items", [{ id: "a" }]);
    expect((await get("/data/shop/items.json")).status).toBe(200);
  });

  it("serves an empty collection as an empty array", async () => {
    await saveCollection("/empty", []);
    expect(await (await get("/data/empty.json")).json()).toEqual([]);
  });
});

describe("caching", () => {
  beforeEach(async () => {
    await saveCollection("/products", [{ id: "coat" }]);
  });

  it("offers a short cache and an etag", async () => {
    const response = await get("/data/products.json");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(response.headers.get("etag")).toBeTruthy();
  });

  it("answers 304 when the etag still matches", async () => {
    const etag = (await get("/data/products.json")).headers.get("etag")!;
    const response = await get("/data/products.json", { "if-none-match": etag });
    expect(response.status).toBe(304);
  });

  it("changes the etag after a write", async () => {
    const before = (await get("/data/products.json")).headers.get("etag");
    await new Promise((resolve) => setTimeout(resolve, 2));
    await saveCollection("/products", [{ id: "coat" }, { id: "hat" }]);
    expect((await get("/data/products.json")).headers.get("etag")).not.toBe(before);
  });
});

describe("misses", () => {
  it("404s an unknown collection", async () => {
    const response = await get("/data/nothing.json");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });

  it("404s without the .json suffix so pages keep that namespace", async () => {
    await saveCollection("/products", [{ id: "a" }]);
    expect((await get("/data/products")).status).toBe(404);
  });

  it("404s the bare prefix", async () => {
    expect((await get("/data/")).status).toBe(404);
  });

  it("stays inside the namespace", async () => {
    await saveCollection("/secret", [{ id: "a" }]);
    expect((await get("/data/../secret.json")).status).toBe(404);
  });
});

describe("the address the tools advertise", () => {
  it("serves exactly the url put_item reports, for every shape of path", async () => {
    for (const [stored, url] of [
      ["/products", "/data/products.json"],
      ["/shop/items", "/data/shop/items.json"],
      ["/a/b/c", "/data/a/b/c.json"],
    ]) {
      await saveCollection(stored, [{ id: "x" }]);
      expect((await get(url)).status, url).toBe(200);
    }
  });

  it("round-trips a collection at the root through /data/index.json", async () => {
    await saveCollection("/", [{ id: "a" }]);
    const response = await get("/data/index.json");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: "a" }]);
  });

  it("serves the bare array, not the envelope the tools return", async () => {
    await saveCollection("/products", [{ id: "coat" }]);
    const body = await (await get("/data/products.json")).json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).not.toHaveProperty("items");
  });
});

describe("revisions stay out of the served json", () => {
  it("serves items with no rev field", async () => {
    await saveCollection("/products", [{ id: "coat", title: "Coat" }]);
    const body = (await (await get("/data/products.json")).json()) as Record<string, unknown>[];
    expect(body[0]).toEqual({ id: "coat", title: "Coat" });
    expect(body[0]).not.toHaveProperty("rev");
  });

  it("uses the collection rev as the etag", async () => {
    const saved = await saveCollection("/products", [{ id: "coat" }]);
    expect((await get("/data/products.json")).headers.get("etag")).toBe(`W/"${saved.rev}"`);
  });

  it("changes the etag on every write, even inside the same millisecond", async () => {
    await saveCollection("/products", [{ id: "coat" }]);
    const before = (await get("/data/products.json")).headers.get("etag");
    await saveCollection("/products", [{ id: "coat" }, { id: "hat" }]);
    expect((await get("/data/products.json")).headers.get("etag")).not.toBe(before);
  });
});

describe("the served payload contract", () => {
  it("returns a bare array, never an envelope", async () => {
    await saveCollection("/products", [{ id: "coat" }]);
    const body = await (await get("/data/products.json")).json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("includes each item's id in the served json", async () => {
    await saveCollection("/products", [{ id: "coat", title: "Coat" }]);
    const body = (await (await get("/data/products.json")).json()) as Record<string, unknown>[];
    expect(body[0].id).toBe("coat");
  });

  it("maps /a/b to /data/a/b.json", async () => {
    await saveCollection("/a/b", [{ id: "x" }]);
    expect((await get("/data/a/b.json")).status).toBe(200);
  });
});

describe("order preservation", () => {
  it("serves items in the order reorder_items set", async () => {
    await putItem({ path: "/p", id: "a", fields: {}, merge: true });
    await putItem({ path: "/p", id: "b", fields: {}, merge: true });
    await putItem({ path: "/p", id: "c", fields: {}, merge: true });
    await reorderItems("/p", ["c", "b"]);

    const body = (await (await get("/data/p.json")).json()) as { id: string }[];
    expect(body.map((i) => i.id)).toEqual(["c", "b", "a"]);
  });

  it("serves items in the order put_item's index set", async () => {
    await putItem({ path: "/p", id: "a", fields: {}, merge: true });
    await putItem({ path: "/p", id: "b", fields: {}, merge: true, index: 0 });

    const body = (await (await get("/data/p.json")).json()) as { id: string }[];
    expect(body.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("keeps the order across an unrelated edit", async () => {
    await putItem({ path: "/p", id: "a", fields: {}, merge: true });
    await putItem({ path: "/p", id: "b", fields: {}, merge: true });
    await reorderItems("/p", ["b"]);
    await putItem({ path: "/p", id: "a", fields: { x: 1 }, merge: true, overwrite: true });

    const body = (await (await get("/data/p.json")).json()) as { id: string }[];
    expect(body.map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("nested values", () => {
  const nested = {
    id: "coat",
    title: "Coat",
    price: { amount: 120, currency: "USD" },
    sizes: [
      { label: "S", stock: 2 },
      { label: "M", stock: 0 },
    ],
    tags: ["outer", "sale"],
    meta: { seo: { title: "A coat", keywords: ["warm", "wool"] } },
    discontinued: false,
    replacedBy: null,
  };

  it("serves nested objects and arrays of objects unchanged", async () => {
    await saveCollection("/products", [nested]);
    expect(await (await get("/data/products.json")).json()).toEqual([nested]);
  });

  it("round-trips them through put_item", async () => {
    const { id, ...fields } = nested;
    await putItem({ path: "/products", id, fields, merge: true });
    expect(await (await get("/data/products.json")).json()).toEqual([nested]);
  });

  it("replaces a nested value outright rather than merging into it", async () => {
    const first = await putItem({
      path: "/products",
      id: "coat",
      fields: { price: { amount: 120, currency: "USD" } },
      merge: true,
    });
    await putItem({ path: "/products", id: "coat", fields: { price: { amount: 99 } }, merge: true, ifRev: first.rev });

    const body = (await (await get("/data/products.json")).json()) as any[];
    expect(body[0].price).toEqual({ amount: 99 });
  });
});

describe("the collection index", () => {
  it("lists every collection with a fetchable url", async () => {
    await saveCollection("/products", [{ id: "a" }, { id: "b" }]);
    await saveCollection("/shop/items", [{ id: "c" }]);

    const body = (await (await get("/data/_collections.json")).json()) as any[];
    expect(body.map((c) => [c.path, c.url, c.count])).toEqual([
      ["/products", "/data/products.json", 2],
      ["/shop/items", "/data/shop/items.json", 1],
    ]);
  });

  it("gives urls that actually serve", async () => {
    await saveCollection("/a/b", [{ id: "x" }]);
    const [entry] = (await (await get("/data/_collections.json")).json()) as any[];
    expect((await get(entry.url)).status).toBe(200);
  });

  it("carries the rev so a page can tell when data moved", async () => {
    const saved = await saveCollection("/products", [{ id: "a" }]);
    const [entry] = (await (await get("/data/_collections.json")).json()) as any[];
    expect(entry.rev).toBe(saved.rev);
  });

  it("is an empty array before anything exists", async () => {
    expect(await (await get("/data/_collections.json")).json()).toEqual([]);
  });

  it("is readable from another origin and revalidates", async () => {
    await saveCollection("/products", [{ id: "a" }]);
    const response = await get("/data/_collections.json");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect((await get("/data/_collections.json", { "if-none-match": response.headers.get("etag")! })).status).toBe(
      304,
    );
  });

  it("changes its etag when a collection changes", async () => {
    await saveCollection("/products", [{ id: "a" }]);
    const before = (await get("/data/_collections.json")).headers.get("etag");
    await saveCollection("/products", [{ id: "a" }, { id: "b" }]);
    expect((await get("/data/_collections.json")).headers.get("etag")).not.toBe(before);
  });

  it("refuses to let a collection squat on the reserved path", async () => {
    await expect(saveCollection("/_collections", [{ id: "a" }])).rejects.toThrow(/reserved/);
  });
});
