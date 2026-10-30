import { testApp } from "@celsoft/platform/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_INSTRUCTIONS } from "./instructions";
import app from "./worker";

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

describe("instructions", () => {
  it("start empty at rev 0", async () => {
    expect(await t.as(owner).call("get_instructions", {})).toEqual({
      text: "",
      rev: 0,
      updated_at: null,
      limit: MAX_INSTRUCTIONS,
    });
  });

  it("save trimmed and bump the rev", async () => {
    const saved = await t.as(owner).call("set_instructions", { text: "  Write in British English.\n" });
    expect(saved).toMatchObject({ rev: 1, characters: 25 });
    expect(await t.as(owner).call("get_instructions", {})).toMatchObject({ text: "Write in British English.", rev: 1 });
  });

  it("refuse a write with no rev once some exist", async () => {
    await t.as(owner).call("set_instructions", { text: "one" });
    expect(await status(t.as(owner).call("set_instructions", { text: "two" }))).toBe(409);
  });

  it("refuse a stale rev", async () => {
    await t.as(owner).call("set_instructions", { text: "one" });
    await t.as(owner).call("set_instructions", { text: "two", if_rev: 1 });
    expect(await status(t.as(owner).call("set_instructions", { text: "three", if_rev: 1 }))).toBe(409);
  });

  it("keep the rev when the text is unchanged", async () => {
    await t.as(owner).call("set_instructions", { text: "one" });
    expect(await t.as(owner).call("set_instructions", { text: "one", if_rev: 1 })).toMatchObject({ rev: 1 });
  });

  it("refuse text over the limit", async () => {
    expect(await status(t.as(owner).call("set_instructions", { text: "x".repeat(MAX_INSTRUCTIONS + 1) }))).toBe(400);
  });

  it("are readable but not writable by anyone else signed in", async () => {
    const guest = await t.signUp("guest@example.com");
    await t.as(owner).call("set_instructions", { text: "one" });
    expect(await t.as(guest).call("get_instructions", {})).toMatchObject({ text: "one" });
    expect(await status(t.as(guest).call("set_instructions", { text: "two", if_rev: 1 }))).toBe(404);
  });

  it("need a sign-in", async () => {
    expect(await status(t.call("get_instructions", {}))).toBe(401);
  });
});
