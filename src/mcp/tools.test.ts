import { beforeEach, describe, expect, it } from "vitest";
import { saveCollection } from "../data/service";
import { resetBlobs } from "../test/blobs";
import { TOOLS, type ToolContext } from "./tools";

const ctx: ToolContext = { siteUrl: "https://example.com" };

beforeEach(resetBlobs);

function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`No tool named ${name}`);
  return tool.handler(args, ctx);
}

async function json(name: string, args: Record<string, unknown> = {}): Promise<any> {
  return JSON.parse(await call(name, args));
}

async function seed(): Promise<void> {
  await saveCollection("/products", [
    { id: "coat", title: "Winter Coat", price: 120, status: "draft" },
    { id: "hat", title: "Wool Hat", price: 30, status: "live" },
    { id: "boot", title: "Snow Boot", price: 200, status: "live" },
  ]);
}

describe("tool definitions", () => {
  const dataTools = [
    "list_collections",
    "list_items",
    "get_item",
    "put_item",
    "delete_item",
    "reorder_items",
    "search_items",
    "delete_collection",
  ];

  it("exposes every data tool", () => {
    for (const name of dataTools) expect(TOOLS.map((t) => t.name)).toContain(name);
  });

  it("gives every tool a unique name", () => {
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
  });

  it("gives every tool a title, description and object schema", () => {
    for (const tool of TOOLS) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.description, tool.name).toBeTruthy();
      expect(tool.inputSchema, tool.name).toMatchObject({ type: "object" });
    }
  });

  it("marks required arguments on the data tools", () => {
    const required = (name: string) => (TOOLS.find((t) => t.name === name)!.inputSchema as any).required;
    expect(required("get_item")).toEqual(["path", "id"]);
    expect(required("put_item")).toEqual(["path", "fields"]);
    expect(required("reorder_items")).toEqual(["path", "ids"]);
    expect(required("search_items")).toEqual(["query"]);
  });

  it("points page tools at collections so data does not get baked into html", () => {
    const publish = TOOLS.find((t) => t.name === "publish_page")!;
    expect(publish.description).toMatch(/collection/i);
  });
});

describe("list_collections", () => {
  it("says how to start when there is nothing", async () => {
    expect(await call("list_collections")).toMatch(/put_item/);
  });

  it("reports the count and the fetchable url", async () => {
    await seed();
    const text = await call("list_collections");
    expect(text).toContain("/products");
    expect(text).toContain("3 items");
    expect(text).toContain("https://example.com/data/products.json");
  });
});

describe("list_items", () => {
  beforeEach(seed);

  it("returns items with the collection total", async () => {
    const result = await json("list_items", { path: "/products" });
    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(3);
    expect(result.items[0].id).toBe("coat");
  });

  it("returns only the fields asked for, always including id", async () => {
    const result = await json("list_items", { path: "/products", fields: ["title"] });
    expect(Object.keys(result.items[0].item).sort()).toEqual(["id", "title"]);
  });

  it("pages with limit and offset while still reporting the total", async () => {
    const result = await json("list_items", { path: "/products", limit: 1, offset: 1 });
    expect(result.total).toBe(3);
    expect(result.offset).toBe(1);
    expect(result.items.map((i: any) => i.id)).toEqual(["hat"]);
    expect(result.items[0].item.title).toBe("Wool Hat");
  });

  it("caps an unbounded read at a default page", async () => {
    await saveCollection("/big", Array.from({ length: 120 }, (_, n) => ({ id: `i${n}` })));
    const result = await json("list_items", { path: "/big" });
    expect(result.total).toBe(120);
    expect(result.items).toHaveLength(50);
  });

  it("points at put_item when the collection is missing", async () => {
    await expect(call("list_items", { path: "/nope" })).rejects.toThrow(/put_item/);
  });
});

describe("get_item", () => {
  beforeEach(seed);

  it("returns the whole item", async () => {
    expect(await json("get_item", { path: "/products", id: "hat" })).toMatchObject({
      path: "/products",
      id: "hat",
      rev: expect.any(Number),
      item: { id: "hat", title: "Wool Hat", price: 30, status: "live" },
    });
  });

  it("fails on an unknown id", async () => {
    await expect(call("get_item", { path: "/products", id: "nope" })).rejects.toThrow("No item nope");
  });
});

