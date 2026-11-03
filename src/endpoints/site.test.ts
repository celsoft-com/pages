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
    expect(await refusal(call("set_site_info", { header: "/root/chrome/header" }))).toMatch(
      /^400 No page is stored at \/root\/chrome\/header/,
    );
    await call("publish_page", { path: "/root/chrome/header", content: "<nav>Home</nav>", format: "html" });
    expect(await call("set_site_info", { header: "/Root/Chrome/Header" })).toMatchObject({
      header: "/root/chrome/header",
    });
    expect((await call("set_site_info", { header: "" })).header).toBe("");
  });

  it("refuses a theme it does not know", async () => {
    expect(await refusal(call("set_site_info", { theme: "dark" }))).toMatch(/^400 .*theme: Invalid option/);
  });

  it("lets only the owner change it", async () => {
    const guest = await t.signUp("guest@example.com");
    expect((await t.as(guest).call("get_site", {})) as { title: string }).toMatchObject({ title: "Pages" });
    expect(await refusal(t.as(guest).call("set_site_info", { title: "Mine" }))).toMatch(/^404 not found/);
  });
});

describe("get_site private paths", () => {
  it("lists the private paths and their link counts to the owner only", async () => {
    await call("publish_page", { path: "/trip", content: "# Trip" });
    await call("share_path", { path: "/trip", label: "Dana" });
    expect((await call("get_site", {})).private).toEqual([{ path: "/trip", shares: 1 }]);
    const guest = await t.signUp("guest@example.com");
    expect(((await t.as(guest).call("get_site", {})) as { private: unknown[] }).private).toEqual([]);
  });
});
