import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MCP_INSTRUCTIONS } from "./mcp-instructions";
import app from "./worker";

const SKILL = readFileSync("skills/pages-api/SKILL.md", "utf8");

describe("the pages-api skill", () => {
  // The skill points at the site rather than copying it, so it may name a tool but never describe
  // one a site no longer has.
  it("names only tools that exist", () => {
    const named = [...new Set([...SKILL.matchAll(/`([a-z]+_[a-z_]+)`/g)].map((m) => m[1]))];
    expect(named.length).toBeGreaterThan(0);
    // A snake_case name in backticks is a tool or one of a tool's arguments, such as if_rev.
    const endpoints = Object.values(app.endpoints) as { input?: { shape?: Record<string, unknown> } }[];
    const known = new Set([...Object.keys(app.endpoints), ...endpoints.flatMap((e) => Object.keys(e.input?.shape ?? {}))]);
    for (const name of named) expect(known.has(name), name).toBe(true);
  });

  it("keeps no copy of what the site teaches on connecting", () => {
    const words = MCP_INSTRUCTIONS.split(/\s+/);
    for (let i = 0; i + 12 <= words.length; i++) expect(SKILL).not.toContain(words.slice(i, i + 12).join(" "));
  });
});
