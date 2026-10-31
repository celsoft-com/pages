import { testApp } from "@celsoft/platform/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "../worker";

let t: Awaited<ReturnType<typeof testApp>>;
let owner: Awaited<ReturnType<typeof t.signUp>>;

beforeEach(async () => {
  t = await testApp(app);
  owner = await t.signUp("owner@example.com");
});
afterEach(() => t.close());

async function status(call: Promise<unknown>): Promise<number | null> {
  return call.then(
    () => null,
    (error) => (error as { status: number }).status,
  );
}

const call = (name: string, input: Record<string, unknown>) =>
  t.as(owner).call(name, input) as Promise<any>;

async function seed() {
  await call("put_item", {
    path: "/venues",
    id: "a",
    fields: { name: "Café Rouge", section: "north", stars: 4 },
  });
  await call("put_item", {
    path: "/venues",
    id: "b",
    fields: { name: "Acme Corporation", section: "south", stars: 4 },
  });
  await call("put_item", {
    path: "/venues",
    id: "c",
    fields: { name: "Blue Door", section: "north", stars: 2 },
  });
}

describe("put_item", () => {
  it("creates the collection and round-trips nested values", async () => {
    const fields = {
      name: "X",
      tags: ["a", "b"],
      where: { lat: 1.5, rows: [{ n: 1 }] },
    };
    const put = await call("put_item", {
      path: "/Things.json",
      id: "x",
      fields,
    });
    expect(put).toMatchObject({
      path: "/things",
      id: "x",
      rev: 1,
      created: true,
    });
    expect(put.url).toMatch(/\/data\/things\.json$/);
    expect(await call("get_item", { path: "/things", id: "x" })).toMatchObject({
      rev: 1,
      item: { id: "x", ...fields },
    });
  });

  it("needs the rev to update, and refuses a stale one", async () => {
    await call("put_item", { path: "/t", id: "x", fields: { n: 1 } });
    expect(
      await status(call("put_item", { path: "/t", id: "x", fields: { n: 2 } })),
    ).toBe(409);
    expect(
      await call("put_item", {
        path: "/t",
        id: "x",
        fields: { n: 2 },
        if_rev: 1,
      }),
    ).toMatchObject({ rev: 2 });
    expect(
      await status(
        call("put_item", { path: "/t", id: "x", fields: { n: 3 }, if_rev: 1 }),
      ),
    ).toBe(409);
  });

  it("merges by default and replaces when merge is false", async () => {
    await call("put_item", { path: "/t", id: "x", fields: { a: 1, b: 2 } });
    await call("put_item", {
      path: "/t",
      id: "x",
      fields: { b: 3 },
      if_rev: 1,
    });
    expect((await call("get_item", { path: "/t", id: "x" })).item).toEqual({
      id: "x",
      a: 1,
      b: 3,
    });
    await call("put_item", {
      path: "/t",
      id: "x",
      fields: { c: 4 },
      merge: false,
      overwrite: true,
    });
    expect((await call("get_item", { path: "/t", id: "x" })).item).toEqual({
      id: "x",
      c: 4,
    });
  });
});

describe("list_items and list_collections", () => {
  it("projects fields and pages", async () => {
    await seed();
    const listed = await call("list_items", {
      path: "/venues",
      fields: ["name"],
      limit: 1,
      offset: 1,
    });
    expect(listed).toMatchObject({
      total: 3,
      offset: 1,
      items: [{ id: "b", item: { id: "b", name: "Acme Corporation" } }],
    });
    expect(Object.keys(listed.items[0].item)).toEqual(["id", "name"]);
    const { collections } = await call("list_collections", {});
    expect(collections).toMatchObject([{ path: "/venues", items: 3 }]);
  });
});

