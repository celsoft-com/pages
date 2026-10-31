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

async function refusal(call: Promise<unknown>): Promise<string | null> {
  return call.then(
    () => null,
    (error) => `${(error as { status: number }).status} ${(error as Error).message}`,
  );
}

const call = (name: string, input: Record<string, unknown>) => t.as(owner).call(name, input) as Promise<any>;

describe("publish_page", () => {
  it("stores the page and derives its title and format", async () => {
    const page = await call("publish_page", { path: "/About", content: "# About us\n\nHello." });
    expect(page).toMatchObject({ path: "/about", title: "About us", format: "markdown", meta: {} });
    expect(page.url).toMatch(/\/p\/about$/);
    expect(await call("get_page", { path: "/about" })).toMatchObject({
      content: "# About us\n\nHello.",
      has_draft: false,
    });
  });

  it("detects a full HTML document", async () => {
    const page = await call("publish_page", { path: "/raw", content: "<!doctype html><title>Raw</title>" });
    expect(page).toMatchObject({ format: "html", title: "Raw" });
  });

  it("serves /root at the site's own address", async () => {
    const page = await call("publish_page", { path: "/root", content: "# Home" });
    expect(page.url.endsWith("/p/root")).toBe(false);
  });

  it("refuses a taken path unless told to overwrite", async () => {
    await call("publish_page", { path: "/a", content: "one" });
    expect(await refusal(call("publish_page", { path: "/a", content: "two" }))).toMatch(
      /^400 A page already exists at \/a/,
    );
    await call("publish_page", { path: "/a", content: "two", overwrite: true });
    expect(await call("get_page", { path: "/a" })).toMatchObject({ content: "two" });
  });

  it("refuses / and meta that names a page field", async () => {
    expect(await refusal(call("publish_page", { path: "/", content: "x" }))).toMatch(
      /^400 The home page is stored at \/root/,
    );
    expect(await refusal(call("publish_page", { path: "/a", content: "x", meta: { title: "no" } }))).toMatch(
      /^400 .*meta cannot hold "title"/,
    );
  });
});

describe("list_pages", () => {
  it("lists summaries in path order", async () => {
    await call("publish_page", { path: "/b", content: "# B", meta: { kind: "post" } });
    await call("publish_page", { path: "/a", content: "# A" });
    const { pages } = await call("list_pages", {});
    expect(pages.map((p: { path: string }) => p.path)).toEqual(["/a", "/b"]);
    expect(pages[1]).toMatchObject({ title: "B", meta: { kind: "post" }, has_draft: false });
  });
});

describe("get_page", () => {
  it("returns numbered lines when narrowed", async () => {
    await call("publish_page", { path: "/a", content: "one\ntwo\nthree" });
    expect(await call("get_page", { path: "/a", find: "TWO" })).toMatchObject({
      total: 3,
      more: 0,
      lines: [{ line: 2, text: "two" }],
    });
    expect(await call("get_page", { path: "/a", offset: 2, limit: 1 })).toMatchObject({
      lines: [{ line: 2, text: "two" }],
    });
  });

  it("refuses a missing page and a missing working copy", async () => {
    expect(await refusal(call("get_page", { path: "/nope" }))).toMatch(/^400 No page exists at \/nope/);
    await call("publish_page", { path: "/a", content: "one" });
    expect(await refusal(call("get_page", { path: "/a", draft: true }))).toMatch(/^400 \/a has no working copy/);
  });
});

describe("edit_page", () => {
  it("replaces one exact snippet and reports its line", async () => {
    await call("publish_page", { path: "/a", content: "one\ntwo\nthree" });
    expect(await call("edit_page", { path: "/a", find: "two", replace: "2" })).toMatchObject({
      replaced: 1,
      lines: [2],
    });
    expect(await call("get_page", { path: "/a" })).toMatchObject({ content: "one\n2\nthree" });
  });

  it("refuses no match and an ambiguous one, unless all", async () => {
    await call("publish_page", { path: "/a", content: "x x" });
    expect(await refusal(call("edit_page", { path: "/a", find: "y", replace: "z" }))).toMatch(
      /^400 Nothing in \/a matches that text/,
    );
    expect(await refusal(call("edit_page", { path: "/a", find: "x", replace: "z" }))).toMatch(
      /^400 .*appears 2 times in \/a/,
    );
    expect(await call("edit_page", { path: "/a", find: "x", replace: "z", all: true })).toMatchObject({ replaced: 2 });
  });
});

describe("working copy", () => {
  it("keeps readers on the live page until published", async () => {
    await call("publish_page", { path: "/a", content: "# Live" });
    const saved = await call("update_page", { path: "/a", content: "# Draft", title: "Draft", draft: true });
    expect(saved).toMatchObject({ title: "Draft" });
    expect(saved.preview_url).toMatch(/\/p\/a\?preview$/);
    expect(await call("get_page", { path: "/a" })).toMatchObject({ content: "# Live", has_draft: true });
    expect(await call("get_page", { path: "/a", draft: true })).toMatchObject({ content: "# Draft" });

    expect(await call("publish_draft", { path: "/a" })).toMatchObject({ title: "Draft" });
    expect(await call("get_page", { path: "/a" })).toMatchObject({ content: "# Draft", has_draft: false });
  });

  it("can be discarded", async () => {
    await call("publish_page", { path: "/a", content: "live" });
    await call("edit_page", { path: "/a", find: "live", replace: "draft", draft: true });
    expect(await call("discard_draft", { path: "/a" })).toEqual({ path: "/a", discarded: true });
    expect(await call("discard_draft", { path: "/a" })).toEqual({ path: "/a", discarded: false });
    expect(await call("get_page", { path: "/a" })).toMatchObject({ content: "live", has_draft: false });
  });

  it("refuses to publish when there is none", async () => {
    await call("publish_page", { path: "/a", content: "live" });
    expect(await refusal(call("publish_draft", { path: "/a" }))).toMatch(/^400 .*no working copy to publish/);
  });
});

describe("update_page", () => {
  it("merges meta and removes a key set to null", async () => {
    await call("publish_page", { path: "/a", content: "x", meta: { kind: "post", date: "2026-01-01" } });
    expect(await call("update_page", { path: "/a", meta: { kind: null, tag: "news" } })).toMatchObject({
      meta: { date: "2026-01-01", tag: "news" },
    });
  });

  it("refuses a missing page and an empty update", async () => {
    expect(await refusal(call("update_page", { path: "/nope", content: "x" }))).toMatch(
      /^400 No page exists at \/nope\. Use publish_page/,
    );
    await call("publish_page", { path: "/a", content: "x" });
    expect(await refusal(call("update_page", { path: "/a" }))).toMatch(/^400 .*there is nothing to update/);
  });
});

describe("access", () => {
  it("lets anyone signed in read but only the owner write", async () => {
    const guest = await t.signUp("guest@example.com");
    await call("publish_page", { path: "/a", content: "x" });
    expect(await t.as(guest).call("get_page", { path: "/a" })).toMatchObject({ content: "x" });
    expect(await refusal(t.as(guest).call("publish_page", { path: "/b", content: "x" }))).toMatch(/^404 not found/);
  });
});
