import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleAsset } from "./assets/handler";
import { getAsset } from "./assets/service";
import { handleData } from "./data/handler";
import { getCollection, saveCollection } from "./data/service";
import { TOOLS, type ToolContext } from "./mcp/tools";
import { getPage, savePage } from "./pages/service";
import { encodeKey, stores } from "./store";
import { resetBlobs } from "./test/blobs";

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

function upload(filename: string, path: string): Promise<string> {
  return call("upload_asset", {
    filename,
    content_base64: btoa(`bytes for ${filename}`),
    content_type: "image/png",
    path,
  });
}

const NESTED = {
  id: "muc",
  name: "München",
  group: "food",
  section: "day-1",
  detail: { hours: { open: "09:00", close: "17:00" }, tags: ["bier", "brezn"] },
  stops: [{ at: "10:00", note: "Marienplatz" }, { at: "12:00", note: null }],
};

const BODY =
  '<!doctype html>\n<script>\nconst BASE = "/data/trip/";\nfetch(BASE + "items.json");\n' +
  '</script>\n<img src="/assets/trip/images/coburg.jpg">\n';

async function seedTrip(): Promise<void> {
  await savePage({ path: "/trip", contentType: "html", title: "Trip", body: BODY });
  await saveCollection("/trip/filters", [{ id: "food" }, { id: "sights" }]);
  await saveCollection("/trip/sections", [{ id: "day-1" }, { id: "day-2" }]);
  await saveCollection("/trip/items", [NESTED, { id: "nue", name: "Nürnberg", group: "sights", section: "day-2" }]);
  await call("set_collection_refs", {
    path: "/trip/items",
    refs: { group: "/trip/filters", section: "/trip/sections" },
  });
  await upload("coburg.jpg", "/trip/images/coburg.jpg");
}

describe("one shape for every level", () => {
  const names = ["page", "collection", "asset", "bundle"].flatMap((scope) =>
    ["copy", "move", "delete"].map((verb) => `${verb}_${scope}`),
  );

  it("exposes copy, move and delete at every level", () => {
    for (const name of names) expect(TOOLS.map((t) => t.name)).toContain(name);
  });

  it("asks for from and to on every copy and move, and path on every delete", () => {
    for (const name of names) {
      const required = (TOOLS.find((t) => t.name === name)!.inputSchema as any).required;
      expect(required, name).toEqual(name.startsWith("delete") ? ["path"] : ["from", "to"]);
    }
  });

  it("returns the same envelope from every one of them", async () => {
    await seedTrip();
    const replies = [
      await json("copy_page", { from: "/trip", to: "/a" }),
      await json("copy_collection", { from: "/trip/items", to: "/b/items" }),
      await json("copy_asset", { from: "/trip/images/coburg.jpg", to: "/c/coburg.jpg" }),
      await json("copy_bundle", { from: "/trip", to: "/d", confirm: true }),
      await json("delete_page", { path: "/a" }),
      await json("delete_collection", { path: "/b/items" }),
      await json("delete_asset", { path: "/c/coburg.jpg" }),
      await json("delete_bundle", { path: "/d", confirm: true }),
    ];
    for (const reply of replies)
      expect(Object.keys(reply)).toEqual(
        expect.arrayContaining(["operation", "scope", "from", "applied", "resources", "breaks", "pages_to_update", "notes"]),
      );
  });
});