describe("put_item", () => {
  it("creates a collection and reports where to fetch it", async () => {
    const text = await call("put_item", { path: "/products", id: "coat", fields: { title: "Coat" } });
    expect(text).toContain("Created coat");
    expect(text).toContain("https://example.com/data/products.json");
  });

  it("merges by default", async () => {
    await seed();
    const { rev } = await json("get_item", { path: "/products", id: "coat" });
    await call("put_item", { path: "/products", id: "coat", fields: { price: 99 }, if_rev: rev });
    expect((await json("get_item", { path: "/products", id: "coat" })).item).toMatchObject({
      title: "Winter Coat",
      price: 99,
    });
  });

  it("replaces when merge is false", async () => {
    await seed();
    const { rev } = await json("get_item", { path: "/products", id: "coat" });
    await call("put_item", { path: "/products", id: "coat", fields: { title: "Parka" }, merge: false, if_rev: rev });
    expect((await json("get_item", { path: "/products", id: "coat" })).item).toEqual({
      id: "coat",
      title: "Parka",
    });
  });

  it("reports an update as an update", async () => {
    await seed();
    const { rev } = await json("get_item", { path: "/products", id: "coat" });
    expect(await call("put_item", { path: "/products", id: "coat", fields: { price: 1 }, if_rev: rev })).toContain(
      "Updated",
    );
  });

  it("rejects fields that are not an object", async () => {
    await expect(call("put_item", { path: "/p", fields: "nope" })).rejects.toThrow("fields must be an object");
    await expect(call("put_item", { path: "/p", fields: [1, 2] })).rejects.toThrow("fields must be an object");
  });

  it("rejects an unusable collection path", async () => {
    await expect(call("put_item", { path: "/a b c", fields: {} })).rejects.toThrow("not usable");
  });
});

describe("delete_item", () => {
  beforeEach(seed);

  it("removes one item and leaves the rest", async () => {
    await call("delete_item", { path: "/products", id: "hat" });
    const result = await json("list_items", { path: "/products" });
    expect(result.items.map((i: any) => i.id)).toEqual(["coat", "boot"]);
  });

  it("fails loudly on an unknown id", async () => {
    await expect(call("delete_item", { path: "/products", id: "nope" })).rejects.toThrow("No item nope");
  });
});

describe("reorder_items", () => {
  beforeEach(seed);

  it("moves the named ids to the front and echoes the new order", async () => {
    expect(await call("reorder_items", { path: "/products", ids: ["boot"] })).toBe(
      "Order in /products: boot, coat, hat",
    );
  });

  it("requires a non-empty list", async () => {
    await expect(call("reorder_items", { path: "/products", ids: [] })).rejects.toThrow("non-empty");
    await expect(call("reorder_items", { path: "/products", ids: "boot" })).rejects.toThrow("non-empty");
  });
});

describe("search_items", () => {
  beforeEach(seed);

  it("returns the path and id needed to edit each match", async () => {
    const result = await json("search_items", { query: "status=live price>50" });
    expect(result.matches).toEqual([
      {
        path: "/products",
        url: "https://example.com/data/products.json",
        id: "boot",
        rev: expect.any(Number),
        index: 2,
        item: expect.objectContaining({ title: "Snow Boot" }),
      },
    ]);
  });

  it("searches every collection by default", async () => {
    await saveCollection("/posts", [{ id: "hello", title: "Winter is here" }]);
    const result = await json("search_items", { query: "winter" });
    expect(result.matches.map((m: any) => m.path).sort()).toEqual(["/posts", "/products"]);
  });

  it("narrows to one collection when given a path", async () => {
    await saveCollection("/posts", [{ id: "hello", title: "Winter is here" }]);
    const result = await json("search_items", { query: "winter", path: "/products" });
    expect(result.matches.map((m: any) => m.id)).toEqual(["coat"]);
  });

  it("projects fields so a wide search stays small", async () => {
    const result = await json("search_items", { query: "status=live", fields: ["title"] });
    expect(Object.keys(result.matches[0].item).sort()).toEqual(["id", "title"]);
  });

  it("reports the true total alongside a capped page", async () => {
    const result = await json("search_items", { query: "status=live", limit: 1 });
    expect(result.total).toBe(2);
    expect(result.matches).toHaveLength(1);
  });

  it("says so plainly when nothing matches", async () => {
    expect(await call("search_items", { query: "nothing-like-this" })).toMatch(/No items match/);
  });

  it("requires a query", async () => {
    await expect(call("search_items", { query: "   " })).rejects.toThrow("query is required");
  });
});

