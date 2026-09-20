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

// Goes through the renderer, so every reply pinned in this file is still the text a client gets.
async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`No tool named ${name}`);
  return tool.render(await tool.handler(args, ctx));
}

async function json(name: string, args: Record<string, unknown> = {}): Promise<any> {
  return JSON.parse(await call(name, args));
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
    await upload("photo.jpg", "/trip/images/photo.jpg");

    const listed = await call("list_bundle", { path: "/trip" });
    expect(listed).toContain("page /trip/day1");
    expect(listed).toContain("collection /trip/items");
    expect(listed).toContain("asset /trip/images/photo.jpg");
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
  it("/photos does not hold /photos-archive/lessons", async () => {
    await saveCollection("/photos/lessons", [{ id: "mine" }]);
    await saveCollection("/photos-archive/lessons", [{ id: "theirs" }]);

    const listed = await call("list_bundle", { path: "/photos" });
    expect(listed).toContain("collection /photos/lessons");
    expect(listed).not.toContain("/photos-archive/lessons");
  });

  it("/photos-archive holds its own", async () => {
    await saveCollection("/photos/lessons", [{ id: "mine" }]);
    await saveCollection("/photos-archive/lessons", [{ id: "theirs" }]);

    const listed = await call("list_bundle", { path: "/photos-archive" });
    expect(listed).toContain("collection /photos-archive/lessons");
    expect(listed).not.toContain("collection /photos/lessons");
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

describe("the site root is the contents of the site", () => {
  const visit = (path: string) => handlePage(new Request(`https://example.com${path}`));

  it("lists every published page", async () => {
    await call("publish_page", { path: "/about", content: "# About us" });
    await call("publish_page", { path: "/trip/day1", content: "# Day one" });

    const body = await (await visit("/")).text();
    expect(body).toContain('href="/about"');
    expect(body).toContain("About us");
    expect(body).toContain('href="/trip/day1"');
  });

  it("says so when nothing is published", async () => {
    expect(await (await visit("/")).text()).toContain("Nothing is published yet");
  });

  it("is not a page, so nothing publishes one there", async () => {
    await expect(call("publish_page", { path: "/root", content: "# Home" })).rejects.toThrow(/site contents/);
    expect(await getPage(ROOT_BUNDLE)).toBeNull();
  });

  it("gives the site root one URL, not two", async () => {
    const response = await visit("/root");
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/");
  });

  it("never lists a page stored at / or /root, which nothing serves", async () => {
    await savePageDirect("/", "# Old home");
    await savePageDirect(ROOT_BUNDLE, "# Older home");

    const body = await (await visit("/")).text();
    expect(body).not.toContain("Old home");
    expect(body).not.toContain("Older home");
  });

  it("holds its own collections like any other bundle", async () => {
    await saveCollection("/root/links", [{ id: "a" }]);
    expect(await call("list_bundle", { path: "/root" })).toContain("collection /root/links");
  });

  it("is what a brand new site answers with, before anything is published", async () => {
    await completeSetup("a-long-enough-password");
    expect(await getPage(ROOT_BUNDLE)).toBeNull();
    expect((await visit("/")).status).toBe(200);
  });
});

describe("assets", () => {
  it("files a rooted asset into its bundle", async () => {
    const reply = await upload("photo.jpg", "/gallery/images/photo.jpg");
    expect(reply).toContain("https://example.com/assets/gallery/images/photo.jpg");
    expect(reply).toContain("path /gallery/images/photo.jpg");
  });

  it("addresses a rooted asset by its path, never by its blob key", async () => {
    await upload("photo.jpg", "/gallery/images/photo.jpg");
    const [asset] = await listAssets();
    expect(asset.key).toBe("gallery~images~photo.jpg");
    expect(assetUrlFor(asset)).toBe("/assets/gallery/images/photo.jpg");
  });

  it("serves a rooted asset at its path", async () => {
    await upload("photo.jpg", "/gallery/images/photo.jpg");
    const response = await handleAsset(
      new Request("https://example.com/assets/gallery/images/photo.jpg"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
  });

  it("keeps serving an asset uploaded before paths existed", async () => {
    const url = await upload("photo.png");
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
    await upload("photo.jpg", "/gallery/images/photo.jpg");
    expect((await json("delete_asset", { path: "/gallery/images/photo.jpg" })).applied).toBe(true);
    expect((await handleAsset(new Request("https://example.com/assets/gallery/images/photo.jpg"))).status).toBe(
      404,
    );
  });
});

describe("delete_page", () => {
  it("deletes one page and leaves the rest of the bundle", async () => {
    await page("/trip");
    await saveCollection("/trip/items", [{ id: "one" }, { id: "two" }]);
    await upload("photo.jpg", "/trip/images/photo.jpg");

    const reply = await json("delete_page", { path: "/trip" });
    expect(reply.resources).toEqual([{ kind: "page", from: "/trip", to: null, title: "/trip" }]);
    expect(reply.rest_of_bundle).toEqual([
      { kind: "collection", path: "/trip/items" },
      { kind: "asset", path: "/trip/images/photo.jpg" },
    ]);
    expect((await getCollection("/trip/items"))?.items).toHaveLength(2);
  });

  it("leaves a nested page alone", async () => {
    await page("/trip");
    await page("/trip/day1");
    const reply = await json("delete_page", { path: "/trip" });
    expect(reply.rest_of_bundle).toEqual([{ kind: "page", path: "/trip/day1" }]);
    expect(await getPage("/trip/day1")).not.toBeNull();
  });
});

describe("delete_bundle", () => {
  beforeEach(async () => {
    await page("/trip");
    await page("/trip/day1");
    await saveCollection("/trip/items", [{ id: "one" }]);
    await saveCollection("/trip/day1/items", [{ id: "two" }]);
    await upload("photo.jpg", "/trip/images/photo.jpg");
  });

  it("deletes nothing without confirm and shows what it would take", async () => {
    const reply = await json("delete_bundle", { path: "/trip" });
    expect(reply.applied).toBe(false);
    expect(reply.resources.map((r: any) => `${r.kind} ${r.from}`)).toEqual([
      "page /trip",
      "page /trip/day1",
      "collection /trip/day1/items",
      "collection /trip/items",
      "asset /trip/images/photo.jpg",
    ]);
    expect(reply.notes.join(" ")).toContain("Nothing was changed");
    expect(await getPage("/trip")).not.toBeNull();
  });

  it("removes the whole bundle when confirmed", async () => {
    await call("delete_bundle", { path: "/trip", confirm: true });
    expect(await getPage("/trip")).toBeNull();
    expect(await getPage("/trip/day1")).toBeNull();
    expect(await getCollection("/trip/items")).toBeNull();
    expect(await getCollection("/trip/day1/items")).toBeNull();
    expect((await handleAsset(new Request("https://example.com/assets/trip/images/photo.jpg"))).status).toBe(404);
  });

  it("spares a neighbour whose name merely starts the same", async () => {
    await saveCollection("/tripwire/items", [{ id: "safe" }]);
    await call("delete_bundle", { path: "/trip", confirm: true });
    expect(await getCollection("/tripwire/items")).not.toBeNull();
  });

  it("warns about records outside the bundle that point into it", async () => {
    await saveCollection("/notes/entries", [{ id: "n1", day: "two" }]);
    await call("set_collection_refs", { path: "/notes/entries", refs: { day: "/trip/day1/items" } });

    const reply = await json("delete_bundle", { path: "/trip" });
    expect(reply.breaks).toEqual([
      { path: "/notes/entries", field: "day", references: "/trip/day1/items", count: 1 },
    ]);
  });

  it("refuses the reserved collection index", async () => {
    await expect(call("delete_bundle", { path: "/_collections" })).rejects.toThrow(/reserved/);
  });
});

describe("bundles are organization, never a boundary", () => {
  it("accepts a reference that crosses bundles", async () => {
    await saveCollection("/trip/items", [{ id: "one" }]);
    await saveCollection("/photos-archive/meta", [{ id: "m1", trip: "one" }]);

    const reply = await call("set_collection_refs", {
      path: "/photos-archive/meta",
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

describe("the site root with nothing published", () => {
  it("is the contents page saying so, not a 404", async () => {
    const response = await handlePage(new Request("https://example.com/"));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Nothing is published yet");
  });
});