describe("copy_collection", () => {
  it("keeps ids, order and nested values exactly and leaves the source alone", async () => {
    await seedTrip();
    const before = await getCollection("/trip/items");

    const reply = await json("copy_collection", { from: "/trip/items", to: "/gf/items" });
    expect(reply.resources).toEqual([
      {
        kind: "collection",
        from: "/trip/items",
        to: "/gf/items",
        url: "https://example.com/data/gf/items.json",
        replaced: false,
        items: 2,
        rev: 1,
        refs: { group: "/trip/filters", section: "/trip/sections" },
      },
    ]);

    const copy = await getCollection("/gf/items");
    expect(JSON.stringify(copy!.items)).toBe(JSON.stringify(before!.items));
    expect(JSON.stringify((await getCollection("/trip/items"))!.items)).toBe(JSON.stringify(before!.items));
  });

  it("survives a round trip out and back byte for byte", async () => {
    await seedTrip();
    const before = JSON.stringify((await getCollection("/trip/items"))!.items);

    await call("move_collection", { from: "/trip/items", to: "/gf/items" });
    await call("move_collection", { from: "/gf/items", to: "/trip/items" });

    expect(JSON.stringify((await getCollection("/trip/items"))!.items)).toBe(before);
    expect(await getCollection("/gf/items")).toBeNull();
  });

  it("leaves references alone when the collections they point at stay put", async () => {
    await seedTrip();
    const reply = await json("copy_collection", { from: "/trip/items", to: "/gf/items" });
    expect(reply.resources[0].refs).toEqual({ group: "/trip/filters", section: "/trip/sections" });
  });

  it("refuses an occupied target, then takes it with overwrite", async () => {
    await seedTrip();
    await saveCollection("/gf/items", [{ id: "keep" }]);

    await expect(call("copy_collection", { from: "/trip/items", to: "/gf/items" })).rejects.toThrow(
      /\/gf\/items already holds 1 item/,
    );
    expect((await getCollection("/gf/items"))!.items).toEqual([{ id: "keep" }]);

    const reply = await json("copy_collection", { from: "/trip/items", to: "/gf/items", overwrite: true });
    expect(reply.resources[0].replaced).toBe(true);
    expect((await getCollection("/gf/items"))!.items.map((i) => i.id)).toEqual(["muc", "nue"]);
  });

  it("refuses a move to the same path", async () => {
    await seedTrip();
    await expect(call("move_collection", { from: "/trip/items", to: "/Trip/Items.json" })).rejects.toThrow(
      /same path/,
    );
  });

  it("refuses a stale if_rev", async () => {
    await seedTrip();
    await expect(call("move_collection", { from: "/trip/items", to: "/gf/items", if_rev: 9 })).rejects.toThrow(
      /you have rev 9, it is now rev 1/,
    );
  });
});

describe("move_collection", () => {
  it("stops serving the old url and serves the new one", async () => {
    await seedTrip();
    await call("move_collection", { from: "/trip/items", to: "/gf/items" });

    expect((await handleData(new Request("https://example.com/data/trip/items.json"))).status).toBe(404);
    const served = await handleData(new Request("https://example.com/data/gf/items.json"));
    expect(served.status).toBe(200);
    expect((await served.json()).map((i: any) => i.id)).toEqual(["muc", "nue"]);
  });

  it("names the page line still holding the old url, and edits no page", async () => {
    await seedTrip();
    const before = await getPage("/trip");

    const reply = await json("move_collection", { from: "/trip/items", to: "/gf/items" });
    expect(reply.pages_to_update).toEqual([
      { path: "/trip", lines: [{ line: 3, text: 'const BASE = "/data/trip/";' }], more: 0 },
    ]);
    expect((await getPage("/trip"))!.body).toBe(before!.body);
  });

  it("reports references from outside that it just broke", async () => {
    await seedTrip();
    await saveCollection("/notes/entries", [{ id: "n1", day: "day-1" }]);
    await call("set_collection_refs", { path: "/notes/entries", refs: { day: "/trip/sections" } });

    const reply = await json("move_collection", { from: "/trip/sections", to: "/gf/sections" });
    expect(reply.breaks).toEqual([
      { path: "/notes/entries", field: "day", references: "/trip/sections", count: 1 },
      { path: "/trip/items", field: "section", references: "/trip/sections", count: 2 },
    ]);
  });
});

