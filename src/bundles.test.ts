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

// The owner as the tools actually report it, read back out of list_collections' text so the
// matrix below tests the shipped surface rather than the rule in isolation.
async function ownerReported(collectionPath: string): Promise<string | null> {
  const line = (await call("list_collections"))
    .split("\n")
    .find((row) => row.startsWith(`${collectionPath}  `));
  if (line === undefined) throw new Error(`No collection listed at ${collectionPath}`);
  const match = line.match(/ {2}owner (\/\S*)/);
  return match ? match[1] : null;
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

    expect(await call("list_collections")).toContain("  ungrouped");
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
    expect(await call("list_collections")).toContain("  ungrouped");
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
    expect(listed).toContain("Publish a page at /bavaria to own these 1:");
  });

  it("does not promise a page would rescue a hash-keyed asset", async () => {
    await upload("coburg.png");
    const listed = await call("list_ungrouped");
    expect(listed).toContain("stored under a content hash");
    expect(listed).not.toContain("Publish a page at");
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
    expect(await call("list_assets")).toContain("  ungrouped");
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
    expect(reply).toContain("collection /trip/items  2 items  ungrouped");
    expect(reply).toContain("asset /trip/images/coburg.jpg  ungrouped");
    expect((await getCollection("/trip/items"))?.items).toHaveLength(2);
  });

  it("rolls a nested page's resources up rather than orphaning them", async () => {
    await page("/trip");
    await page("/trip/day1");
    await saveCollection("/trip/day1/items", [{ id: "one" }]);

    expect(await call("delete_page", { path: "/trip/day1" })).toContain(
      "collection /trip/day1/items  1 items  owner /trip",
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

// Mirrors section 8 of the refinements spec: the segment-boundary matrix, stated as tests
// rather than as checks against a live site.
describe("segment-boundary matrix", () => {
  it("page /bavaria does not own /bavaria-lessons/lessons", async () => {
    await page("/bavaria");
    await saveCollection("/bavaria-lessons/lessons", [{ id: "one" }]);
    expect(await ownerReported("/bavaria-lessons/lessons")).toBeNull();
  });

  it("page /bavaria owns /bavaria/lessons", async () => {
    await page("/bavaria");
    await saveCollection("/bavaria/lessons", [{ id: "one" }]);
    expect(await ownerReported("/bavaria/lessons")).toBe("/bavaria");
  });

  it("with both pages present neither claims the other's collection", async () => {
    await page("/bavaria");
    await page("/bavaria-lessons");
    await saveCollection("/bavaria/lessons", [{ id: "one" }]);
    await saveCollection("/bavaria-lessons/lessons", [{ id: "two" }]);

    expect(await ownerReported("/bavaria/lessons")).toBe("/bavaria");
    expect(await ownerReported("/bavaria-lessons/lessons")).toBe("/bavaria-lessons");
  });

  it("page /trip does not own /tripwire/items", async () => {
    await page("/trip");
    await saveCollection("/tripwire/items", [{ id: "one" }]);
    expect(await ownerReported("/tripwire/items")).toBeNull();
  });

  it("page / owns no collection", async () => {
    await page("/");
    await saveCollection("/anything/at/all", [{ id: "one" }]);
    expect(await ownerReported("/anything/at/all")).toBeNull();
  });

  it("the deeper of two nested pages wins", async () => {
    await page("/trip");
    await page("/trip/day1");
    await saveCollection("/trip/day1/items", [{ id: "one" }]);
    expect(await ownerReported("/trip/day1/items")).toBe("/trip/day1");
  });

  it("a collection whose path equals a page path is owned by that page", async () => {
    await page("/trip");
    await saveCollection("/trip", [{ id: "one" }]);
    expect(await ownerReported("/trip")).toBe("/trip");
  });
});

describe("the absence marker never sits where a page path goes", () => {
  it("keeps a page at /ungrouped distinct from having no owner", async () => {
    await page("/ungrouped");
    await saveCollection("/ungrouped/items", [{ id: "one" }]);
    await saveCollection("/loose/items", [{ id: "two" }]);

    const listed = await call("list_collections");
    expect(listed).toContain("owner /ungrouped");
    expect(listed).not.toContain("owner ungrouped");
    expect(await ownerReported("/ungrouped/items")).toBe("/ungrouped");
    expect(await ownerReported("/loose/items")).toBeNull();
  });

  it("reports null rather than a word on the served index", async () => {
    await saveCollection("/loose/items", [{ id: "one" }]);
    const body = await (await handleData(new Request("https://example.com/data/_collections.json"))).json();
    expect(body).toEqual([expect.objectContaining({ owner: null })]);
  });

  it("says ungrouped nowhere in an owner position", async () => {
    await page("/trip");
    await saveCollection("/trip/items", [{ id: "one" }]);
    await saveCollection("/loose/items", [{ id: "two" }]);
    await upload("coburg.png");

    for (const reply of [
      await call("list_collections"),
      await call("list_assets"),
      await call("list_bundle", { path: "/trip" }),
      await call("delete_page", { path: "/trip" }),
    ])
      expect(reply).not.toContain("owner ungrouped");
  });
});

describe("list_bundle edges", () => {
  it("errors where nothing is published at all", async () => {
    await expect(call("list_bundle", { path: "/nope" })).rejects.toThrow(/Nothing is published at \/nope/);
  });

  it("succeeds for a page that owns nothing, and says so", async () => {
    await page("/hello");
    const reply = await call("list_bundle", { path: "/hello" });
    expect(reply).toContain("page /hello");
    expect(reply).toContain("/hello owns no collections or assets yet.");
  });

  it("lists a path that has resources but no page", async () => {
    await saveCollection("/trip/items", [{ id: "one" }]);
    const reply = await call("list_bundle", { path: "/trip" });
    expect(reply).toContain("No page is published at /trip");
    expect(reply).toContain("collection /trip/items");
  });

  it("shows declared refs on a collection", async () => {
    await page("/trip");
    await saveCollection("/trip/sections", [{ id: "day1" }]);
    await saveCollection("/trip/items", [{ id: "one", section: "day1" }]);
    await call("set_collection_refs", { path: "/trip/items", refs: { section: "/trip/sections" } });

    expect(await call("list_bundle", { path: "/trip" })).toContain("refs section->/trip/sections");
  });

  it("says plainly that the root page owns nothing", async () => {
    await page("/");
    await saveCollection("/loose/items", [{ id: "one" }]);
    expect(await call("list_bundle", { path: "/" })).toContain("A page at / owns nothing by rule");
  });
});

describe("list_ungrouped groups by the fix", () => {
  it("gathers everything one page would rescue", async () => {
    await saveCollection("/trip/sections", [{ id: "a" }]);
    await saveCollection("/trip/filters", [{ id: "b" }]);
    await saveCollection("/trip/items", [{ id: "c" }]);
    await saveCollection("/bavaria/lessons", [{ id: "d" }]);

    const listed = await call("list_ungrouped");
    expect(listed).toContain("Publish a page at /bavaria to own these 1:");
    expect(listed).toContain("Publish a page at /trip to own these 3:");
    expect(listed.indexOf("/bavaria")).toBeLessThan(listed.indexOf("Publish a page at /trip"));
  });

  it("gathers a rooted asset alongside the collections it belongs with", async () => {
    await saveCollection("/trip/items", [{ id: "a" }]);
    await upload("coburg.jpg", "/trip/images/coburg.jpg");
    expect(await call("list_ungrouped")).toContain("Publish a page at /trip to own these 2:");
  });
});
