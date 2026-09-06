import { beforeEach, describe, expect, it } from "vitest";
import { handleData } from "../data/handler";
import { saveCollection } from "../data/service";
import { encodeKey, stores } from "../store";
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

describe("match_names scope filter", () => {
  beforeEach(async () => {
    await saveCollection("/trip/items", [
      { id: "bamberg-old-town", name: "The old town", section: "bamberg" },
      { id: "forchheim-old-town", name: "Old town and Saltorturm", section: "forchheim" },
      { id: "coburg-castle", name: "Veste Coburg", section: "coburg" },
      { id: "erlangen-market", name: "Wochenmarkt", section: "erlangen" },
      { id: "nurnberg-market", name: "Wochenmarkt am Hauptmarkt", section: "nurnberg" },
      { id: "furth-park", name: "Stadtpark", section: "furth" },
    ]);
  });

  it("returns nothing for a candidate whose partition has no such place", async () => {
    const result = await json("match_names", {
      path: "/trip/items",
      names: ["Old Town"],
      filter: { section: "coburg" },
    });
    expect(result.results[0].matches).toEqual([]);
  });

  it("returns two for the same candidate unfiltered", async () => {
    const result = await json("match_names", { path: "/trip/items", names: ["Old Town"] });
    expect(result.results[0].matches.map((m: any) => m.id).sort()).toEqual([
      "bamberg-old-town",
      "forchheim-old-town",
    ]);
  });

  it("returns exactly the record from the named partition", async () => {
    const result = await json("match_names", {
      path: "/trip/items",
      names: ["Old Town"],
      filter: { section: "bamberg" },
    });
    expect(result.results[0].matches.map((m: any) => m.id)).toEqual(["bamberg-old-town"]);
  });

  it("leaves unfiltered behaviour exactly as it was", async () => {
    const names = ["Old Town", "Wochenmarkt", "Stadtpark"];
    const before = await json("match_names", { path: "/trip/items", names });
    const withEmpty = await json("match_names", { path: "/trip/items", names, filter: {} });
    expect(withEmpty.results).toEqual(before.results);
    expect(withEmpty.compared).toBe(before.compared);
  });

  it("reports compared 0 and no matches for a partition that does not exist", async () => {
    const result = await json("match_names", {
      path: "/trip/items",
      names: ["Old Town", "Stadtpark"],
      filter: { section: "atlantis" },
    });
    expect(result.compared).toBe(0);
    for (const entry of result.results) expect(entry.matches).toEqual([]);
  });

  it("returns empty rather than erroring on a field no record has", async () => {
    const result = await json("match_names", {
      path: "/trip/items",
      names: ["Old Town"],
      filter: { nonexistent_field: "x" },
    });
    expect(result.compared).toBe(0);
    expect(result.results[0].matches).toEqual([]);
  });

  it("combines several fields with and", async () => {
    await saveCollection("/trip/items", [
      { id: "a", name: "Stadtpark", section: "furth", day: 1 },
      { id: "b", name: "Stadtpark", section: "furth", day: 2 },
    ]);
    const result = await json("match_names", {
      path: "/trip/items",
      names: ["Stadtpark"],
      filter: { section: "furth", day: 2 },
    });
    expect(result.results[0].matches.map((m: any) => m.id)).toEqual(["b"]);
  });

  it("compares filter values exactly, without the folding used on names", async () => {
    await saveCollection("/trip/items", [{ id: "a", name: "Stadtpark", section: "Fürth" }]);
    const folded = await json("match_names", {
      path: "/trip/items",
      names: ["Stadtpark"],
      filter: { section: "furth" },
    });
    const exact = await json("match_names", {
      path: "/trip/items",
      names: ["Stadtpark"],
      filter: { section: "Fürth" },
    });
    expect(folded.compared).toBe(0);
    expect(exact.results[0].matches.map((m: any) => m.id)).toEqual(["a"]);
  });

  it("counts only the partition in compared", async () => {
    const result = await json("match_names", {
      path: "/trip/items",
      names: ["Old Town"],
      filter: { section: "bamberg" },
    });
    expect(result.compared).toBe(1);
    expect(result.filter).toEqual({ section: "bamberg" });
  });

  it("rejects a filter that is not an object", async () => {
    await expect(
      call("match_names", { path: "/trip/items", names: ["x"], filter: ["section", "bamberg"] }),
    ).rejects.toThrow(/object of field\/value pairs/);
  });
});