describe("pages", () => {
  it("copies a body verbatim", async () => {
    await seedTrip();
    await call("copy_page", { from: "/trip", to: "/gf" });
    expect((await getPage("/gf"))!.body).toBe(BODY);
    expect(await getPage("/trip")).not.toBeNull();
  });

  it("moves one page and leaves its data where it was", async () => {
    await seedTrip();
    const reply = await json("move_page", { from: "/trip", to: "/gf" });

    expect(await getPage("/trip")).toBeNull();
    expect((await getPage("/gf"))!.body).toBe(BODY);
    expect(await getCollection("/trip/items")).not.toBeNull();
    expect(reply.rest_of_bundle).toEqual([
      { kind: "collection", path: "/trip/filters" },
      { kind: "collection", path: "/trip/items" },
      { kind: "collection", path: "/trip/sections" },
      { kind: "asset", path: "/trip/images/coburg.jpg" },
    ]);
  });
});

describe("assets", () => {
  it("moves a file, keeping its bytes and dropping the old url", async () => {
    await seedTrip();
    const before = await handleAsset(new Request("https://example.com/assets/trip/images/coburg.jpg"));
    const bytes = await before.text();

    const reply = await json("move_asset", { from: "/trip/images/coburg.jpg", to: "/gf/pics/coburg.jpg" });
    expect(reply.resources[0].url).toBe("https://example.com/assets/gf/pics/coburg.jpg");

    expect((await handleAsset(new Request("https://example.com/assets/trip/images/coburg.jpg"))).status).toBe(404);
    const after = await handleAsset(new Request("https://example.com/assets/gf/pics/coburg.jpg"));
    expect(after.status).toBe(200);
    expect(await after.text()).toBe(bytes);
  });

  it("copies a file and leaves the original", async () => {
    await seedTrip();
    await call("copy_asset", { from: "/trip/images/coburg.jpg", to: "/gf/coburg.jpg" });
    expect((await handleAsset(new Request("https://example.com/assets/trip/images/coburg.jpg"))).status).toBe(200);
    expect((await handleAsset(new Request("https://example.com/assets/gf/coburg.jpg"))).status).toBe(200);
  });

  it("refuses to move one stored under a content hash, and still deletes it by key", async () => {
    const url = await call("upload_asset", {
      filename: "old.png",
      content_base64: btoa("legacy"),
      content_type: "image/png",
    });
    const key = url.split("/assets/")[1];

    await expect(call("move_asset", { from: `/${key}`, to: "/gf/old.png" })).rejects.toThrow(
      /stored under a content hash/,
    );
    expect((await json("delete_asset", { path: `/${key}` })).applied).toBe(true);
    expect(await getAsset(key)).toBeNull();
  });
});

describe("bundles", () => {
  it("moves nothing without confirm and lists what it would move", async () => {
    await seedTrip();
    const reply = await json("move_bundle", { from: "/trip", to: "/gf" });

    expect(reply.applied).toBe(false);
    expect(reply.resources.map((r: any) => `${r.kind} ${r.from} -> ${r.to}`)).toEqual([
      "page /trip -> /gf",
      "collection /trip/filters -> /gf/filters",
      "collection /trip/items -> /gf/items",
      "collection /trip/sections -> /gf/sections",
      "asset /trip/images/coburg.jpg -> /gf/images/coburg.jpg",
    ]);
    expect(await getPage("/trip")).not.toBeNull();
    expect(await getCollection("/trip/items")).not.toBeNull();
  });

  it("moves the page, its collections and its assets together and rewrites refs inside it", async () => {
    await seedTrip();
    const reply = await json("move_bundle", { from: "/trip", to: "/gf", confirm: true });

    expect(reply.applied).toBe(true);
    const items = reply.resources.find((r: any) => r.to === "/gf/items");
    expect(items.refs).toEqual({ group: "/gf/filters", section: "/gf/sections" });

    expect(await getPage("/trip")).toBeNull();
    expect((await getPage("/gf"))!.body).toBe(BODY);
    expect((await getCollection("/gf/items"))!.items.map((i) => i.id)).toEqual(["muc", "nue"]);
    expect((await handleAsset(new Request("https://example.com/assets/gf/images/coburg.jpg"))).status).toBe(200);
    expect((await handleData(new Request("https://example.com/data/trip/items.json"))).status).toBe(404);
  });

  it("names the moved page's own stale urls", async () => {
    await seedTrip();
    const reply = await json("move_bundle", { from: "/trip", to: "/gf", confirm: true });
    expect(reply.pages_to_update).toEqual([
      {
        path: "/gf",
        lines: [
          { line: 3, text: 'const BASE = "/data/trip/";' },
          { line: 6, text: '<img src="/assets/trip/images/coburg.jpg">' },
        ],
        more: 0,
      },
    ]);
  });

  it("spares a neighbour whose name merely starts the same", async () => {
    await seedTrip();
    await saveCollection("/tripwire/items", [{ id: "safe" }]);
    await call("move_bundle", { from: "/trip", to: "/gf", confirm: true });
    expect(await getCollection("/tripwire/items")).not.toBeNull();
  });

  it("refuses a target nested inside its own source", async () => {
    await seedTrip();
    await expect(call("move_bundle", { from: "/trip", to: "/trip/inner", confirm: true })).rejects.toThrow(
      /nested inside/,
    );
  });

  it("refuses / at either end, because it is not a bundle", async () => {
    await seedTrip();
    await expect(call("copy_bundle", { from: "/", to: "/gf", confirm: true })).rejects.toThrow(/not a bundle/);
    await expect(call("move_bundle", { from: "/trip", to: "/", confirm: true })).rejects.toThrow(/not a bundle/);
  });
});

