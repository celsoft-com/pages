import { describe, expect, it } from "vitest";
import { buildStamp, describeBuild } from "./build";
import { page } from "./admin/ui";

const deployed = {
  builtAt: "2026-09-05T22:14:37.000Z",
  commit: "b8565f0",
  branch: "main",
  context: "production",
};

describe("describeBuild", () => {
  it("shows the time to the minute in UTC with the ref", () => {
    expect(describeBuild(deployed)).toBe("Built 2026-09-05 22:14 UTC · main@b8565f0");
  });

  it("names a context that is not production", () => {
    expect(describeBuild({ ...deployed, context: "deploy-preview" })).toContain("deploy-preview");
  });

  it("says so when nothing was stamped", () => {
    expect(describeBuild({ builtAt: "", commit: "", branch: "", context: "" })).toBe(
      "Running locally, not from a deploy build.",
    );
  });

  it("survives a stamp with only a ref", () => {
    expect(describeBuild({ builtAt: "", commit: "abc1234", branch: "", context: "" })).toBe("Built from · abc1234");
  });

  it("ignores an unparseable timestamp rather than printing Invalid Date", () => {
    const text = describeBuild({ ...deployed, builtAt: "not a date" });
    expect(text).not.toMatch(/invalid/i);
    expect(text).toBe("Built from · main@b8565f0");
  });
});

describe("buildStamp", () => {
  it("reads the committed placeholder as empty in a local checkout", () => {
    const stamp = buildStamp();
    expect(typeof stamp.builtAt).toBe("string");
    expect(typeof stamp.commit).toBe("string");
  });
});

describe("where it renders", () => {
  async function html(options: Parameters<typeof page>[0]): Promise<string> {
    return page(options).text();
  }

  it("appears on a chromed admin page", async () => {
    expect(await html({ title: "Pages", body: "<h1>Pages</h1>" })).toContain('<footer class="build">');
  });

  it("stays off the login and setup screens", async () => {
    expect(await html({ title: "Log in", body: "<h1>Log in</h1>", chrome: false })).not.toContain("<footer");
  });
});
