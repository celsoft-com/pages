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

const call = (name: string, input: Record<string, unknown>) => t.as(owner).call(name, input) as Promise<any>;
const paths = (reply: { pages: { path: string; private: boolean }[] }) =>
  reply.pages.map((page) => `${page.path}${page.private ? " (private)" : ""}`);

// /trip and /diary are top level, /trip/day1 sits under /trip, and /notes/a has no page above it.
async function site() {
  await call("publish_page", { path: "/trip", content: "# Trip" });
  await call("publish_page", { path: "/trip/day1", content: "# Day one" });
  await call("publish_page", { path: "/diary", content: "# Diary" });
  await call("publish_page", { path: "/notes/a", content: "# A" });
  await call("set_privacy", { path: "/diary", private: true });
}

describe("the directory at /", () => {
  it("lists the public top-level pages, a page with nothing above it included", async () => {
    await site();
    const html = await (await t.fetch("/")).text();
    expect(html).toContain('<a href="/p/trip">Trip</a>');
    expect(html).toContain('<a href="/p/notes/a">A</a>');
    expect(html).not.toContain("/trip/day1");
    expect(html).not.toContain("/diary");
  });

  it("is the same response for the owner as for a stranger, so one cached copy is safe", async () => {
    await site();
    const stranger = await (await t.fetch("/")).text();
    expect(await (await t.as(owner).fetch("/")).text()).toBe(stranger);
  });

  it("says nothing is published on an empty site, and seeds no home page", async () => {
    const html = await (await t.fetch("/")).text();
    expect(html).toContain("Nothing is published yet.");
    expect((await call("list_pages", {})).pages).toEqual([]);
  });

  it("gives way to a page at /root", async () => {
    await site();
    await call("publish_page", { path: "/root", content: "# Home" });
    expect(await (await t.fetch("/")).text()).not.toContain('<ul class="index"');
  });
});

describe("directory", () => {
  it("names only public pages to a stranger", async () => {
    await site();
    expect(paths(await t.call("directory", {}))).toEqual(["/notes/a", "/trip"]);
  });

  it("adds the private pages the owner can open, marked", async () => {
    await site();
    expect(paths(await call("directory", {}))).toEqual(["/diary (private)", "/notes/a", "/trip"]);
  });

  it("never names a private page to someone signed in without access", async () => {
    await site();
    const guest = await t.signUp("guest@example.com");
    expect(paths(await t.as(guest).call("directory", {}))).toEqual(["/notes/a", "/trip"]);
  });

  it("adds the one path a share link opens", async () => {
    await site();
    await call("publish_page", { path: "/letters", content: "# Letters" });
    await call("set_privacy", { path: "/letters", private: true });
    const { link } = await call("share_path", { path: "/diary", label: "family" });
    const reply = await t.fetch("/api/public/directory", { headers: { "x-access-link": link.split("#link=")[1] } });
    expect(paths(await reply.json())).toEqual(["/diary (private)", "/notes/a", "/trip"]);
  });
});