describe("delete_collection", () => {
  it("removes the whole collection", async () => {
    await seed();
    await call("delete_collection", { path: "/products" });
    expect(await call("list_collections")).toMatch(/No data collections/);
  });

  it("fails on a collection that is not there", async () => {
    await expect(call("delete_collection", { path: "/nope" })).rejects.toThrow("No collection exists");
  });
});

describe("how collections are served", () => {
  it("gives put_item's caller the exact address", async () => {
    const text = await call("put_item", { path: "/Products", id: "coat", fields: {} });
    expect(text).toBe(
      "Created coat at rev 1 in collection /products, served at https://example.com/data/products.json",
    );
  });

  it("gives the same address however the path was written", async () => {
    for (const path of ["/Products", "products", "/products.json", "/products/"]) {
      resetBlobs();
      const text = await call("put_item", { path, id: "a", fields: {} });
      expect(text, path).toContain("https://example.com/data/products.json");
    }
  });

  it("addresses a collection at the root as index.json", async () => {
    const text = await call("put_item", { path: "/", id: "a", fields: {} });
    expect(text).toContain("https://example.com/data/index.json");
  });

  it("addresses a nested collection under the same rule", async () => {
    const text = await call("put_item", { path: "/shop/items", id: "a", fields: {} });
    expect(text).toContain("https://example.com/data/shop/items.json");
  });

  it("labels the url in the collection listing", async () => {
    await seed();
    expect(await call("list_collections")).toContain("served at https://example.com/data/products.json");
  });

  it("carries the url and warns the envelope is not the served shape", async () => {
    await seed();
    const result = await json("list_items", { path: "/products" });
    expect(result.url).toBe("https://example.com/data/products.json");
    expect(result.served).toMatch(/without this envelope/);
  });

  it("carries the url on every search match", async () => {
    await seed();
    const result = await json("search_items", { query: "coat" });
    expect(result.matches[0].url).toBe("https://example.com/data/products.json");
  });

  it("states the mapping, the shape and the visibility in the tool text", () => {
    for (const name of ["list_collections", "list_items", "put_item"]) {
      const description = TOOLS.find((t) => t.name === name)!.description;
      expect(description, name).toContain("/data/products.json");
      expect(description, name).toMatch(/bare JSON array/);
      expect(description, name).toMatch(/public/i);
    }
  });
});

describe("stale writes", () => {
  beforeEach(seed);

  it("refuses an update that carries no rev", async () => {
    await expect(call("put_item", { path: "/products", id: "coat", fields: { price: 1 } })).rejects.toThrow(
      /already exists at rev/,
    );
  });

  it("still creates a new item with no rev", async () => {
    expect(await call("put_item", { path: "/products", id: "scarf", fields: { title: "Scarf" } })).toContain(
      "Created scarf",
    );
  });

  it("refuses an update built on a rev that has moved on", async () => {
    const { rev } = await json("get_item", { path: "/products", id: "coat" });
    await call("put_item", { path: "/products", id: "coat", fields: { price: 1 }, if_rev: rev });

    await expect(
      call("put_item", { path: "/products", id: "coat", fields: { price: 2 }, if_rev: rev }),
    ).rejects.toThrow(/has changed since you read it/);
  });

  it("lets an explicit overwrite through", async () => {
    expect(
      await call("put_item", { path: "/products", id: "coat", fields: { price: 1 }, overwrite: true }),
    ).toContain("Updated coat");
  });

  it("hands back a rev the next write accepts", async () => {
    const first = await call("put_item", { path: "/products", id: "coat", fields: { price: 1 }, overwrite: true });
    const rev = Number(/at rev (\d+)/.exec(first)![1]);
    expect(await call("put_item", { path: "/products", id: "coat", fields: { price: 2 }, if_rev: rev })).toContain(
      "Updated coat",
    );
  });

  it("gives search results a rev that put_item accepts", async () => {
    const result = await json("search_items", { query: "coat" });
    const match = result.matches[0];
    expect(
      await call("put_item", { path: match.path, id: match.id, fields: { price: 5 }, if_rev: match.rev }),
    ).toContain("Updated coat");
  });

  it("gives list_items a collection rev that reorder_items accepts", async () => {
    const listed = await json("list_items", { path: "/products" });
    expect(await call("reorder_items", { path: "/products", ids: ["boot"], if_rev: listed.rev })).toContain(
      "boot, coat, hat",
    );
  });

  it("refuses a reorder built on a stale collection rev", async () => {
    const listed = await json("list_items", { path: "/products" });
    await call("put_item", { path: "/products", id: "coat", fields: { price: 7 }, overwrite: true });

    await expect(
      call("reorder_items", { path: "/products", ids: ["boot"], if_rev: listed.rev }),
    ).rejects.toThrow(/has changed since you read it/);
  });

  it("refuses a delete built on a stale rev", async () => {
    const { rev } = await json("get_item", { path: "/products", id: "coat" });
    await call("put_item", { path: "/products", id: "coat", fields: { price: 3 }, if_rev: rev });

    await expect(call("delete_item", { path: "/products", id: "coat", if_rev: rev })).rejects.toThrow(
      /has changed since you read it/,
    );
  });

  it("shows the collection rev in the listing", async () => {
    expect(await call("list_collections")).toMatch(/rev \d+/);
  });

  it("explains revs in the tool text without promising them in the served json", () => {
    for (const name of ["get_item", "list_items", "put_item"]) {
      const description = TOOLS.find((t) => t.name === name)!.description;
      expect(description, name).toMatch(/rev/);
    }
    expect(TOOLS.find((t) => t.name === "put_item")!.description).toMatch(/never appears in what the url serves/);
  });
});