describe("match_names scoring regressions", () => {
  beforeEach(async () => {
    await saveCollection("/places", [
      { id: "keesmann", name: "Brauerei Keesmann" },
      { id: "fassla", name: "Fässla Keller" },
      { id: "schlenkerla", name: "Schlenkerla" },
      { id: "hirsch", name: "Hirsch" },
      { id: "haus45", name: "Haus 45" },
    ]);
  });

  async function best(name: string): Promise<{ id: string; score: number } | undefined> {
    const result = await json("match_names", { path: "/places", names: [name] });
    return result.results[0].matches[0];
  }

  it("ignores word order", async () => {
    expect(await best("Keesmann Brauerei")).toMatchObject({ id: "keesmann", score: 1 });
  });

  it("folds diacritics", async () => {
    expect(await best("Fassla Keller")).toMatchObject({ id: "fassla", score: 1 });
  });

  it("tolerates a trailing qualifier", async () => {
    expect(await best("Schlenkerla, Rauchbierbrauerei")).toMatchObject({ id: "schlenkerla", score: 0.833 });
  });

  it("does not match on a shared frequent token alone", async () => {
    expect(await best("Brauerei Spätzle")).toBeUndefined();
  });

  it("treats digits as significant", async () => {
    expect(await best("Haus 44")).toBeUndefined();
  });

  it("keeps a single-token typo just above the default threshold", async () => {
    expect(await best("Hirsh")).toMatchObject({ id: "hirsch", score: 0.625 });
  });
});