describe("count_items", () => {
  it("groups and filters, numbers included", async () => {
    await seed();
    expect(
      await call("count_items", { path: "/venues", group_by: ["section"] }),
    ).toMatchObject({
      total: 3,
      rows: [
        { section: "north", count: 2 },
        { section: "south", count: 1 },
      ],
    });
    const filter = "$[?@.stars == 4]";
    expect(
      await call("count_items", {
        path: "/venues",
        group_by: ["section"],
        filter,
      }),
    ).toMatchObject({
      total: 2,
      filter,
      rows: [
        { section: "north", count: 1 },
        { section: "south", count: 1 },
      ],
    });
    expect(
      await call("count_items", {
        path: "/venues",
        group_by: ["section"],
        filter: "$[?@.stars > 2 && @.section == 'north']",
      }),
    ).toMatchObject({ total: 1 });
  });

  it("refuses a filter that is not a query or selects less than an item", async () => {
    await seed();
    expect(
      await status(
        call("count_items", {
          path: "/venues",
          group_by: ["section"],
          filter: "$[?@.stars ==",
        }),
      ),
    ).toBe(400);
    expect(
      await status(
        call("count_items", {
          path: "/venues",
          group_by: ["section"],
          filter: "$[*].name",
        }),
      ),
    ).toBe(400);
  });
});

describe("search_items and match_names", () => {
  it("search finds items across collections", async () => {
    await seed();
    const found = await call("search_items", {
      query: "section=north",
      fields: ["name"],
    });
    expect(found.total).toBe(2);
    expect(found.matches.map((m: { id: string }) => m.id)).toEqual(["a", "c"]);
  });

  it("match_names finds spelling variants within a partition", async () => {
    await seed();
    const matched = await call("match_names", {
      path: "/venues",
      names: ["Cafe Rouge", "Acme Corp."],
      filter: '$[?@.section == "north"]',
    });
    expect(matched.results[0].matches[0]).toMatchObject({ id: "a" });
    expect(matched.results[1].matches).toEqual([]);
  });
});

describe("delete_item and reorder_items", () => {
  it("reorders by naming the front", async () => {
    await seed();
    expect(
      await call("reorder_items", { path: "/venues", ids: ["c"] }),
    ).toEqual({
      path: "/venues",
      moved: ["c"],
      rest: 2,
    });
    const listed = await call("list_items", { path: "/venues" });
    expect(listed.items.map((i: { id: string }) => i.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("refuses to orphan a reference unless forced", async () => {
    await call("put_item", { path: "/kinds", id: "bar", fields: {} });
    await call("put_item", { path: "/drinks", id: "ale", fields: {} });
    await call("set_collection_refs", {
      path: "/drinks",
      refs: { kind: "/kinds" },
    });
    await call("put_item", {
      path: "/drinks",
      id: "ale",
      fields: { kind: "bar" },
      if_rev: 1,
    });
    expect(
      await status(
        call("put_item", {
          path: "/drinks",
          id: "gin",
          fields: { kind: "baar" },
        }),
      ),
    ).toBe(400);
    expect(
      await status(call("delete_item", { path: "/kinds", id: "bar" })),
    ).toBe(400);
    const forced = await call("delete_item", {
      path: "/kinds",
      id: "bar",
      force: true,
    });
    expect(forced.orphaned).toMatchObject([
      { path: "/drinks", field: "kind", count: 1 },
    ]);
    expect(await call("check_refs", { path: "/drinks" })).toMatchObject({
      checked: 1,
      broken: [{ id: "ale", value: "bar" }],
    });
  });

  it("check_refs says when nothing was checked", async () => {
    await seed();
    expect(await call("check_refs", { path: "/venues" })).toMatchObject({
      checked: 0,
      warning: expect.any(String),
    });
  });
});

describe("access", () => {
  it("lets anyone signed in read but only the owner write", async () => {
    await seed();
    const guest = await t.signUp("guest@example.com");
    expect(
      await t.as(guest).call("get_item", { path: "/venues", id: "a" }),
    ).toMatchObject({ id: "a" });
    expect(
      await status(
        t
          .as(guest)
          .call("put_item", { path: "/venues", fields: { name: "x" } }),
      ),
    ).toBe(404);
  });
});
