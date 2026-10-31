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

async function refusal(call: Promise<unknown>): Promise<string | null> {
  return call.then(
    () => null,
    (error) => `${(error as { status: number }).status} ${(error as Error).message}`,
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
    expect(await refusal(t.as(owner).call("set_instructions", { text: "two" }))).toMatch(
      /^409 .*already exist at rev 1/,
    );
  });

  it("refuse a stale rev", async () => {
    await t.as(owner).call("set_instructions", { text: "one" });
    await t.as(owner).call("set_instructions", { text: "two", if_rev: 1 });
    expect(await refusal(t.as(owner).call("set_instructions", { text: "three", if_rev: 1 }))).toMatch(
      /^409 .*changed since you read them/,
    );
  });

  it("keep the rev when the text is unchanged", async () => {
    await t.as(owner).call("set_instructions", { text: "one" });
    expect(await t.as(owner).call("set_instructions", { text: "one", if_rev: 1 })).toMatchObject({ rev: 1 });
  });

  it("refuse text over the limit", async () => {
    expect(await refusal(t.as(owner).call("set_instructions", { text: "x".repeat(MAX_INSTRUCTIONS + 1) }))).toMatch(
      /^400 .*the limit is 16000/,
    );
  });

  it("are readable but not writable by anyone else signed in", async () => {
    const guest = await t.signUp("guest@example.com");
    await t.as(owner).call("set_instructions", { text: "one" });
    expect(await t.as(guest).call("get_instructions", {})).toMatchObject({ text: "one" });
    expect(await refusal(t.as(guest).call("set_instructions", { text: "two", if_rev: 1 }))).toMatch(/^404 not found/);
  });

  it("need a sign-in", async () => {
    expect(await refusal(t.call("get_instructions", {}))).toMatch(/^401 Unauthorized/);
  });
});
