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

async function refusal(promise: Promise<unknown>): Promise<string | null> {
  return promise.then(
    () => null,
    (error) => `${(error as { status: number }).status} ${(error as Error).message}`,
  );
}

const tokenOf = (link: string) => link.split("#link=")[1];

// A trip: a page, a deeper page, a collection and an asset, all under /trip, and a neighbour that is not.
async function trip() {
  await call("publish_page", { path: "/trip", content: "# Trip" });
  await call("publish_page", { path: "/trip/day1", content: "# Day one" });
  await call("publish_page", { path: "/tripwire", content: "# Tripwire" });
  await call("put_item", { path: "/trip/stops", id: "louvre", fields: { name: "Louvre" } });
  await call("upload_asset", {
    path: "/trip/note.txt",
    file: new File(["bonjour"], "note.txt", { type: "text/plain" }),
  });
}

const URLS = ["/p/trip", "/p/trip/day1", "/data/trip/stops.json", "/assets/trip/note.txt"];

async function statuses(init?: RequestInit) {
  return Promise.all(URLS.map(async (url) => (await t.fetch(url, init)).status));
}

describe("set_privacy", () => {
  it("closes a path and everything under it, and leaves a neighbour open", async () => {
    await trip();
    expect(await call("set_privacy", { path: "/trip", private: true })).toMatchObject({
      path: "/trip",
      private: true,
      closed: { pages: 2, collections: 1, assets: 1 },
    });
    expect(await statuses()).toEqual([404, 404, 404, 404]);
    expect((await t.fetch("/p/tripwire")).status).toBe(200);
  });

  it("answers a stranger at a closed path exactly as at a missing one", async () => {
    await trip();
    await call("set_privacy", { path: "/trip", private: true });
    const closed = await t.fetch("/p/trip/day1");
    const missing = await t.fetch("/p/trip/day9");
    expect(closed.status).toBe(missing.status);
    // The 404 page names the path it was asked for in its sign-in link, and nothing else differs.
    expect((await closed.text()).replaceAll("day1", "day9")).toBe(await missing.text());
  });

  it("still lets the owner read and write it", async () => {
    await trip();
    await call("set_privacy", { path: "/trip", private: true });
    expect((await t.as(owner).fetch("/p/trip/day1")).status).toBe(200);
    expect(await call("get_page", { path: "/trip/day1" })).toMatchObject({ title: "Day one" });
    await call("update_page", { path: "/trip/day1", content: "# Day 1" });
  });

  it("refuses it to a signed-in reader, through the tools as through the pages", async () => {
    await trip();
    await call("set_privacy", { path: "/trip", private: true });
    const guest = await t.signUp("guest@example.com");
    expect(await refusal(t.as(guest).call("get_page", { path: "/trip/day1" }))).toMatch(/^404/);
    expect((await t.as(guest).fetch("/p/trip")).status).toBe(404);
    expect(await refusal(t.as(guest).call("set_privacy", { path: "/trip", private: false }))).toMatch(/^404/);
  });

  it("keeps drafts behind the gate too", async () => {
    await trip();
    await call("update_page", { path: "/trip", content: "# Draft", draft: true });
    await call("set_privacy", { path: "/trip", private: true });
    const { link } = await call("share_path", { path: "/trip", label: "Dana" });
    expect((await t.fetch("/preview/trip", { headers: { "x-access-link": tokenOf(link) } })).status).toBe(404);
    expect((await t.as(owner).fetch("/preview/trip")).status).toBe(200);
  });

  it("refuses / and points at /root", async () => {
    expect(await refusal(call("set_privacy", { path: "/", private: true }))).toMatch(/^400 \/ cannot be private.*\/root/);
  });

  it("does not nest, either way", async () => {
    await trip();
    await call("set_privacy", { path: "/trip", private: true });
    expect(await refusal(call("set_privacy", { path: "/trip/day1", private: true }))).toMatch(
      /^400 \/trip is already private and privacy does not nest/,
    );
    await call("set_privacy", { path: "/trip", private: false });
    await call("set_privacy", { path: "/trip/day1", private: true });
    expect(await refusal(call("set_privacy", { path: "/trip", private: true }))).toMatch(
      /^400 \/trip\/day1 is already private and privacy does not nest, so \/trip cannot close over it/,
    );
  });

  it("matches on segments, so a neighbour is not a nested scope", async () => {
    await trip();
    await call("set_privacy", { path: "/trip", private: true });
    expect(await call("set_privacy", { path: "/tripwire", private: true })).toMatchObject({ private: true });
  });

  it("says when it was already private or already public", async () => {
    await trip();
    await call("set_privacy", { path: "/trip", private: true });
    expect((await call("set_privacy", { path: "/trip", private: true })).note).toBe("/trip was already private.");
    expect((await call("set_privacy", { path: "/tripwire", private: false })).note).toBe("/tripwire was already public.");
  });

  it("refuses to reopen a path that is private only because one above it is", async () => {
    await trip();
    await call("set_privacy", { path: "/trip", private: true });
    expect(await refusal(call("set_privacy", { path: "/trip/day1", private: false }))).toMatch(
      /^400 \/trip\/day1 has no privacy of its own: it is private because \/trip is/,
    );
  });

  it("reopens everything and kills every link on it", async () => {
    await trip();
    const { link } = await call("share_path", { path: "/trip", label: "Dana" });
    await call("share_path", { path: "/trip", label: "Sam" });
    expect(await call("set_privacy", { path: "/trip", private: false })).toMatchObject({
      private: false,
      revoked: ["Dana", "Sam"],
    });
    expect(await statuses()).toEqual([200, 200, 200, 200]);
    await call("set_privacy", { path: "/trip", private: true });
    expect(await statuses({ headers: { "x-access-link": tokenOf(link) } })).toEqual([404, 404, 404, 404]);
  });
});