describe("the contract a page has to write against", () => {
  it("states the generic path rule, not just an example", () => {
    for (const name of ["list_collections", "list_items", "put_item"])
      expect(TOOLS.find((t) => t.name === name)!.description, name).toContain("/a/b is served at /data/a/b.json");
  });

  it("says the served item carries its id", () => {
    expect(TOOLS.find((t) => t.name === "list_items")!.description).toMatch(/each served item includes its id/i);
  });

  it("guarantees order rather than leaving it open", () => {
    const description = TOOLS.find((t) => t.name === "list_items")!.description;
    expect(description).toMatch(/preserved exactly/);
    expect(description).toMatch(/no sort field/);
  });

  it("says nested values round-trip and that merging is shallow", () => {
    const description = TOOLS.find((t) => t.name === "put_item")!.description;
    expect(description).toMatch(/[Nn]ested objects and arrays of objects are stored and served unchanged/);
    expect(description).toMatch(/[Mm]erging is shallow/);
  });

  it("points at a fetchable index for discovery", () => {
    expect(TOOLS.find((t) => t.name === "list_collections")!.description).toContain("/data/_collections.json");
  });

  it("round-trips a nested value through put_item and get_item", async () => {
    const fields = { price: { amount: 120, currency: "USD" }, sizes: [{ label: "S", stock: 2 }] };
    await call("put_item", { path: "/products", id: "coat", fields });
    expect((await json("get_item", { path: "/products", id: "coat" })).item).toEqual({ id: "coat", ...fields });
  });

  it("refuses a collection on the reserved index path", async () => {
    await expect(call("put_item", { path: "/_collections", fields: { title: "x" } })).rejects.toThrow(/reserved/);
  });
});

