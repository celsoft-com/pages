import { beforeEach, describe, expect, it } from "vitest";
import { putAsset } from "../assets/service";
import { saveCollection, setRefs } from "../data/service";
import { savePage } from "../pages/service";
import { setPrivate } from "../private/service";
import { resetBlobs } from "../test/blobs";
import { TOOLS, type ToolContext } from "./tools";

// What a handler returns is the REST body, byte for byte, so its keys are published API: a service
// is reading them by name. Every other suite asserts the rendered sentence, which is a different
// thing and hides a broken shape, since a renderer can build the right words out of the wrong
// object. This file pins the object.
const ctx: ToolContext = { siteUrl: "https://example.com" };

beforeEach(resetBlobs);

async function raw(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`No tool named ${name}`);
  return tool.handler(args, ctx);
}

function keys(value: unknown): string[] {
  return Object.keys(value as Record<string, unknown>).sort();
}

async function seed(): Promise<void> {
  await savePage({ path: "/trip", contentType: "markdown", title: "Trip", body: "# Trip\n\nA line.\n" });
  await saveCollection("/trip/items", [
    { id: "muc", name: "Munich", group: "south" },
    { id: "cob", name: "Coburg", group: "north" },
  ]);
  await saveCollection("/trip/groups", [{ id: "south" }, { id: "north" }]);
  await putAsset({
    filename: "coburg.jpg",
    contentType: "image/jpeg",
    bytes: new TextEncoder().encode("PICTURE").buffer,
    path: "/trip/coburg.jpg",
  });
}

describe("page results", () => {
  beforeEach(seed);

  it("list_pages", async () => {
    const r = await raw("list_pages");
    expect(keys(r)).toEqual(["pages"]);
    expect(keys(r.pages[0])).toEqual(["format", "path", "title", "url"]);
  });

  it("get_page whole", async () => {
    expect(keys(await raw("get_page", { path: "/trip" }))).toEqual(["content", "format", "path", "title"]);
  });

  it("get_page sliced", async () => {
    const r = await raw("get_page", { path: "/trip", find: "line" });
    expect(keys(r)).toEqual(["format", "lines", "more", "path", "title", "total"]);
  });

  it("publish_page and update_page share one shape", async () => {
    const published = await raw("publish_page", { path: "/new", content: "# New" });
    const updated = await raw("update_page", { path: "/new", content: "# Newer" });
    expect(keys(published)).toEqual(["format", "path", "title", "url"]);
    expect(keys(updated)).toEqual(keys(published));
  });

  it("edit_page", async () => {
    const r = await raw("edit_page", { path: "/trip", find: "A line.", replace: "A change." });
    expect(keys(r)).toEqual(["lines", "path", "replaced", "url"]);
  });
});

describe("asset results", () => {
  beforeEach(seed);

  it("upload_asset", async () => {
    const r = await raw("upload_asset", {
      filename: "x.png",
      content_base64: btoa("BYTES"),
      content_type: "image/png",
      path: "/trip/x.png",
    });
    expect(keys(r)).toEqual(["bytes", "content_type", "filename", "path", "url"]);
  });

  it("list_assets", async () => {
    const r = await raw("list_assets");
    expect(keys(r)).toEqual(["assets"]);
    expect(keys(r.assets[0])).toEqual(["bytes", "filename", "path", "url"]);
  });

  it("list_bundle", async () => {
    const r = await raw("list_bundle", { path: "/trip" });
    expect(keys(r)).toEqual(["assets", "collections", "has_page", "pages", "path"]);
    expect(keys(r.pages[0])).toEqual(["path", "title", "url"]);
    expect(keys(r.collections[0])).toEqual(["items", "path", "refs", "rev", "url"]);
    expect(keys(r.assets[0])).toEqual(["bytes", "path", "url"]);
  });
});