describe("atomicity", () => {
  it("leaves nothing at the target when a write fails partway", async () => {
    await seedTrip();

    const real = stores.data();
    const spy = vi.spyOn(stores, "data").mockReturnValue({
      ...real,
      setJSON: async (key: string, value: unknown) => {
        if (key === encodeKey("/gf/sections")) throw new Error("blob write failed");
        return real.setJSON(key, value);
      },
    } as unknown as ReturnType<typeof stores.data>);

    await expect(call("move_bundle", { from: "/trip", to: "/gf", confirm: true })).rejects.toThrow(
      /rolled back: blob write failed/,
    );
    spy.mockRestore();

    for (const path of ["/gf/items", "/gf/filters", "/gf/sections"]) expect(await getCollection(path)).toBeNull();
    expect(await getPage("/gf")).toBeNull();
    expect((await getCollection("/trip/items"))!.items).toHaveLength(2);
    expect(await getPage("/trip")).not.toBeNull();
  });

  it("puts the sources back when a delete fails partway", async () => {
    await seedTrip();

    const real = stores.data();
    const spy = vi.spyOn(stores, "data").mockReturnValue({
      ...real,
      delete: async (key: string) => {
        if (key === encodeKey("/trip/sections")) throw new Error("blob delete failed");
        return real.delete(key);
      },
    } as unknown as ReturnType<typeof stores.data>);

    await expect(call("move_bundle", { from: "/trip", to: "/gf", confirm: true })).rejects.toThrow(/rolled back/);
    spy.mockRestore();

    for (const path of ["/trip/items", "/trip/filters", "/trip/sections"])
      expect(await getCollection(path)).not.toBeNull();
    for (const path of ["/gf/items", "/gf/filters", "/gf/sections"]) expect(await getCollection(path)).toBeNull();
    expect(await getPage("/gf")).toBeNull();
  });
});

describe("the home page bundle", () => {
  it("says so when the page served at / is taken away", async () => {
    await savePage({ path: "/root", contentType: "markdown", title: "Home", body: "# Home" });

    const moved = await json("move_page", { from: "/root", to: "/archive/home" });
    expect(moved.notes.join(" ")).toContain("the site root now has no home page");

    const deleted = await json("delete_page", { path: "/archive/home" });
    expect(deleted.notes.join(" ")).not.toContain("the site root now has no home page");
  });

  it("gives the home page its served url, not its stored path", async () => {
    await savePage({ path: "/archive/home", contentType: "markdown", title: "Home", body: "# Home" });
    const reply = await json("move_page", { from: "/archive/home", to: "/root" });
    expect(reply.resources[0].url).toBe("https://example.com");
  });
});