describe("match_names", () => {
  beforeEach(async () => {
    await saveCollection("/venues", [
      { id: "acme", name: "ACME Corporation", note: "Acme Corp. is not this one" },
      { id: "rouge", name: "Café Rouge" },
      { id: "brauhaus", name: "Grüner Brauhaus" },
      { id: "tokyo", name: "Hotel Tokyo Station" },
      { id: "istanbul", name: "Istanbul Modern" },
      { id: "north", name: "North Clinic" },
      { id: "bristol", name: "Hotel Bristol" },
      { id: "stereo", name: "Club Stereo" },
      { id: "unnamed", label: "No name field here" },
    ]);
  });

  it("finds the entity behind a differently written name", async () => {
    const result = await json("match_names", { path: "/venues", names: ["Acme Corp."] });
    expect(result.results[0].matches[0].id).toBe("acme");
    expect(result.results[0].matches[0].value).toBe("ACME Corporation");
    expect(result.results[0].matches[0].score).toBeGreaterThanOrEqual(0.6);
  });

  it("answers every candidate in the order given", async () => {
    const names = ["Cafe Rouge", "Nothing Like This", "Gruener Brauhaus"];
    const result = await json("match_names", { path: "/venues", names });
    expect(result.results.map((r: any) => r.name)).toEqual(names);
    expect(result.results[0].matches[0].id).toBe("rouge");
    expect(result.results[1].matches).toEqual([]);
    expect(result.results[2].matches[0].id).toBe("brauhaus");
  });

  it("ignores word order and transliterated diacritics", async () => {
    const result = await json("match_names", {
      path: "/venues",
      names: ["Tokyo Station Hotel", "İstanbul Modern"],
    });
    expect(result.results[0].matches[0].id).toBe("tokyo");
    expect(result.results[1].matches[0].id).toBe("istanbul");
  });

  it("keeps genuinely different names apart", async () => {
    const result = await json("match_names", {
      path: "/venues",
      names: ["South Clinic", "Hotel Brussels", "Live Club"],
    });
    for (const entry of result.results) expect(entry.matches, entry.name).toEqual([]);
  });

  it("sorts matches best first", async () => {
    await saveCollection("/venues", [
      { id: "exact", name: "Red Lion" },
      { id: "qualified", name: "Red Lion Hotel and Spa" },
    ]);
    const result = await json("match_names", { path: "/venues", names: ["Red Lion"] });
    const scores = result.results[0].matches.map((m: any) => m.score);
    expect(result.results[0].matches[0].id).toBe("exact");
    expect(scores).toEqual([...scores].sort((a: number, b: number) => b - a));
  });

  it("carries the rev so a duplicate can be updated rather than created", async () => {
    const result = await json("match_names", { path: "/venues", names: ["Cafe Rouge"] });
    const match = result.results[0].matches[0];
    expect(
      await call("put_item", { path: "/venues", id: match.id, fields: { seen: true }, if_rev: match.rev }),
    ).toContain("Updated rouge");
  });

  it("compares only the named field, never long text", async () => {
    const result = await json("match_names", { path: "/venues", names: ["Acme Corp."] });
    expect(result.results[0].matches.map((m: any) => m.id)).toEqual(["acme"]);
    expect(result.field).toBe("name");
  });

  it("can be pointed at another short field", async () => {
    const result = await json("match_names", { path: "/venues", names: ["No Name Field Here"], field: "label" });
    expect(result.results[0].matches[0].id).toBe("unnamed");
  });

  it("skips items with no value in that field and says how many", async () => {
    const result = await json("match_names", { path: "/venues", names: ["Cafe Rouge"] });
    expect(result.compared).toBe(8);
    expect(result.skipped).toBe(1);
  });

  it("honours a raised threshold", async () => {
    const loose = await json("match_names", { path: "/venues", names: ["Acme Corp."], threshold: 0.6 });
    const strict = await json("match_names", { path: "/venues", names: ["Acme Corp."], threshold: 0.99 });
    expect(loose.results[0].matches).toHaveLength(1);
    expect(strict.results[0].matches).toEqual([]);
  });

  it("caps matches per candidate", async () => {
    await saveCollection("/venues", [
      { id: "a", name: "Red Lion" },
      { id: "b", name: "Red Lion Hotel" },
      { id: "c", name: "Red Lion Inn" },
      { id: "d", name: "Red Lion Pub" },
    ]);
    const result = await json("match_names", { path: "/venues", names: ["Red Lion"], limit_per_name: 2 });
    expect(result.results[0].matches).toHaveLength(2);
  });

  it("refuses more than fifty candidates in one call", async () => {
    const names = Array.from({ length: 51 }, (_, n) => `name ${n}`);
    await expect(call("match_names", { path: "/venues", names })).rejects.toThrow(/50 is the most/);
  });

  it("requires names and a collection that exists", async () => {
    await expect(call("match_names", { path: "/venues", names: [] })).rejects.toThrow(/non-empty/);
    await expect(call("match_names", { path: "/nope", names: ["x"] })).rejects.toThrow(/No collection exists/);
  });

  it("warns in its description that a wrong match is the costly one", () => {
    const description = TOOLS.find((t) => t.name === "match_names")!.description;
    expect(description).toMatch(/silently swallows/);
    expect(description).toMatch(/does not read descriptions/);
  });
});
