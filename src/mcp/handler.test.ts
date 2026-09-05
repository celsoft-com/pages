import { beforeEach, describe, expect, it } from "vitest";
import { resetBlobs } from "../test/blobs";
import { handleMcp, INSTRUCTIONS } from "./handler";
import { TOOLS } from "./tools";

beforeEach(resetBlobs);

async function rpc(method: string, params?: Record<string, unknown>): Promise<any> {
  const response = await handleMcp(
    new Request("https://example.com/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  return response.json();
}

function text(result: any): string {
  return result.result.content[0].text;
}

describe("instructions", () => {
  it("tells the client to keep repeating content in a collection", () => {
    expect(INSTRUCTIONS).toMatch(/collection/i);
    expect(INSTRUCTIONS).toMatch(/\/data\/<path>\.json/);
  });

  it("tells the client to offer the owner the choice", () => {
    expect(INSTRUCTIONS).toMatch(/offer the owner the choice/i);
  });

  it("names the tools that make item editing cheap", () => {
    for (const name of ["put_item", "delete_item", "reorder_items", "search_items"])
      expect(INSTRUCTIONS).toContain(name);
  });

  it("reaches the client on initialize", async () => {
    const reply = await rpc("initialize");
    expect(reply.result.instructions).toBe(INSTRUCTIONS);
  });
});

describe("tools/list", () => {
  it("advertises every tool with its schema", async () => {
    const reply = await rpc("tools/list");
    expect(reply.result.tools).toHaveLength(TOOLS.length);
    expect(reply.result.tools.map((t: any) => t.name)).toContain("put_item");
    for (const tool of reply.result.tools) expect(tool.inputSchema.type).toBe("object");
  });
});

describe("tools/call", () => {
  it("round-trips a write and a read", async () => {
    await rpc("tools/call", { name: "put_item", arguments: { path: "/p", id: "a", fields: { title: "A" } } });
    const reply = await rpc("tools/call", { name: "get_item", arguments: { path: "/p", id: "a" } });

    expect(reply.result.isError).toBe(false);
    expect(JSON.parse(text(reply))).toEqual({ id: "a", title: "A" });
  });

  it("returns a tool failure as an error result rather than a protocol error", async () => {
    const reply = await rpc("tools/call", { name: "get_item", arguments: { path: "/p", id: "nope" } });
    expect(reply.result.isError).toBe(true);
    expect(text(reply)).toContain("No item nope");
    expect(reply.error).toBeUndefined();
  });

  it("rejects an unknown tool as a protocol error", async () => {
    const reply = await rpc("tools/call", { name: "nope", arguments: {} });
    expect(reply.error.code).toBe(-32602);
  });
});
