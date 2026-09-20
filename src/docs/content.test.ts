import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LICENSE_MD, README_MD, TOPIC_SOURCES } from "./content";

// The deployed function has no repository to read these out of, so they are carried into the bundle
// as source. The deploy build regenerates them first, so what Netlify serves is never stale; this
// holds the committed copy that `mise run dev` and the rest of the suite read, so an edit to either
// file shows up as a failing test here rather than as a local preview quietly a version behind.
function onDisk(file: string): string {
  return readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
}

describe("the markdown /docs serves", () => {
  it("matches README.md", () => {
    expect(README_MD, "run `mise run docs` to refresh src/docs/content.ts").toBe(onDisk("README.md"));
  });

  it("matches LICENSE.md", () => {
    expect(LICENSE_MD, "run `mise run docs` to refresh src/docs/content.ts").toBe(onDisk("LICENSE.md"));
  });

  it("carries every topic in docs/, byte for byte", () => {
    const files = readdirSync(new URL("../../docs/", import.meta.url))
      .filter((file) => file.endsWith(".md"))
      .sort();
    expect(TOPIC_SOURCES.map((topic) => `${topic.slug}.md`)).toEqual(files);
    for (const topic of TOPIC_SOURCES)
      expect(topic.source, `run \`mise run docs\`: docs/${topic.slug}.md has changed`).toBe(
        onDisk(`docs/${topic.slug}.md`),
      );
  });

  it("is the MIT licence, with a holder and a year", () => {
    expect(LICENSE_MD).toContain("MIT License");
    expect(LICENSE_MD).toMatch(/Copyright \(c\) \d{4}/);
    expect(LICENSE_MD).toContain("WITHOUT WARRANTY OF ANY KIND");
  });
});
