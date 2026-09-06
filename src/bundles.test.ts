import { beforeEach, describe, expect, it } from "vitest";
import { handleAsset } from "./assets/handler";
import { assetUrlFor, getAsset, listAssets } from "./assets/service";
import { completeSetup } from "./auth/setup";
import { handleData } from "./data/handler";
import { getCollection, saveCollection } from "./data/service";
import { TOOLS, type ToolContext } from "./mcp/tools";
import { handlePage } from "./pages/handler";
import { ROOT_BUNDLE } from "./pages/path";
import { getPage } from "./pages/service";
import { encodeKey, stores } from "./store";
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

// A page stored at / can no longer be written through savePage, so legacy state is seeded raw.
async function savePageDirect(path: string, body: string): Promise<void> {
  await stores.pages().setJSON(encodeKey(path), {
    path,
    contentType: "markdown",
    title: body.replace(/^#\s*/, ""),
    body,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

describe("a bundle holds everything at or under its path", () => {
  it("holds a collection directly under it", async () => {
    await saveCollection("/trip/items", [{ id: "one" }]);
    expect(await call("list_bundle", { path: "/trip" })).toContain("collection /trip/items");
  });

  it("holds what a deeper bundle holds", async () => {
    await saveCollection("/trip/day1/items", [{ id: "one" }]);
    expect(await call("list_bundle", { path: "/trip" })).toContain("collection /trip/day1/items");
    expect(await call("list_bundle", { path: "/trip/day1" })).toContain("collection /trip/day1/items");
  });

  it("holds pages, collections and assets alike", async () => {
    await page("/trip/day1");
    await saveCollection("/trip/items", [{ id: "one" }]);
    await upload("coburg.jpg", "/trip/images/coburg.jpg");

    const listed = await call("list_bundle", { path: "/trip" });
    expect(listed).toContain("page /trip/day1");
    expect(listed).toContain("collection /trip/items");
    expect(listed).toContain("asset /trip/images/coburg.jpg");
  });

  it("shows declared refs on a collection", async () => {
    await saveCollection("/trip/sections", [{ id: "day1" }]);
    await saveCollection("/trip/items", [{ id: "one", section: "day1" }]);
    await call("set_collection_refs", { path: "/trip/items", refs: { section: "/trip/sections" } });
    expect(await call("list_bundle", { path: "/trip" })).toContain("refs section->/trip/sections");
  });

  it("errors where nothing is published at all", async () => {
    await expect(call("list_bundle", { path: "/nope" })).rejects.toThrow(/Nothing is published at \/nope/);
  });

  it("succeeds for a bundle holding only its own page", async () => {
    await page("/hello");
    const reply = await call("list_bundle", { path: "/hello" });
    expect(reply).toContain("page /hello");
    expect(reply).toContain("Nothing else is in /hello yet.");
  });
});

// Section 4.1 of the spec: string-prefix matching is the likely implementation error, and in
// delete_bundle the same bug destroys a bundle nobody named.
describe("segment boundaries", () => {
  it("/bavaria does not hold /bavaria-lessons/lessons", async () => {
    await saveCollection("/bavaria/lessons", [{ id: "mine" }]);
    await saveCollection("/bavaria-lessons/lessons", [{ id: "theirs" }]);

    const listed = await call("list_bundle", { path: "/bavaria" });
    expect(listed).toContain("collection /bavaria/lessons");
    expect(listed).not.toContain("/bavaria-lessons/lessons");
  });

  it("/bavaria-lessons holds its own", async () => {
    await saveCollection("/bavaria/lessons", [{ id: "mine" }]);
    await saveCollection("/bavaria-lessons/lessons", [{ id: "theirs" }]);

    const listed = await call("list_bundle", { path: "/bavaria-lessons" });
    expect(listed).toContain("collection /bavaria-lessons/lessons");
    expect(listed).not.toContain("collection /bavaria/lessons");
  });

  it("/trip does not hold /tripwire/items", async () => {
    await saveCollection("/trip/items", [{ id: "mine" }]);
    await saveCollection("/tripwire/items", [{ id: "theirs" }]);
    expect(await call("list_bundle", { path: "/trip" })).not.toContain("/tripwire/items");
  });

  it("a bundle holds the resource sitting exactly at its path", async () => {
    await page("/trip");
    await saveCollection("/trip", [{ id: "one" }]);
    const listed = await call("list_bundle", { path: "/trip" });
    expect(listed).toContain("page /trip");
    expect(listed).toContain("collection /");
  });
});

describe("/ is not a bundle", () => {
  it("refuses to list it", async () => {
    await saveCollection("/trip/items", [{ id: "one" }]);
    await expect(call("list_bundle", { path: "/" })).rejects.toThrow(/not a bundle/);
  });

  it("refuses to delete it", async () => {
    await expect(call("delete_bundle", { path: "/", confirm: true })).rejects.toThrow(/not a bundle/);
  });

  it("still lets a page sit at /, unserved like any other resource", async () => {
    await page("/");
    expect(await getPage("/")).not.toBeNull();
  });

  it("still lets a collection sit at /", async () => {
    await saveCollection("/", [{ id: "a" }]);
    const response = await handleData(new Request("https://example.com/data/index.json"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: "a" }]);
  });
});

describe("the home page is a folder like any other", () => {
  const visit = (path: string) => handlePage(new Request(`https://example.com${path}`));

  it("serves the /root page at the site root", async () => {
    await call("publish_page", { path: "/root", content: "# Welcome home", overwrite: true });
    expect(await (await visit("/")).text()).toContain("Welcome home");
  });

  it("gives the home page one URL, not two", async () => {
    await call("publish_page", { path: "/root", content: "# Welcome home", overwrite: true });
    const response = await visit("/root");
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/");
  });

  it("never serves a page stored at /, only the one in /root", async () => {
    await savePageDirect("/", "# Old home");
    const body = await (await visit("/")).text();
    expect(body).not.toContain("Old home");

    await call("publish_page", { path: "/root", content: "# New home", overwrite: true });
    expect(await (await visit("/")).text()).toContain("New home");
  });

  it("holds its own collections like any other bundle", async () => {
    await call("publish_page", { path: "/root", content: "# Home", overwrite: true });
    await saveCollection("/root/links", [{ id: "a" }]);
    expect(await call("list_bundle", { path: "/root" })).toContain("collection /root/links");
  });

  it("is where setup puts the very first page", async () => {
    await completeSetup("a-long-enough-password");
    expect(await getPage(ROOT_BUNDLE)).not.toBeNull();
    expect(await (await visit("/")).text()).toContain("Welcome");
  });
});

describe("assets", () => {
  it("files a rooted asset into its bundle", async () => {
    const reply = await upload("coburg.jpg", "/germanfunstuff/images/coburg.jpg");
    expect(reply).toContain("https://example.com/assets/germanfunstuff/images/coburg.jpg");
    expect(reply).toContain("path /germanfunstuff/images/coburg.jpg");
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
    expect(await call("list_assets")).toContain("in no bundle");
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
  it("deletes one page and leaves the rest of the bundle", async () => {
    await page("/trip");
    await saveCollection("/trip/items", [{ id: "one" }, { id: "two" }]);
    await upload("coburg.jpg", "/trip/images/coburg.jpg");

    const reply = await call("delete_page", { path: "/trip" });
    expect(reply).toContain("collection /trip/items  2 items");
    expect(reply).toContain("asset /trip/images/coburg.jpg");
    expect((await getCollection("/trip/items"))?.items).toHaveLength(2);
  });

  it("leaves a nested page alone", async () => {
    await page("/trip");
    await page("/trip/day1");
    const reply = await call("delete_page", { path: "/trip" });
    expect(reply).toContain("page /trip/day1");
    expect(await getPage("/trip/day1")).not.toBeNull();
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

  it("refuses the reserved collection index", async () => {
    await expect(call("delete_bundle", { path: "/_collections" })).rejects.toThrow(/reserved/);
  });
});

describe("bundles are organization, never a boundary", () => {
  it("accepts a reference that crosses bundles", async () => {
    await saveCollection("/trip/items", [{ id: "one" }]);
    await saveCollection("/bavaria-lessons/meta", [{ id: "m1", trip: "one" }]);

    const reply = await call("set_collection_refs", {
      path: "/bavaria-lessons/meta",
      refs: { trip: "/trip/items" },
    });
    expect(reply).not.toContain("violation");
  });

  it("serves a collection whose bundle has no page", async () => {
    await saveCollection("/loose/items", [{ id: "one" }]);
    const response = await handleData(new Request("https://example.com/data/loose/items.json"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: "one" }]);
  });
});

describe("the site root with no home page", () => {
  it("lists the pages and says where a home page would go", async () => {
    await call("publish_page", { path: "/hello", content: "# Hello", overwrite: true });
    const body = await (await handlePage(new Request("https://example.com/"))).text();
    expect(body).toContain("/hello");
    expect(body).toContain("/root");
  });
});