describe("data results", () => {
  beforeEach(seed);

  it("list_collections", async () => {
    const r = await raw("list_collections");
    expect(keys(r)).toEqual(["collections"]);
    expect(keys(r.collections[0])).toEqual(["items", "path", "refs", "rev", "url"]);
  });

  it("list_items", async () => {
    const r = await raw("list_items", { path: "/trip/items" });
    expect(keys(r)).toEqual(["items", "offset", "path", "rev", "served", "total", "url"]);
    expect(keys(r.items[0])).toEqual(["id", "item", "rev"]);
  });

  it("count_items, with filter only when one was given", async () => {
    const plain = await raw("count_items", { path: "/trip/items", group_by: ["group"] });
    expect(keys(plain)).toEqual(["group_by", "path", "rows", "total"]);

    const filtered = await raw("count_items", {
      path: "/trip/items",
      group_by: ["group"],
      filter: { group: "south" },
    });
    expect(keys(filtered)).toEqual(["filter", "group_by", "path", "rows", "total"]);
  });

  it("get_item", async () => {
    expect(keys(await raw("get_item", { path: "/trip/items", id: "muc" }))).toEqual([
      "id",
      "item",
      "path",
      "rev",
      "url",
    ]);
  });

  it("put_item", async () => {
    const r = await raw("put_item", { path: "/trip/items", fields: { name: "Bamberg" } });
    expect(keys(r)).toEqual(["created", "id", "path", "rev", "url"]);
  });

  it("delete_item keeps orphaned present even when nothing broke", async () => {
    const r = await raw("delete_item", { path: "/trip/items", id: "muc" });
    expect(keys(r)).toEqual(["deleted", "orphaned", "path"]);
    expect(r.orphaned).toEqual([]);
  });

  it("reorder_items", async () => {
    expect(keys(await raw("reorder_items", { path: "/trip/items", ids: ["cob"] }))).toEqual([
      "moved",
      "path",
      "rest",
    ]);
  });

  it("search_items, including when nothing matched", async () => {
    const hit = await raw("search_items", { query: "Munich" });
    expect(keys(hit)).toEqual(["matches", "query", "total"]);
    expect(keys(hit.matches[0])).toEqual(["id", "index", "item", "path", "rev", "url"]);

    const miss = await raw("search_items", { query: "nothingatall" });
    expect(keys(miss)).toEqual(["matches", "query", "total"]);
  });

  it("match_names", async () => {
    const r = await raw("match_names", { path: "/trip/items", names: ["Munchen"] });
    expect(keys(r)).toEqual(["compared", "field", "path", "results", "skipped", "threshold"]);
    expect(keys(r.results[0])).toEqual(["matches", "name"]);
  });

  it("set_collection_refs", async () => {
    const r = await raw("set_collection_refs", { path: "/trip/items", refs: { group: "/trip/groups" } });
    expect(keys(r)).toEqual(["missing", "path", "refs", "violations"]);
  });

  it("check_refs carries refs_declared either way, and warns when it checked nothing", async () => {
    const nothing = await raw("check_refs", { path: "/trip/items" });
    expect(keys(nothing)).toEqual(["broken", "checked", "path", "refs_declared", "warning"]);
    expect(nothing.checked).toBe(0);

    await setRefs("/trip/items", { group: "/trip/groups" });
    const checked = await raw("check_refs", { path: "/trip/items" });
    expect(keys(checked)).toEqual(["broken", "checked", "path", "refs_declared"]);
  });
});

describe("site and privacy results", () => {
  beforeEach(seed);

  it("get_site", async () => {
    expect(keys(await raw("get_site"))).toEqual(["description", "pages", "private", "title", "url"]);
  });

  it("set_site_info", async () => {
    expect(keys(await raw("set_site_info", { title: "T", description: "D" }))).toEqual([
      "description",
      "title",
    ]);
  });

  it("set_privacy, closing and reopening", async () => {
    const closed = await raw("set_privacy", { path: "/trip", private: true });
    expect(keys(closed)).toEqual(["closed", "next", "path", "private", "url"]);
    expect(keys(closed.closed)).toEqual(["assets", "collections", "pages"]);

    const opened = await raw("set_privacy", { path: "/trip", private: false });
    expect(keys(opened)).toEqual(["note", "path", "private", "revoked", "url"]);

    const already = await raw("set_privacy", { path: "/trip", private: false });
    expect(keys(already)).toEqual(["note", "path", "private"]);
  });

  it("share_path", async () => {
    expect(keys(await raw("share_path", { path: "/trip", label: "Dana" }))).toEqual([
      "created",
      "label",
      "link",
      "note",
      "path",
    ]);
  });

  it("list_shares, whole and for one path", async () => {
    await raw("share_path", { path: "/trip", label: "Dana" });

    const all = await raw("list_shares");
    expect(keys(all)).toEqual(["private"]);
    expect(keys(all.private[0])).toEqual(["path", "shares", "url"]);
    expect(keys(all.private[0].shares[0])).toEqual(["created", "label", "last_used"]);

    const covered = await raw("list_shares", { path: "/trip/items" });
    expect(keys(covered)).toEqual(["closed_by", "note", "path", "private"]);

    const public_ = await raw("list_shares", { path: "/elsewhere" });
    expect(keys(public_)).toEqual(["note", "path", "private"]);
  });

  it("revoke_share, with and without anything to revoke", async () => {
    await setPrivate("/trip");
    await raw("share_path", { path: "/trip", label: "Dana" });

    const gone = await raw("revoke_share", { path: "/trip", label: "Dana" });
    expect(keys(gone)).toEqual(["note", "path", "remaining", "revoked"]);

    const nothing = await raw("revoke_share", { path: "/trip", label: "Dana" });
    expect(keys(nothing)).toEqual(["note", "path", "revoked"]);
  });
});

