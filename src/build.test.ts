import { testApp } from "@celsoft/platform/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildStamp, describeBuild } from "./build";
import app from "./worker";

const deployed = {
  DEPLOY_TARGET: "production",
  DEPLOY_AT: "2026-09-05T22:14:37.000Z",
  DEPLOY_COMMIT: "b8565f0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b",
  DEPLOY_BRANCH: "main",
};

describe("describeBuild", () => {
  it("shows the time to the minute in UTC with the ref", () => {
    expect(describeBuild(buildStamp(deployed))).toBe("Deployed 2026-09-05 22:14 UTC · main@b8565f0");
  });

  it("names a target that is not production", () => {
    expect(describeBuild(buildStamp({ ...deployed, DEPLOY_TARGET: "preview" }))).toBe(
      "Deployed 2026-09-05 22:14 UTC · main@b8565f0 · preview",
    );
  });

  it("names the target when nothing else is known, as under tests", () => {
    expect(describeBuild(buildStamp({ DEPLOY_TARGET: "test" }))).toBe("Running as test, not from a deploy.");
    expect(describeBuild(buildStamp({}))).toBe("Not from a deploy.");
  });

  it("ignores an unparseable time rather than printing Invalid Date", () => {
    expect(describeBuild(buildStamp({ ...deployed, DEPLOY_AT: "not a date" }))).toBe("Deployed from · main@b8565f0");
  });
});

describe("{{ build }}", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  beforeEach(async () => {
    t = await testApp(app);
  });
  afterEach(() => t.close());

  it("tells a template which deploy is serving it", async () => {
    const owner = await t.signUp("owner@example.com");
    await t.as(owner).call("publish_page", {
      path: "/about",
      content: "# About\n\n```pages\n[{{ build.target }}] {{ build.description }}\n```",
    });
    expect(await (await t.fetch("/p/about")).text()).toContain("[test] Running as test, not from a deploy.");
  });
});
