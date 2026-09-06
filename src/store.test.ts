import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A summary rides along as metadata with the blob it describes, so a blob written anywhere else is
// one whose summary can be wrong. These are the two writers, and there is a test rather than a
// convention because a second one reads as ordinary code and fails silently, in the summary only.
const OWNERS = [
  { call: "stores.data().setJSON", owner: "data/service.ts" },
  { call: "stores.pages().setJSON", owner: "pages/service.ts" },
];

describe("blob writers", () => {
  const sources = readdirSync("src", { recursive: true, encoding: "utf8" }).filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
  );

  for (const { call, owner } of OWNERS) {
    it(`writes ${call} only in ${owner}`, () => {
      const offenders = sources
        .filter((name) => name !== owner)
        .filter((name) => readFileSync(`src/${name}`, "utf8").includes(call));

      expect(offenders).toEqual([]);
    });
  }
});