describe("transfer results", () => {
  beforeEach(seed);

  // All twelve take the same arguments and answer in the same envelope. That is the point of one
  // engine at four levels, so it is pinned here rather than left to hold by habit.
  it("every verb at every level answers in one envelope", async () => {
    const calls: [string, Record<string, unknown>][] = [
      ["copy_page", { from: "/trip", to: "/trip-copy" }],
      ["move_page", { from: "/trip-copy", to: "/trip-moved" }],
      ["delete_page", { path: "/trip-moved" }],
      ["copy_collection", { from: "/trip/items", to: "/trip/items-copy" }],
      ["move_collection", { from: "/trip/items-copy", to: "/trip/items-moved" }],
      ["delete_collection", { path: "/trip/items-moved" }],
      ["copy_asset", { from: "/trip/coburg.jpg", to: "/trip/coburg2.jpg" }],
      ["move_asset", { from: "/trip/coburg2.jpg", to: "/trip/coburg3.jpg" }],
      ["delete_asset", { path: "/trip/coburg3.jpg" }],
      ["copy_bundle", { from: "/trip", to: "/trip-b", confirm: true }],
      ["move_bundle", { from: "/trip-b", to: "/trip-c", confirm: true }],
      ["delete_bundle", { path: "/trip-c", confirm: true }],
    ];

    for (const [name, args] of calls) {
      const r = await raw(name, args);
      const common = ["applied", "breaks", "from", "notes", "operation", "pages_to_update", "resources", "scope"];
      expect(keys(r).filter((k) => common.includes(k)), name).toEqual(common);
      expect(name.startsWith("delete_") ? !("to" in r) : "to" in r, name).toBe(true);
    }
  });

  it("names every resource it touched the same way", async () => {
    const r = await raw("copy_page", { from: "/trip", to: "/trip-copy" });
    expect(keys(r.resources[0])).toEqual(["from", "kind", "replaced", "title", "to", "url"]);
  });

  it("returns the inventory without applying when a bundle verb is unconfirmed", async () => {
    const r = await raw("delete_bundle", { path: "/trip" });
    expect(r.applied).toBe(false);
    expect(r.resources.length).toBeGreaterThan(0);
  });
});

describe("coverage of the registry", () => {
  // A tool added without a shape test would otherwise be published API nobody pinned.
  it("pins a result shape for every tool", () => {
    const pinned = new Set(
      [
        "list_pages", "get_page", "edit_page", "publish_page", "update_page",
        "upload_asset", "list_assets", "list_bundle",
        "list_collections", "list_items", "count_items", "get_item", "put_item", "delete_item",
        "reorder_items", "search_items", "match_names", "set_collection_refs", "check_refs",
        "get_site", "set_privacy", "share_path", "list_shares", "revoke_share", "set_site_info",
        "copy_page", "move_page", "delete_page",
        "copy_collection", "move_collection", "delete_collection",
        "copy_asset", "move_asset", "delete_asset",
        "copy_bundle", "move_bundle", "delete_bundle",
      ],
    );
    expect([...TOOLS.map((t) => t.name)].filter((n) => !pinned.has(n))).toEqual([]);
  });
});
