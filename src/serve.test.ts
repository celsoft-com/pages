import { testApp } from "@celsoft/platform/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assets } from "./schema";
import { assetFile } from "./store";
import app from "./worker";

let t: Awaited<ReturnType<typeof testApp>>;
let owner: Awaited<ReturnType<typeof t.signUp>>;

beforeEach(async () => {
  t = await testApp(app);
  owner = await t.signUp("owner@example.com");
});
afterEach(() => t.close());

const call = (name: string, input: Record<string, unknown>) => t.as(owner).call(name, input) as Promise<any>;

describe("/p", () => {
  it("themes markdown and runs its templates", async () => {
    await call("put_item", { path: "/trip/stops", id: "louvre", fields: { name: "Louvre" } });
    await call("publish_page", {
      path: "/trip",
      content: '# Trip\n\n```pages\n{% for s in collections["/trip/stops"] %}<b>{{ s.name }}</b>{% endfor %}\n```',
    });
    const response = await t.fetch("/p/trip");
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("<title>Trip</title>");
    expect(body).toContain("<b>Louvre</b>");
  });

  it("serves html exactly as written", async () => {
    const html = "<!doctype html><title>Raw</title><p>as is</p>";
    await call("publish_page", { path: "/raw", content: html });
    expect(await (await t.fetch("/p/raw")).text()).toBe(html);
  });

  it("sends /p/root to /", async () => {
    await call("publish_page", { path: "/root", content: "# Home" });
    const response = await t.fetch("/p/root", { redirect: "manual" });
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/");
  });

  it("answers 404 for a page that is not there", async () => {
    expect((await t.fetch("/p/missing")).status).toBe(404);
  });

  it("reads the live copy, never the draft", async () => {
    await call("publish_page", { path: "/about", content: "# Live" });
    await call("update_page", { path: "/about", content: "# Draft", draft: true });
    expect(await (await t.fetch("/p/about")).text()).toContain("<title>Live</title>");
  });
});

describe("/preview", () => {
  it("renders the working copy for whoever may write the page", async () => {
    await call("publish_page", { path: "/about", content: "# Live" });
    await call("update_page", { path: "/about", content: "# Draft", draft: true });
    const response = await t.as(owner).fetch("/preview/about");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(body).toContain(">Draft</h1>");
    expect(body).not.toContain(">Live</h1>");
  });

  it("answers anyone else exactly as it answers a path with nothing there", async () => {
    await call("publish_page", { path: "/about", content: "# Live" });
    await call("update_page", { path: "/about", content: "# Draft", draft: true });
    const guest = await t.signUp("guest@example.com");
    for (const caller of [t, t.as(guest)]) {
      const drafted = await caller.fetch("/preview/about");
      const missing = await caller.fetch("/preview/nothing");
      expect(drafted.status).toBe(404);
      expect((await drafted.text()).replaceAll("about", "nothing")).toBe(await missing.text());
    }
  });
});

describe("/", () => {
  it("lists public pages until /root is published", async () => {
    await call("publish_page", { path: "/about", content: "# About" });
    expect(await (await t.fetch("/")).text()).toContain('<a href="/p/about">About</a>');
    await call("publish_page", { path: "/root", content: "# Welcome" });
    expect(await (await t.fetch("/")).text()).toContain("<title>Welcome</title>");
  });
});

describe("/data", () => {
  it("serves a collection as a bare array in order", async () => {
    await call("put_item", { path: "/trip/stops", id: "b", fields: { n: 2 } });
    await call("put_item", { path: "/trip/stops", id: "a", fields: { n: 1, where: { lat: 1.5 } } });
    const response = await t.fetch("/data/trip/stops.json");
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.json()).toEqual([
      { id: "b", n: 2 },
      { id: "a", n: 1, where: { lat: 1.5 } },
    ]);
  });

  it("serves the index of collections", async () => {
    await call("put_item", { path: "/trip/stops", id: "a", fields: {} });
    expect(await (await t.fetch("/data/_collections.json")).json()).toMatchObject([
      { path: "/trip/stops", url: "/data/trip/stops.json", count: 1 },
    ]);
  });

  it("answers 404 without .json or for a missing collection", async () => {
    await call("put_item", { path: "/trip/stops", id: "a", fields: {} });
    expect((await t.fetch("/data/trip/stops")).status).toBe(404);
    expect((await t.fetch("/data/nothing.json")).status).toBe(404);
  });
});

describe("/assets", () => {
  it("serves the bytes with their content type", async () => {
    const asset = {
      key: "trip~map.svg",
      path: "/trip/map.svg",
      filename: "map.svg",
      contentType: "image/svg+xml",
      size: 6,
      createdAt: Date.now(),
    };
    await t.files.put(assetFile(asset.key), "<svg/>", asset.contentType);
    await t.db.insert(assets).values({ key: asset.key, path: asset.path, asset });
    const response = await t.fetch("/assets/trip/map.svg");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(await response.text()).toBe("<svg/>");
    expect((await t.fetch("/assets/trip/none.svg")).status).toBe(404);
  });
});

describe("/favicon.ico", () => {
  it("serves the built-in icon until one is uploaded to /root", async () => {
    const response = await t.fetch("/favicon.ico");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
  });

  it("serves the first favicon name found in /root, with its own type", async () => {
    const upload = (name: string, type: string) =>
      call("upload_asset", { file: new File([name], name, { type }), path: `/root/${name}` });
    await upload("favicon.png", "image/png");
    await upload("favicon.svg", "image/svg+xml");
    const response = await t.fetch("/favicon.ico");
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(await response.text()).toBe("favicon.svg");
  });
});
