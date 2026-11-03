import { readdirSync } from "node:fs";
import { testApp } from "@celsoft/platform/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "./worker";

// The admin is a browser app built into dist/ by Vite; the test script builds it first. What a test
// can reach is how it is served: the page, its bundle, and that it shadows none of the site's routes.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp(app);
});
afterAll(() => t.close());

const bundle = () => readdirSync("dist/admin/assets").find((file) => file.endsWith(".js"));

describe("/admin", () => {
  it("serves the admin app at /admin and /admin/", async () => {
    for (const path of ["/admin", "/admin/"]) {
      const response = await t.fetch(path);
      expect(response.status, path).toBe(200);
      const html = await response.text();
      expect(html).toContain("<title>Admin</title>");
      expect(html).toContain(`/admin/assets/${bundle()}`);
    }
  });

  it("serves its bundle as JavaScript", async () => {
    const response = await t.fetch(`/admin/assets/${bundle()}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/javascript/);
  });

  it("keeps the site's own /assets route for uploaded files", async () => {
    const owner = await t.signUp("owner@example.com");
    await t.as(owner).call("upload_asset", { path: "/note.txt", file: new File(["hi"], "note.txt", { type: "text/plain" }) });
    expect(await (await t.fetch("/assets/note.txt")).text()).toBe("hi");
  });

  it("still serves public/'s files beside it", async () => {
    expect((await t.fetch("/robots.txt")).status).toBe(200);
  });
});