describe("count_items", () => {
  const sections = ["bamberg", "coburg", "erlangen", "forchheim", "fuerth", "nurnberg", "wuerzburg", "zeil"];
  const groups = ["sights", "drink", "food", "walk", "museum", "market", "stay"];

  async function seedTrip(): Promise<void> {
    const items: any[] = [];
    let n = 0;
    while (items.length < 195) {
      const section = sections[n % sections.length];
      const group = groups[Math.floor(n / sections.length) % groups.length];
      items.push({ id: `i${n}`, name: `Place ${n}`, section, group });
      n++;
    }
    await saveCollection("/trip/items", items);
  }

  beforeEach(seedTrip);

  it("groups by one field and accounts for every record", async () => {
    const result = await json("count_items", { path: "/trip/items", group_by: ["section"] });
    expect(result.rows).toHaveLength(8);
    expect(result.rows.reduce((sum: number, r: any) => sum + r.count, 0)).toBe(195);
    expect(result.total).toBe(195);
  });

  it("groups by two fields with no empty rows", async () => {
    const result = await json("count_items", { path: "/trip/items", group_by: ["section", "group"] });
    expect(result.rows.reduce((sum: number, r: any) => sum + r.count, 0)).toBe(195);
    for (const row of result.rows) expect(row.count).toBeGreaterThan(0);
  });

  it("omits combinations that do not occur rather than reporting them as zero", async () => {
    await saveCollection("/trip/items", [
      { id: "a", section: "coburg", group: "sights" },
      { id: "b", section: "bamberg", group: "drink" },
    ]);
    const result = await json("count_items", { path: "/trip/items", group_by: ["section", "group"] });
    expect(result.rows).toHaveLength(2);
  });

  it("narrows to a filter and reports that partition's total", async () => {
    const result = await json("count_items", {
      path: "/trip/items",
      group_by: ["group"],
      filter: { section: "fuerth" },
    });
    const fuerth = result.rows.reduce((sum: number, r: any) => sum + r.count, 0);
    expect(result.total).toBe(fuerth);
    expect(result.total).toBeLessThan(195);
    expect(result.filter).toEqual({ section: "fuerth" });
  });

  it("keeps records missing the field visible under null", async () => {
    await saveCollection("/trip/items", [
      { id: "a", section: "coburg", group: "sights" },
      { id: "b", section: "coburg" },
    ]);
    const result = await json("count_items", { path: "/trip/items", group_by: ["group"] });
    expect(result.rows).toContainEqual({ group: null, count: 1 });
  });

  it("errors on an array field, naming it", async () => {
    await saveCollection("/trip/items", [{ id: "a", links: ["https://example.com"] }]);
    await expect(call("count_items", { path: "/trip/items", group_by: ["links"] })).rejects.toThrow(
      /"links" holds an array/,
    );
  });

  it("errors on an object field, naming it", async () => {
    await saveCollection("/trip/items", [{ id: "a", price: { amount: 1 } }]);
    await expect(call("count_items", { path: "/trip/items", group_by: ["price"] })).rejects.toThrow(
      /"price" holds an object/,
    );
  });

  it("answers a 195 item collection in under 4KB", async () => {
    const counted = await call("count_items", { path: "/trip/items", group_by: ["section", "group"] });
    const listed = await call("list_items", { path: "/trip/items", limit: 195 });

    expect(counted.length).toBeLessThan(4096);
    expect(counted.length * 4).toBeLessThan(listed.length);
  });

  it("orders rows deterministically by the grouped fields", async () => {
    const first = await call("count_items", { path: "/trip/items", group_by: ["section", "group"] });
    const again = await call("count_items", { path: "/trip/items", group_by: ["section", "group"] });
    expect(first).toBe(again);

    const rows = JSON.parse(first).rows;
    const keys = rows.map((r: any) => `${r.section}|${r.group}`);
    expect(keys).toEqual([...keys].sort());
  });

  it("sorts numbers as numbers and puts null first", async () => {
    await saveCollection("/trip/items", [
      { id: "a", day: 10 },
      { id: "b", day: 9 },
      { id: "c" },
    ]);
    const result = await json("count_items", { path: "/trip/items", group_by: ["day"] });
    expect(result.rows.map((r: any) => r.day)).toEqual([null, 9, 10]);
  });

  it("refuses more than three grouping fields", async () => {
    await expect(
      call("count_items", { path: "/trip/items", group_by: ["a", "b", "c", "d"] }),
    ).rejects.toThrow(/3 is the most/);
  });

  it("requires a collection and at least one field", async () => {
    await expect(call("count_items", { path: "/trip/items", group_by: [] })).rejects.toThrow(/non-empty/);
    await expect(call("count_items", { path: "/nope", group_by: ["section"] })).rejects.toThrow(
      /No collection exists/,
    );
  });

  it("refuses to truncate beyond a thousand combinations", async () => {
    await saveCollection("/wide", Array.from({ length: 1200 }, (_, n) => ({ id: `i${n}`, key: `k${n}` })));
    await expect(call("count_items", { path: "/wide", group_by: ["key"] })).rejects.toThrow(
      /more than 1000 combinations/,
    );
  });

  it("names list_items and the other tools so the choice is explicit", () => {
    const description = TOOLS.find((t) => t.name === "count_items")!.description;
    expect(description).toMatch(/Prefer it over list_items/);
    expect(description).toMatch(/search_items/);
    expect(description).toMatch(/match_names/);
    expect(description).toMatch(/before proposing additions/);
  });
});

