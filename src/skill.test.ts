import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INSTRUCTIONS } from "./mcp/handler";
import { TOOLS } from "./mcp/tools";

const SKILL = readFileSync(new URL("../skills/pages-api/SKILL.md", import.meta.url), "utf8");

// Identifiers the skill legitimately names that are not tools: argument names, response fields
// and its own environment variables. Anything snake_case outside this list has to be a real tool,
// so a rename cannot leave the skill quietly pointing at something that no longer exists.
const NOT_TOOLS = new Set([
  "if_rev",
  "input_schema",
  "pages_site_url",
  "pages_api_token",
  "xdg_config_home",
]);

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9_]+/g, " ").trim().split(/\s+/);
}

describe("the shipped skill", () => {
  it("names only tools that exist", () => {
    const names = new Set(TOOLS.map((t) => t.name));
    const mentioned = new Set(
      (SKILL.match(/\b[a-z]+(?:_[a-z0-9]+)+\b/g) ?? []).filter((word) => !NOT_TOOLS.has(word)),
    );

    for (const word of mentioned) expect(names, `SKILL.md names ${word}`).toContain(word);
  });

  // The site serves one instructions string to MCP and to the API alike. A skill installed on
  // someone's laptop updates when they reinstall it; the site updates when it deploys. So the
  // skill sends the agent to fetch that text and must never hold a stale second copy of it.
  it("does not restate the site's instructions", () => {
    const instruction = words(INSTRUCTIONS);
    const skill = ` ${words(SKILL).join(" ")} `;

    const RUN = 12;
    const copied: string[] = [];
    for (let i = 0; i + RUN <= instruction.length; i++) {
      const shingle = instruction.slice(i, i + RUN).join(" ");
      if (skill.includes(` ${shingle} `)) copied.push(shingle);
    }

    expect(copied.slice(0, 3), "SKILL.md repeats the instructions instead of pointing at them").toEqual([]);
  });

  it("tells the agent to fetch the tool list rather than carrying one", () => {
    expect(SKILL).toMatch(/fetch it, never carry it/i);
    // A schema in the skill is a copy of something the site already serves, and the surest way
    // for an argument to go stale.
    expect(SKILL).not.toMatch(/"type"\s*:\s*"object"/);
  });

  it("keeps the token off the command line wherever it tells someone to save it", () => {
    expect(SKILL).toMatch(/pbpaste \| scripts\/pages-login/);
    expect(SKILL).not.toMatch(/pages-login\s+\S+\s+pat_/);
  });
});
