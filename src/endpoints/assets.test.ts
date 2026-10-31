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
const photo = () => new File(["JPEG"], "Photo.JPG", { type: "image/jpeg" });

describe("list_assets", () => {
  it("lists nothing on a new site", async () => {
    expect(await call("list_assets", {})).toEqual({ assets: [] });
  });
});

describe("upload_asset", () => {
  it("files it at its path and serves the bytes there", async () => {
    const uploaded = await call("upload_asset", { file: photo(), path: "/Trip/Images/photo.jpg" });
    expect(uploaded).toMatchObject({
      path: "/trip/images/photo.jpg",
      filename: "Photo.JPG",
      content_type: "image/jpeg",
      bytes: 4,
    });
    expect(uploaded.url).toMatch(/\/assets\/trip\/images\/photo\.jpg$/);
    const served = await t.fetch("/assets/trip/images/photo.jpg");
    expect(served.headers.get("content-type")).toBe("image/jpeg");
    expect(await served.text()).toBe("JPEG");
    expect((await call("list_assets", {})).assets).toMatchObject([{ path: "/trip/images/photo.jpg", bytes: 4 }]);
  });

  it("stores a file with no path under a hash of its bytes", async () => {
    const uploaded = await call("upload_asset", { file: photo() });
    expect(uploaded.path).toBeNull();
    expect(uploaded.url).toMatch(/\/assets\/[0-9a-f]{32}\.jpg$/);
    expect(await (await t.fetch(new URL(uploaded.url).pathname)).text()).toBe("JPEG");
  });

  it("refuses anyone who may not write there", async () => {
    const guest = await t.signUp("guest@example.com");
    await expect(t.as(guest).call("upload_asset", { file: photo(), path: "/x.jpg" })).rejects.toMatchObject({
      status: 404,
    });
  });
});