describe("referential integrity", () => {
  beforeEach(async () => {
    await saveCollection("/trip/filters", [
      { id: "outdoors", label: "Outdoors" },
      { id: "odd", label: "Odd" },
      { id: "drink", label: "Drink" },
    ]);
    await saveCollection("/trip/items", [{ id: "castle", name: "Veste Coburg", group: "outdoors" }]);
  });

  it("declares a constraint on a clean collection with no violations", async () => {
    const text = await call("set_collection_refs", {
      path: "/trip/items",
      refs: { group: "/trip/filters" },
    });
    expect(text).toContain("group references ids in /trip/filters");
    expect(text).toContain("No existing record violates that");
  });

  it("rejects a mistyped value, naming the field, value, collection and closest id", async () => {
    await call("set_collection_refs", { path: "/trip/items", refs: { group: "/trip/filters" } });

    const write = call("put_item", { path: "/trip/items", id: "market", fields: { group: "outdoor" } });
    await expect(write).rejects.toThrow(/Field "group"/);
    await expect(write).rejects.toThrow(/"outdoor" is not an id in \/trip\/filters/);
    await expect(write).rejects.toThrow(/Closest ids: outdoors/);
  });

  it("accepts the corrected value", async () => {
    await call("set_collection_refs", { path: "/trip/items", refs: { group: "/trip/filters" } });
    expect(await call("put_item", { path: "/trip/items", id: "market", fields: { group: "outdoors" } })).toContain(
      "Created market",
    );
  });

  it("leaves a merge that does not touch the field alone", async () => {
    await call("set_collection_refs", { path: "/trip/items", refs: { group: "/trip/filters" } });
    const { rev } = await json("get_item", { path: "/trip/items", id: "castle" });
    expect(
      await call("put_item", { path: "/trip/items", id: "castle", fields: { note: "open late" }, if_rev: rev }),
    ).toContain("Updated castle");
  });

  it("permits an explicit null", async () => {
    await call("set_collection_refs", { path: "/trip/items", refs: { group: "/trip/filters" } });
    expect(await call("put_item", { path: "/trip/items", id: "tbd", fields: { group: null } })).toContain(
      "Created tbd",
    );
  });

  it("adopts a constraint on a collection that already violates it", async () => {
    await saveCollection("/trip/items", [
      { id: "castle", group: "outdoors" },
      { id: "market", group: "outdoor" },
    ]);
    const text = await call("set_collection_refs", { path: "/trip/items", refs: { group: "/trip/filters" } });
    expect(text).toContain("1 existing record already violates it");
  });

  it("finds exactly the violating record", async () => {
    await saveCollection("/trip/items", [
      { id: "castle", group: "outdoors" },
      { id: "market", group: "outdoor" },
      { id: "tbd" },
    ]);
    await call("set_collection_refs", { path: "/trip/items", refs: { group: "/trip/filters" } });

    const result = await json("check_refs", { path: "/trip/items" });
    expect(result.checked).toBe(3);
    expect(result.broken).toEqual([
      { id: "market", field: "group", value: "outdoor", references: "/trip/filters" },
    ]);
  });

  it("reports a healthy collection as broken: []", async () => {
    await call("set_collection_refs", { path: "/trip/items", refs: { group: "/trip/filters" } });
    expect((await json("check_refs", { path: "/trip/items" })).broken).toEqual([]);
  });

  it("errors on a field with no declared reference rather than reporting health", async () => {
    await call("set_collection_refs", { path: "/trip/items", refs: { group: "/trip/filters" } });
    await expect(call("check_refs", { path: "/trip/items", field: "section" })).rejects.toThrow(
      /does not reference another collection/,
    );
  });

  it("refuses to delete a referenced id, naming the count", async () => {
    const items = Array.from({ length: 30 }, (_, n) => ({ id: `i${n}`, group: "outdoors" }));
    await saveCollection("/trip/items", items);
    await call("set_collection_refs", { path: "/trip/items", refs: { group: "/trip/filters" } });

    await expect(call("delete_item", { path: "/trip/filters", id: "outdoors" })).rejects.toThrow(
      /would orphan 30 records/,
    );
  });

  it("deletes a referenced id when forced", async () => {
    await call("set_collection_refs", { path: "/trip/items", refs: { group: "/trip/filters" } });
    const text = await call("delete_item", { path: "/trip/filters", id: "outdoors", force: true });
    expect(JSON.parse(text)).toMatchObject({ deleted: "outdoors", path: "/trip/filters" });
  });

  it("leaves an unreferenced id deletable", async () => {
    await call("set_collection_refs", { path: "/trip/items", refs: { group: "/trip/filters" } });
    expect(await call("delete_item", { path: "/trip/filters", id: "drink" })).toContain("Deleted");
  });

  it("clears every constraint on an empty map", async () => {
    await call("set_collection_refs", { path: "/trip/items", refs: { group: "/trip/filters" } });
    expect(await call("set_collection_refs", { path: "/trip/items", refs: {} })).toContain("Cleared");
    expect(await call("put_item", { path: "/trip/items", id: "market", fields: { group: "anything" } })).toContain(
      "Created",
    );
  });

  it("warns when the referenced collection does not exist yet", async () => {
    const text = await call("set_collection_refs", { path: "/trip/items", refs: { section: "/trip/sections" } });
    expect(text).toMatch(/does not exist yet/);
  });

  it("advertises declared refs in the collection listing", async () => {
    await call("set_collection_refs", { path: "/trip/items", refs: { group: "/trip/filters" } });
    expect(await call("list_collections")).toContain("refs group->/trip/filters");
  });

  it("survives an unrelated write without losing the constraint", async () => {
    await call("set_collection_refs", { path: "/trip/items", refs: { group: "/trip/filters" } });
    await call("put_item", { path: "/trip/items", id: "new", fields: { group: "drink" } });

    await expect(call("put_item", { path: "/trip/items", id: "bad", fields: { group: "nope" } })).rejects.toThrow(
      /not an id/,
    );
  });

  it("answers a healthy 195 item audit in under 500 bytes", async () => {
    await saveCollection(
      "/trip/items",
      Array.from({ length: 195 }, (_, n) => ({ id: `i${n}`, name: `Place ${n}`, group: "outdoors" })),
    );
    await call("set_collection_refs", { path: "/trip/items", refs: { group: "/trip/filters" } });

    const text = await call("check_refs", { path: "/trip/items" });
    expect(JSON.parse(text).checked).toBe(195);
    expect(text.length).toBeLessThan(500);
  });

  it("says in its description why the failure is silent", () => {
    const declare = TOOLS.find((t) => t.name === "set_collection_refs")!.description;
    expect(declare).toMatch(/silent at every level/);
    expect(TOOLS.find((t) => t.name === "check_refs")!.description).toMatch(/count_items/);
  });
});

