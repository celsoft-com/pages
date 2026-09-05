import { beforeEach, describe, expect, it } from "vitest";
import { resetBlobs } from "../test/blobs";
import { handleData } from "./handler";
import { saveCollection } from "./service";

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
