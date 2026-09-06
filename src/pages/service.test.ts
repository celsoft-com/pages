import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeKey, stores } from "../store";
import { resetBlobs } from "../test/blobs";
import { listPages, savePage } from "./service";

beforeEach(resetBlobs);

function markdown(path: string, title: string) {
  return savePage({ path, contentType: "markdown", title, body: `# ${title}` });
}

describe("page summaries", () => {
  it("ride along with the blob, written in the same call", async () => {
    await markdown("/hello", "Hello");
    const found = await stores.pages().getMetadata(encodeKey("/hello"));

    expect(found!.metadata).toMatchObject({ path: "/hello", title: "Hello", contentType: "markdown" });
  });

  it("answer listPages without reading the bodies", async () => {
    await markdown("/hello", "Hello");
    await markdown("/hi", "Hi");

    const real = stores.pages();
    const spy = vi.spyOn(stores, "pages").mockReturnValue({
      ...real,
      get: async () => {
        throw new Error("a page body was read to build a summary");
      },
    } as unknown as ReturnType<typeof stores.pages>);

    expect(await listPages()).toEqual([
      { path: "/hello", title: "Hello", contentType: "markdown", updatedAt: expect.any(Number) },
      { path: "/hi", title: "Hi", contentType: "markdown", updatedAt: expect.any(Number) },
    ]);
    spy.mockRestore();
  });

  // The summary is a cache in front of the blob, so every miss has to end at the blob.
  it("are ignored when written under an older shape", async () => {
    await stores.pages().setJSON(
      encodeKey("/hello"),
      { path: "/hello", contentType: "markdown", title: "Hello", body: "# Hello", createdAt: 1, updatedAt: 1 },
      { metadata: { v: 0, path: "/hello", contentType: "markdown", title: "Stale", updatedAt: 1 } },
    );

    expect(await listPages()).toEqual([
      { path: "/hello", title: "Hello", contentType: "markdown", updatedAt: 1 },
    ]);
  });

  it("are derived from the blob when a page was stored before summaries existed", async () => {
    await stores.pages().setJSON(encodeKey("/hello"), {
      path: "/hello",
      contentType: "html",
      title: "Hello",
      body: "<h1>Hello</h1>",
      createdAt: 1,
      updatedAt: 2,
    });

    expect(await listPages()).toEqual([{ path: "/hello", title: "Hello", contentType: "html", updatedAt: 2 }]);
  });

  // A title is whatever an h1 says, so it can be longer than the 2 KB metadata cap. Losing the
  // summary costs a read; failing the write would lose the page.
  it("are skipped rather than failing the save when the title will not fit", async () => {
    const title = "x".repeat(4000);
    await savePage({ path: "/hello", contentType: "markdown", title, body: "# long" });

    const found = await stores.pages().getMetadata(encodeKey("/hello"));
    expect(found!.metadata).toEqual({});
    expect(await listPages()).toEqual([
      { path: "/hello", title, contentType: "markdown", updatedAt: expect.any(Number) },
    ]);
  });

  it("drop a key whose blob is no longer there", async () => {
    await markdown("/hello", "Hello");

    const real = stores.pages();
    const spy = vi.spyOn(stores, "pages").mockReturnValue({
      ...real,
      getMetadata: async () => null,
      get: async () => null,
    } as unknown as ReturnType<typeof stores.pages>);

    expect(await listPages()).toEqual([]);
    spy.mockRestore();
  });
});