describe("check_refs states its own scope", () => {
  async function seed195(): Promise<void> {
    await saveCollection("/trip/filters", [{ id: "outdoors" }, { id: "drink" }]);
    await saveCollection("/trip/sections", [{ id: "coburg" }, { id: "bamberg" }]);
    await saveCollection(
      "/trip/items",
      Array.from({ length: 195 }, (_, n) => ({
        id: `i${n}`,
        name: `Place ${n}`,
        group: n % 2 ? "outdoors" : "drink",
        section: n % 3 ? "coburg" : "bamberg",
      })),
    );
  }

  beforeEach(seed195);

  it("reports checked 0 and a warning when nothing is declared", async () => {
    const result = await json("check_refs", { path: "/trip/items" });
    expect(result.checked).toBe(0);
    expect(result.refs_declared).toEqual({});
    expect(result.broken).toEqual([]);
    expect(result.warning).toMatch(/nothing was checked/);
    expect(result.warning).toMatch(/set_collection_refs/);
  });

  it("reports what it verified once references are declared", async () => {
    await call("set_collection_refs", {
      path: "/trip/items",
      refs: { group: "/trip/filters", section: "/trip/sections" },
    });

    const result = await json("check_refs", { path: "/trip/items" });
    expect(result.checked).toBe(195);
    expect(result.refs_declared).toEqual({ group: "/trip/filters", section: "/trip/sections" });
    expect(result.broken).toEqual([]);
    expect(result.warning).toBeUndefined();
  });

  it("separates the two by the checked count alone, without reading prose", async () => {
    const unconstrained = (await json("check_refs", { path: "/trip/items" })).checked;
    await call("set_collection_refs", { path: "/trip/items", refs: { group: "/trip/filters" } });
    const constrained = (await json("check_refs", { path: "/trip/items" })).checked;

    expect(unconstrained).toBe(0);
    expect(constrained).toBe(195);
  });

  it("still counts every record when one of them is broken", async () => {
    await call("set_collection_refs", { path: "/trip/items", refs: { group: "/trip/filters" } });
    await saveCollection("/trip/filters", [{ id: "outdoors" }]);

    const result = await json("check_refs", { path: "/trip/items" });
    expect(result.checked).toBe(195);
    expect(result.broken.every((b: any) => b.value === "drink")).toBe(true);
    expect(result.broken).toHaveLength(98);
  });

  it("finds exactly the one bad record among 195", async () => {
    await call("set_collection_refs", { path: "/trip/items", refs: { group: "/trip/filters" } });
    const collection = await json("list_items", { path: "/trip/items", limit: 1 });
    await call("put_item", {
      path: "/trip/items",
      id: "i0",
      fields: { group: "outdoors" },
      if_rev: collection.items[0].rev,
    });
    await saveCollection("/trip/filters", [{ id: "outdoors" }, { id: "drink" }, { id: "spare" }]);
    await call("put_item", { path: "/trip/items", id: "typo", fields: { group: "spare" } });
    await saveCollection("/trip/filters", [{ id: "outdoors" }, { id: "drink" }]);

    const result = await json("check_refs", { path: "/trip/items" });
    expect(result.checked).toBe(196);
    expect(result.broken).toEqual([{ id: "typo", field: "group", value: "spare", references: "/trip/filters" }]);
  });

  it("still errors on an undeclared field rather than reporting health", async () => {
    await call("set_collection_refs", { path: "/trip/items", refs: { group: "/trip/filters" } });
    await expect(call("check_refs", { path: "/trip/items", field: "colour" })).rejects.toThrow(
      /"colour" on \/trip\/items does not reference another collection/,
    );
    await expect(call("check_refs", { path: "/trip/items", field: "colour" })).rejects.toThrow(
      /Declared references: group/,
    );
  });

  it("errors on an undeclared field even when nothing at all is declared", async () => {
    await expect(call("check_refs", { path: "/trip/items", field: "group" })).rejects.toThrow(
      /Declared references: none/,
    );
  });

  it("stays under 500 bytes for a healthy 195 item audit", async () => {
    await call("set_collection_refs", {
      path: "/trip/items",
      refs: { group: "/trip/filters", section: "/trip/sections" },
    });
    expect((await call("check_refs", { path: "/trip/items" })).length).toBeLessThan(500);
  });
});

