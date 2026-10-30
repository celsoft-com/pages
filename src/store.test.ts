import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A file's summary row is written by the same function that writes the file, so a file written
// anywhere else is one whose row can be wrong. These are the writers, and there is a test rather than
// a convention because a second one reads as ordinary code and fails silently, in the listing only.
const OWNERS = [
  { call: "putJson(collectionFile(", owner: "data/service.ts" },
  { call: "putJson(pageFile(", owner: "pages/service.ts" },
  { call: "files.put(assetFile(", owner: "assets/service.ts" },
];

describe("file writers", () => {
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
