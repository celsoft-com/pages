import { describe, expect, it } from "vitest";
import { MCP_INSTRUCTIONS } from "./mcp-instructions";
import app from "./worker";

describe("MCP instructions", () => {
  // A connector may truncate them, so the pointer to the owner's instructions must survive a cut.
  it("point at the owner's instructions in their first lines", () => {
    expect(MCP_INSTRUCTIONS.slice(0, 400)).toContain("Call get_instructions before writing anything");
  });

  it("name only tools that exist", () => {
    const tools = Object.keys(app.endpoints);
    const named = [...new Set([...MCP_INSTRUCTIONS.matchAll(/\b([a-z]+_[a-z_]+)\b/g)].map((m) => m[1]))];
    expect(named.length).toBeGreaterThan(0);
    for (const name of named) expect(tools, name).toContain(name);
  });
});