describe("check_refs description", () => {
  const description = () => TOOLS.find((t) => t.name === "check_refs")!.description;

  it("never claims an empty result means the collection is clean", () => {
    expect(description()).not.toMatch(/clean collection returns almost nothing/);
    expect(description()).not.toMatch(/a clean collection returns/i);
    expect(description()).not.toMatch(/returns only the failures/i);
  });

  it("says only declared fields are checked", () => {
    expect(description()).toMatch(/only checks fields declared with set_collection_refs/);
    expect(description()).toMatch(/none declared, nothing is checked/);
  });

  it("points at refs_declared before an empty result is trusted", () => {
    expect(description()).toMatch(/Check refs_declared/);
    expect(description()).toMatch(/before trusting an empty result/);
  });

  it("does not offer declaring as an alternative to auditing", () => {
    expect(description()).not.toMatch(/prevents it instead/);
    expect(description()).not.toMatch(/\binstead,/);
    expect(description()).toMatch(/audit is for records created before the constraint existed/);
  });

  it("keeps the count_items trigger", () => {
    expect(description()).toMatch(/count_items shows an unexpected value/);
  });
});

describe("delete_item reports what force broke", () => {
  beforeEach(async () => {
    await saveCollection("/trip/filters", [{ id: "odd" }, { id: "outdoors" }, { id: "spare" }]);
    await saveCollection("/trip/items", [
      { id: "bamberg-witch-trials", group: "odd" },
      { id: "lochgefaengnisse", group: "odd" },
      { id: "norisring", group: "odd" },
      { id: "castle", group: "outdoors" },
    ]);
    await call("set_collection_refs", { path: "/trip/items", refs: { group: "/trip/filters" } });
  });

  it("names the collection, field, count and ids it orphaned", async () => {
    const text = await call("delete_item", { path: "/trip/filters", id: "odd", force: true });
    expect(JSON.parse(text)).toEqual({
      deleted: "odd",
      path: "/trip/filters",
      orphaned: [
        {
          path: "/trip/items",
          field: "group",
          count: 3,
          ids: ["bamberg-witch-trials", "lochgefaengnisse", "norisring"],
        },
      ],
    });
  });

  it("stays quiet when nothing was orphaned", async () => {
    const text = await call("delete_item", { path: "/trip/filters", id: "spare" });
    expect(text).toBe("Deleted spare from /trip/filters");
    expect(text).not.toContain("orphaned");
  });

  it("still refuses without force, naming the count", async () => {
    await expect(call("delete_item", { path: "/trip/filters", id: "odd" })).rejects.toThrow(
      /would orphan 3 records/,
    );
    expect((await json("get_item", { path: "/trip/filters", id: "odd" })).id).toBe("odd");
  });

  it("caps the ids at twenty while counting them all", async () => {
    await saveCollection(
      "/trip/items",
      Array.from({ length: 50 }, (_, n) => ({ id: `i${n}`, group: "odd" })),
    );
    const text = await call("delete_item", { path: "/trip/filters", id: "odd", force: true });
    const [orphaned] = JSON.parse(text).orphaned;

    expect(orphaned.count).toBe(50);
    expect(orphaned.ids).toHaveLength(20);
    expect(orphaned.ids[0]).toBe("i0");
  });

  it("agrees with check_refs run straight afterwards", async () => {
    const deleted = JSON.parse(await call("delete_item", { path: "/trip/filters", id: "odd", force: true }));
    const audit = await json("check_refs", { path: "/trip/items" });

    expect(audit.broken.map((b: any) => b.id).sort()).toEqual([...deleted.orphaned[0].ids].sort());
    expect(audit.broken.every((b: any) => b.value === "odd")).toBe(true);
  });

  it("groups orphans by each collection and field that referenced the id", async () => {
    await saveCollection("/trip/notes", [
      { id: "n1", tag: "odd" },
      { id: "n2", tag: "odd" },
    ]);
    await call("set_collection_refs", { path: "/trip/notes", refs: { tag: "/trip/filters" } });

    const { orphaned } = JSON.parse(await call("delete_item", { path: "/trip/filters", id: "odd", force: true }));
    expect(orphaned).toHaveLength(2);
    expect(orphaned.map((o: any) => [o.path, o.field, o.count]).sort()).toEqual([
      ["/trip/items", "group", 3],
      ["/trip/notes", "tag", 2],
    ]);
  });

  it("promises the listing in its description", () => {
    expect(TOOLS.find((t) => t.name === "delete_item")!.description).toMatch(
      /the reply lists what it broke/,
    );
  });
});

