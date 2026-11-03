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
const location = async (path: string) => {
  const response = await t.fetch(path, { redirect: "manual" });
  return `${response.status} ${response.headers.get("location") ?? ""}`;
};

describe("redirects", () => {
  it("send an old address to a page, and list and remove like data", async () => {
    await call("publish_page", { path: "/essay/x", content: "# X" });
    await call("set_redirect", { from: "/essay/x", to: "/p/essay/x" });
    expect(await location("/essay/x")).toMatch(/^301 .*\/p\/essay\/x$/);
    expect((await call("list_redirects", {})).redirects).toEqual([
      { from: "/essay/x", to: "/p/essay/x", status: 301, prefix: false },
    ]);
    expect(await call("remove_redirect", { from: "/essay/x" })).toEqual({ from: "/essay/x", removed: true });
    expect((await t.fetch("/essay/x")).status).toBe(404);
  });

  it("move a whole folder with prefix", async () => {
    await call("set_redirect", { from: "/essay", to: "/p/essay", prefix: true });
    expect(await location("/essay/deep/one")).toMatch(/^301 .*\/p\/essay\/deep\/one$/);
  });

  it("never hide what is there", async () => {
    await call("publish_page", { path: "/about", content: "# About" });
    await call("set_redirect", { from: "/p/about", to: "/p/elsewhere" });
    expect((await t.fetch("/p/about")).status).toBe(200);
  });

  it("are the owner's to change", async () => {
    const guest = await t.signUp("guest@example.com");
    await expect(t.as(guest).call("set_redirect", { from: "/a", to: "/b" })).rejects.toMatchObject({ status: 404 });
  });
});
