import { beforeEach, describe, expect, it } from "vitest";
import { handleAsset } from "./assets/handler";
import { assetUrlFor, getAsset, listAssets } from "./assets/service";
import { handleData } from "./data/handler";
import { getCollection, saveCollection } from "./data/service";
import { TOOLS, type ToolContext } from "./mcp/tools";
import { getPage } from "./pages/service";
import { resetBlobs } from "./test/blobs";

const ctx: ToolContext = { siteUrl: "https://example.com" };

beforeEach(resetBlobs);

function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`No tool named ${name}`);
  return tool.handler(args, ctx);
}

function page(path: string): Promise<string> {
  return call("publish_page", { path, content: `# ${path}`, overwrite: true });
}

function upload(filename: string, path?: string): Promise<string> {
  return call("upload_asset", {
    filename,
    content_base64: btoa(`bytes for ${filename}`),
    content_type: "image/png",
    ...(path === undefined ? {} : { path }),
  });
}

describe("ownership through the tools", () => {
  it("does not credit a page whose name merely starts the path", async () => {
    await page("/bavaria");
    await saveCollection("/bavaria-lessons/lessons", [{ id: "one" }]);

    expect(await call("list_collections")).toContain("owner ungrouped");
  });

  it("credits the page that really is above it", async () => {
    await page("/bavaria");
    await page("/bavaria-lessons");
    await saveCollection("/bavaria-lessons/lessons", [{ id: "one" }]);

    expect(await call("list_collections")).toContain("owner /bavaria-lessons");
  });

  it("gives the root page nothing", async () => {
    await page("/");
    await saveCollection("/trip/items", [{ id: "one" }]);
    expect(await call("list_collections")).toContain("owner ungrouped");
  });

  it("hands a resource to the deepest page above it", async () => {
    await page("/trip");
    await page("/trip/day1");
    await saveCollection("/trip/day1/items", [{ id: "one" }]);
    expect(await call("list_collections")).toContain("owner /trip/day1");
  });

  it("still lists a deeply owned resource in the bundle above it", async () => {
    await page("/trip");
    await page("/trip/day1");
    await saveCollection("/trip/day1/items", [{ id: "one" }]);

    const bundle = await call("list_bundle", { path: "/trip" });
    expect(bundle).toContain("collection /trip/day1/items");
    expect(bundle).toContain("owner /trip/day1");
    expect(bundle).toContain("page /trip/day1");
  });

  it("keeps one page's bundle clear of another's", async () => {
    await page("/germanfunstuff");
    await page("/bavaria-lessons");
    await saveCollection("/germanfunstuff/items", [{ id: "one" }]);
    await saveCollection("/bavaria-lessons/meta", [{ id: "two" }]);

    const bundle = await call("list_bundle", { path: "/germanfunstuff" });
    expect(bundle).toContain("/germanfunstuff/items");
    expect(bundle).not.toContain("/bavaria-lessons");
  });

  it("reports the served index with an owner", async () => {
    await page("/trip");
    await saveCollection("/trip/items", [{ id: "one" }]);
    const body = await (await handleData(new Request("https://example.com/data/_collections.json"))).json();
    expect(body).toEqual([expect.objectContaining({ path: "/trip/items", owner: "/trip" })]);
  });
});

describe("ungrouped listing", () => {
  it("names what would own each loose collection", async () => {
    await saveCollection("/bavaria/lessons", [{ id: "one" }]);
    const listed = await call("list_ungrouped");
    expect(listed).toContain("/bavaria/lessons");
    expect(listed).toContain("would be owned by /bavaria");
  });

  it("does not promise a page would rescue a hash-keyed asset", async () => {
    await upload("coburg.png");
    const listed = await call("list_ungrouped");
    expect(listed).toContain("stored under a content hash");
    expect(listed).not.toContain("would be owned by");
  });

  it("says so plainly when everything is grouped", async () => {
    await page("/trip");
    await saveCollection("/trip/items", [{ id: "one" }]);
    expect(await call("list_ungrouped")).toBe("Every collection and asset on this site is under a page.");
  });
});