describe("list_collections", () => {
  async function writeLegacyBlob(path: string, count: number): Promise<void> {
    await stores.data().setJSON(encodeKey(path), {
      path,
      items: Array.from({ length: count }, (_, n) => ({ id: `i${n}` })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  it("lists collections written before refs and rev existed", async () => {
    await writeLegacyBlob("/trip/items", 195);
    await writeLegacyBlob("/trip/sections", 8);

    const text = await call("list_collections");
    expect(text).toContain("/trip/items  195 items  rev 0");
    expect(text).toContain("/trip/sections  8 items  rev 0");
    expect(text).toContain("served at https://example.com/data/items.json".replace("/items", "/trip/items"));
  });

  it("succeeds on a site with no collections at all", async () => {
    expect(await call("list_collections")).toMatch(/No data collections/);
  });

  it("succeeds on a site with several collections", async () => {
    await saveCollection("/a", [{ id: "x" }]);
    await saveCollection("/b", [{ id: "y" }]);
    await writeLegacyBlob("/c", 3);

    const lines = (await call("list_collections")).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => line.split("  ")[0])).toEqual(["/a", "/b", "/c"]);
  });

  it("serves the http index for a legacy collection too", async () => {
    await writeLegacyBlob("/trip/items", 195);
    const response = await handleData(new Request("https://example.com/data/_collections.json"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        path: "/trip/items",
        url: "/data/trip/items.json",
        count: 195,
        rev: 0,
        owner: null,
        updatedAt: expect.any(Number),
      },
    ]);
  });
});
