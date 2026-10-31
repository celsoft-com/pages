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

const call = (name: string, input: Record<string, unknown>) => t.as(owner).call(name, input) as Promise<any>;

async function seed() {
  await call("publish_page", {
    path: "/trip",
    content: "# Trip\n\nSee [day one](/p/trip/day1).",
  });
  await call("publish_page", {
    path: "/trip/day1",
    content: '# Day one\n\n<script>fetch("/data/trip/stops.json")</script>',
  });
  await call("put_item", {
    path: "/trip/kinds",
    id: "museum",
    fields: { name: "Museum" },
  });
  await call("put_item", {
    path: "/trip/stops",
    id: "louvre",
    fields: { kind: "museum" },
  });
  await call("set_collection_refs", {
    path: "/trip/stops",
    refs: { kind: "/trip/kinds" },
  });
}

describe("page transfers", () => {
  it("moves a page alone and reports what still names it and what stayed", async () => {
    await seed();
    const moved = await call("move_page", {
      from: "/trip/day1",
      to: "/trip/first",
    });
    expect(moved).toMatchObject({
      operation: "move",
      scope: "page",
      applied: true,
      resources: [
        {
          kind: "page",
          from: "/trip/day1",
          to: "/trip/first",
          replaced: false,
        },
      ],
      pages_to_update: [{ path: "/trip", lines: [{ line: 3 }] }],
    });
    expect(moved.resources[0].url).toMatch(/\/p\/trip\/first$/);
    expect(await status(call("get_page", { path: "/trip/day1" }))).toBe(400);
    expect((await call("get_page", { path: "/trip/first" })).title).toBe("Day one");
  });

  it("names the rest of the bundle a page move leaves behind", async () => {
    await seed();
    const moved = await call("move_page", { from: "/trip", to: "/journey" });
    expect(moved.rest_of_bundle).toEqual(
      expect.arrayContaining([
        { kind: "page", path: "/trip/day1" },
        { kind: "collection", path: "/trip/stops" },
      ]),
    );
  });

  it("refuses an occupied target unless overwrite is passed", async () => {
    await seed();
    await call("publish_page", { path: "/other", content: "# Other" });
    expect(await status(call("copy_page", { from: "/trip", to: "/other" }))).toBe(400);
    const copied = await call("copy_page", {
      from: "/trip",
      to: "/other",
      overwrite: true,
    });
    expect(copied.resources[0].replaced).toBe(true);
    expect((await call("get_page", { path: "/other" })).title).toBe("Trip");
  });
});

describe("collection transfers", () => {
  it("copies with fresh revs and keeps ids, order and refs", async () => {
    await seed();
    await call("put_item", {
      path: "/trip/stops",
      id: "louvre",
      fields: { note: "x" },
      if_rev: 1,
    });
    const copied = await call("copy_collection", {
      from: "/trip/stops",
      to: "/saved/stops",
    });
    expect(copied.resources[0]).toMatchObject({
      items: 1,
      rev: 1,
      refs: { kind: "/trip/kinds" },
    });
    expect(await call("get_item", { path: "/saved/stops", id: "louvre" })).toMatchObject({
      rev: 1,
      item: { id: "louvre", kind: "museum", note: "x" },
    });
  });

  it("reports the records a delete leaves pointing at nothing", async () => {
    await seed();
    const deleted = await call("delete_collection", { path: "/trip/kinds" });
    expect(deleted.breaks).toEqual([
      {
        path: "/trip/stops",
        field: "kind",
        references: "/trip/kinds",
        count: 1,
      },
    ]);
  });
});

describe("bundle transfers", () => {
  it("returns the inventory without confirm and changes nothing", async () => {
    await seed();
    const planned = await call("move_bundle", {
      from: "/trip",
      to: "/journey",
    });
    expect(planned.applied).toBe(false);
    expect(planned.resources).toHaveLength(4);
    expect((await call("get_page", { path: "/trip" })).title).toBe("Trip");
  });

  it("moves everything with confirm and rewrites refs inside the bundle", async () => {
    await seed();
    const moved = await call("move_bundle", {
      from: "/trip",
      to: "/journey",
      confirm: true,
    });
    expect(moved.applied).toBe(true);
    const { collections } = await call("list_collections", {});
    expect(collections).toMatchObject([
      { path: "/journey/kinds" },
      { path: "/journey/stops", refs: { kind: "/journey/kinds" } },
    ]);
  });

  it("refuses / at either end", async () => {
    await seed();
    expect(await status(call("delete_bundle", { path: "/", confirm: true }))).toBe(400);
    expect(await status(call("list_bundle", { path: "/" }))).toBe(400);
  });
});

describe("list_bundle", () => {
  it("lists what sits under a path", async () => {
    await seed();
    const bundle = await call("list_bundle", { path: "/trip" });
    expect(bundle).toMatchObject({
      path: "/trip",
      has_page: true,
      pages: [{ path: "/trip" }, { path: "/trip/day1" }],
      collections: [{ path: "/trip/kinds" }, { path: "/trip/stops" }],
      assets: [],
    });
  });
});

describe("access", () => {
  it("lets only the owner move things", async () => {
    await seed();
    const guest = await t.signUp("guest@example.com");
    expect(await status(t.as(guest).call("move_page", { from: "/trip", to: "/x" }))).toBe(404);
  });
});