describe("assets", () => {
  it("groups a rooted asset under its page", async () => {
    await page("/germanfunstuff");
    const reply = await upload("coburg.jpg", "/germanfunstuff/images/coburg.jpg");
    expect(reply).toContain("https://example.com/assets/germanfunstuff/images/coburg.jpg");
    expect(reply).toContain("owner /germanfunstuff");
  });

  it("addresses a rooted asset by its path, never by its blob key", async () => {
    await upload("coburg.jpg", "/germanfunstuff/images/coburg.jpg");
    const [asset] = await listAssets();
    expect(asset.key).toBe("germanfunstuff~images~coburg.jpg");
    expect(assetUrlFor(asset)).toBe("/assets/germanfunstuff/images/coburg.jpg");
  });

  it("serves a rooted asset at its path", async () => {
    await upload("coburg.jpg", "/germanfunstuff/images/coburg.jpg");
    const response = await handleAsset(
      new Request("https://example.com/assets/germanfunstuff/images/coburg.jpg"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
  });

  it("keeps serving an asset uploaded before paths existed", async () => {
    const url = await upload("coburg.png");
    const key = url.split("/assets/")[1];
    expect(key).toMatch(/^[0-9a-f]{32}\.png$/);
    expect((await handleAsset(new Request(`https://example.com/assets/${key}`))).status).toBe(200);
    expect(await call("list_assets")).toContain("owner ungrouped");
  });

  it("keeps an asset filename whole where the page normalizer would eat it", async () => {
    await upload("index.html", "/docs/index.html");
    await upload("notes.md", "/docs/notes.md");
    expect(await getAsset("docs~index.html")).not.toBeNull();
    expect(await getAsset("docs~notes.md")).not.toBeNull();
  });

  it("deletes a rooted asset by its path", async () => {
    await upload("coburg.jpg", "/germanfunstuff/images/coburg.jpg");
    expect(await call("delete_asset", { key: "/germanfunstuff/images/coburg.jpg" })).toContain("Deleted");
    expect((await handleAsset(new Request("https://example.com/assets/germanfunstuff/images/coburg.jpg"))).status).toBe(
      404,
    );
  });
});

describe("delete_page", () => {
  it("leaves everything under the path intact and names it", async () => {
    await page("/trip");
    await saveCollection("/trip/items", [{ id: "one" }, { id: "two" }]);
    await upload("coburg.jpg", "/trip/images/coburg.jpg");

    const reply = await call("delete_page", { path: "/trip" });
    expect(reply).toContain("collection /trip/items  2 items  now ungrouped");
    expect(reply).toContain("asset /trip/images/coburg.jpg  now ungrouped");
    expect((await getCollection("/trip/items"))?.items).toHaveLength(2);
  });

  it("rolls a nested page's resources up rather than orphaning them", async () => {
    await page("/trip");
    await page("/trip/day1");
    await saveCollection("/trip/day1/items", [{ id: "one" }]);

    expect(await call("delete_page", { path: "/trip/day1" })).toContain(
      "collection /trip/day1/items  1 items  now /trip",
    );
  });
});

describe("delete_bundle", () => {
  beforeEach(async () => {
    await page("/trip");
    await page("/trip/day1");
    await saveCollection("/trip/items", [{ id: "one" }]);
    await saveCollection("/trip/day1/items", [{ id: "two" }]);
    await upload("coburg.jpg", "/trip/images/coburg.jpg");
  });

  it("deletes nothing without confirm and shows what it would take", async () => {
    const reply = await call("delete_bundle", { path: "/trip" });
    expect(reply).toContain("Would delete");
    expect(reply).toContain("page /trip");
    expect(reply).toContain("collection /trip/day1/items");
    expect(reply).toContain("asset /trip/images/coburg.jpg");
    expect(reply).toContain("Nothing was deleted");
    expect(await getPage("/trip")).not.toBeNull();
    expect(await getCollection("/trip/items")).not.toBeNull();
  });

  it("removes the whole bundle when confirmed", async () => {
    await call("delete_bundle", { path: "/trip", confirm: true });
    expect(await getPage("/trip")).toBeNull();
    expect(await getPage("/trip/day1")).toBeNull();
    expect(await getCollection("/trip/items")).toBeNull();
    expect(await getCollection("/trip/day1/items")).toBeNull();
    expect((await handleAsset(new Request("https://example.com/assets/trip/images/coburg.jpg"))).status).toBe(404);
  });

  it("spares a neighbour whose name merely starts the same", async () => {
    await saveCollection("/tripwire/items", [{ id: "safe" }]);
    await call("delete_bundle", { path: "/trip", confirm: true });
    expect(await getCollection("/tripwire/items")).not.toBeNull();
  });

  it("warns about records outside the bundle that point into it", async () => {
    await saveCollection("/notes/entries", [{ id: "n1", day: "two" }]);
    await call("set_collection_refs", { path: "/notes/entries", refs: { day: "/trip/day1/items" } });

    const reply = await call("delete_bundle", { path: "/trip" });
    expect(reply).toContain("WARNING");
    expect(reply).toContain("1 in /notes/entries via day -> /trip/day1/items");
  });

  it("refuses the whole site", async () => {
    await expect(call("delete_bundle", { path: "/", confirm: true })).rejects.toThrow(/Refusing to delete/);
  });

  it("refuses the reserved collection index", async () => {
    await expect(call("delete_bundle", { path: "/_collections" })).rejects.toThrow(/reserved/);
  });
});

describe("grouping is never a boundary", () => {
  it("accepts a reference that crosses bundles", async () => {
    await page("/trip");
    await page("/bavaria-lessons");
    await saveCollection("/trip/items", [{ id: "one" }]);
    await saveCollection("/bavaria-lessons/meta", [{ id: "m1", trip: "one" }]);

    const reply = await call("set_collection_refs", {
      path: "/bavaria-lessons/meta",
      refs: { trip: "/trip/items" },
    });
    expect(reply).not.toContain("violation");
  });

  it("still serves an ungrouped collection", async () => {
    await saveCollection("/loose/items", [{ id: "one" }]);
    const response = await handleData(new Request("https://example.com/data/loose/items.json"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: "one" }]);
  });
});