describe("share_path", () => {
  it("opens the whole scope with the link, and only that scope", async () => {
    await trip();
    await call("set_privacy", { path: "/tripwire", private: true });
    const shared = await call("share_path", { path: "/trip", label: "Dana" });
    expect(shared).toMatchObject({ path: "/trip", label: "Dana", closed: true });
    expect(shared.link).toMatch(/\/p\/trip#link=.+/);
    const headers = { "x-access-link": tokenOf(shared.link) };
    expect(await statuses({ headers })).toEqual([200, 200, 200, 200]);
    expect((await t.fetch("/p/tripwire", { headers })).status).toBe(404);
  });

  it("closes the path when it was public, and says so", async () => {
    await trip();
    await call("set_privacy", { path: "/trip", private: true });
    expect((await call("share_path", { path: "/trip", label: "Dana" })).closed).toBe(false);
  });

  it("refuses a second link with the same label on a path", async () => {
    await trip();
    await call("share_path", { path: "/trip", label: "Dana" });
    expect(await refusal(call("share_path", { path: "/trip", label: "Dana" }))).toMatch(
      /^400 \/trip already has a share labelled "Dana"/,
    );
  });

  it("refuses a path inside a private one, naming the one to share", async () => {
    await trip();
    await call("set_privacy", { path: "/trip", private: true });
    expect(await refusal(call("share_path", { path: "/trip/day1", label: "Dana" }))).toMatch(
      /^400 \/trip is already private.*Share \/trip instead/,
    );
  });

  it("refuses a missing label", async () => {
    expect(await refusal(call("share_path", { path: "/trip", label: "  " }))).toMatch(/^400 .*label is required/);
  });
});

describe("list_shares", () => {
  it("lists every private path with its links, and never the links themselves", async () => {
    await trip();
    await call("share_path", { path: "/trip", label: "Dana" });
    await call("set_privacy", { path: "/tripwire", private: true });
    const listed = await call("list_shares", {});
    expect(listed.private.map((p: { path: string }) => p.path)).toEqual(["/trip", "/tripwire"]);
    expect(listed.private[0].shares).toEqual([{ label: "Dana", created: expect.any(String), expires: null }]);
    expect(listed.private[1].shares).toEqual([]);
    expect(JSON.stringify(listed)).not.toContain("#link=");
  });

  it("names the path closing one that has no scope of its own", async () => {
    await trip();
    await call("set_privacy", { path: "/trip", private: true });
    expect(await call("list_shares", { path: "/trip/day1" })).toMatchObject({ private: [], closed_by: "/trip" });
    expect((await call("list_shares", { path: "/tripwire" })).note).toBe("/tripwire is public.");
  });

  it("is the owner's alone", async () => {
    const guest = await t.signUp("guest@example.com");
    expect(await refusal(t.as(guest).call("list_shares", {}))).toMatch(/^404/);
  });
});

describe("revoke_share", () => {
  it("kills one recipient's link and leaves the others working", async () => {
    await trip();
    const dana = await call("share_path", { path: "/trip", label: "Dana" });
    const sam = await call("share_path", { path: "/trip", label: "Sam" });
    expect(await call("revoke_share", { path: "/trip", label: "Dana" })).toMatchObject({
      revoked: ["Dana"],
      remaining: 1,
    });
    expect((await t.fetch("/p/trip", { headers: { "x-access-link": tokenOf(dana.link) } })).status).toBe(404);
    expect((await t.fetch("/p/trip", { headers: { "x-access-link": tokenOf(sam.link) } })).status).toBe(200);
  });

  it("revokes every link without a label, and leaves the path closed", async () => {
    await trip();
    await call("share_path", { path: "/trip", label: "Dana" });
    await call("share_path", { path: "/trip", label: "Sam" });
    expect(await call("revoke_share", { path: "/trip" })).toMatchObject({ revoked: ["Dana", "Sam"], remaining: 0 });
    expect(await statuses()).toEqual([404, 404, 404, 404]);
  });

  it("says when there was nothing to revoke", async () => {
    await trip();
    await call("set_privacy", { path: "/trip", private: true });
    expect(await call("revoke_share", { path: "/trip", label: "Nobody" })).toMatchObject({
      revoked: [],
      note: '/trip has no share labelled "Nobody".',
    });
  });

  it("refuses a public path and one closed from above", async () => {
    await trip();
    expect(await refusal(call("revoke_share", { path: "/trip" }))).toMatch(/^400 \/trip is not private/);
    await call("set_privacy", { path: "/trip", private: true });
    expect(await refusal(call("revoke_share", { path: "/trip/day1" }))).toMatch(/^400 .*Revoke on \/trip/);
  });
});

describe("listings", () => {
  it("leave private pages out of the contents at /", async () => {
    await trip();
    await call("set_privacy", { path: "/trip", private: true });
    const contents = await (await t.fetch("/")).text();
    expect(contents).toContain("/tripwire");
    expect(contents).not.toContain('href="/p/trip"');
    await call("set_privacy", { path: "/trip", private: false });
    expect(await (await t.fetch("/")).text()).toContain('href="/p/trip"');
  });

  it("leave private collections out of the index", async () => {
    await trip();
    await call("put_item", { path: "/open", id: "a", fields: {} });
    await call("set_privacy", { path: "/trip", private: true });
    const index = (await (await t.fetch("/data/_collections.json")).json()) as { path: string }[];
    expect(index.map((c) => c.path)).toEqual(["/open"]);
  });

  it("show a template only what a stranger may see", async () => {
    await trip();
    await call("set_privacy", { path: "/trip", private: true });
    await call("publish_page", {
      path: "/list",
      content:
        "# List\n\n```pages\n{% for p in site.pages %}[{{ p.path }}]{% endfor %}" +
        '|{{ collections["/trip/stops"] | size }}\n```',
    });
    const body = await (await t.fetch("/p/list")).text();
    expect(body).toContain("[/list][/tripwire]|0");
  });

  it("show a page inside a private path that path's own pages, and nothing of another's", async () => {
    await trip();
    await call("publish_page", { path: "/other/page", content: "# Other" });
    await call("set_privacy", { path: "/other", private: true });
    await call("set_privacy", { path: "/trip", private: true });
    await call("publish_page", {
      path: "/trip/list",
      content:
        "# List\n\n```pages\n{% for p in site.pages %}[{{ p.path }}]{% endfor %}" +
        '|{{ collections["/trip/stops"] | size }}\n```',
    });
    const { link } = await call("share_path", { path: "/trip", label: "Dana" });
    const body = await (await t.fetch("/p/trip/list", { headers: { "x-access-link": tokenOf(link) } })).text();
    expect(body).toContain("[/trip][/trip/day1][/trip/list][/tripwire]|1");
    expect(body).not.toContain("/other/page");
  });
});
