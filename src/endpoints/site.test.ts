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

async function status(call: Promise<unknown>): Promise<number | null> {
  return call.then(
    () => null,
    (error) => (error as { status: number }).status,
  );
}

const call = (name: string, input: Record<string, unknown>) => t.as(owner).call(name, input) as Promise<any>;

describe("get_site and set_site_info", () => {
  it("starts with the defaults", async () => {
    expect(await call("get_site", {})).toMatchObject({
      title: "Pages",
      description: "",
      head: "",
      header: "",
      footer: "",
      theme: "default",
      pages: 0,
    });
  });

  it("keeps a field left out and replaces one passed", async () => {
    await call("set_site_info", { title: "Trips", description: "Where we went" });
    expect(await call("set_site_info", { theme: "none" })).toEqual({
      title: "Trips",
      description: "Where we went",
      head: "",
      header: "",
      footer: "",
      theme: "none",
    });
  });

  it("accepts a header only once a template is stored there", async () => {
    expect(await status(call("set_site_info", { header: "/root/chrome/header" }))).toBe(400);
    await call("publish_page", { path: "/root/chrome/header", content: "<nav>Home</nav>", format: "html" });
    expect(await call("set_site_info", { header: "/Root/Chrome/Header" })).toMatchObject({
      header: "/root/chrome/header",
    });
    expect((await call("set_site_info", { header: "" })).header).toBe("");
  });

  it("refuses a theme it does not know", async () => {
    expect(await status(call("set_site_info", { theme: "dark" }))).toBe(400);
  });

  it("lets only the owner change it", async () => {
    const guest = await t.signUp("guest@example.com");
    expect((await t.as(guest).call("get_site", {})) as { title: string }).toMatchObject({ title: "Pages" });
    expect(await status(t.as(guest).call("set_site_info", { title: "Mine" }))).toBe(404);
  });
});
