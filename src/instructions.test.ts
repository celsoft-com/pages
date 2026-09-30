import { beforeEach, describe, expect, it } from "vitest";
import { handle } from "./app";
import { createSessionCookie } from "./auth/session";
import { completeSetup, getOwner } from "./auth/setup";
import { isConflict } from "./errors";
import { getInstructions, MAX_INSTRUCTIONS, saveInstructions } from "./instructions";
import { TOOLS, type ToolContext } from "./mcp/tools";
import { resetBlobs } from "./test/blobs";

const ctx: ToolContext = { siteUrl: "https://example.com" };
let cookie: string;

beforeEach(async () => {
  resetBlobs();
  await completeSetup("correct horse battery");
  cookie = (await createSessionCookie((await getOwner())!)).split(";")[0];
});

function call(name: string, args: Record<string, unknown> = {}) {
  const tool = TOOLS.find((t) => t.name === name)!;
  return tool.handler(args, ctx).then((r) => tool.render(r as never));
}

function post(fields: Record<string, string>): Promise<Response> {
  return handle(
    new Request("https://example.com/admin/instructions", {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    }),
  );
}

async function refused(write: Promise<unknown>): Promise<unknown> {
  return write.then(
    () => null,
    (error) => error,
  );
}

describe("storage", () => {
  it("starts empty at rev 0, and a first write needs no rev", async () => {
    expect(await getInstructions()).toEqual({ text: "", rev: 0, updatedAt: null });
    expect((await saveInstructions("- One\n", undefined)).rev).toBe(1);
    expect((await getInstructions()).text).toBe("- One");
  });

  // The owner and a client both write here, so neither may erase the other without having read it.
  it("refuses a write that skips the rev or carries a stale one, as a conflict", async () => {
    await saveInstructions("- One", undefined);
    expect(isConflict(await refused(saveInstructions("- Two", undefined)))).toBe(true);
    await saveInstructions("- Two", 1);
    expect(isConflict(await refused(saveInstructions("- Three", 1)))).toBe(true);
    expect((await getInstructions()).text).toBe("- Two");
  });

  it("keeps the rev for an unchanged text, and refuses one over the limit", async () => {
    await saveInstructions("- One", undefined);
    expect((await saveInstructions("- One", 1)).rev).toBe(1);
    expect(await refused(saveInstructions("x".repeat(MAX_INSTRUCTIONS + 1), 1))).toBeInstanceOf(Error);
  });
});

describe("the tools", () => {
  it("say there are none, and then return what was recorded", async () => {
    expect(await call("get_instructions")).toMatch(/no instructions for this site yet/);
    expect(await call("set_instructions", { text: "- British English." })).toMatch(/rev 1.*Tell the owner/);
    expect(await call("get_instructions")).toContain("- British English.");
  });
});

describe("the admin screen", () => {
  it("saves what the owner types", async () => {
    const saved = await post({ text: "- Plain words.", rev: "0" });
    expect(saved.status).toBe(303);
    expect((await getInstructions()).text).toBe("- Plain words.");
  });

  // A client wrote while the owner had the screen open: their typing survives, next to the new text.
  it("keeps the owner's text on a conflict and shows what is saved now", async () => {
    await saveInstructions("- From Claude.", undefined);
    const body = await (await post({ text: "- From the owner.", rev: "0" })).text();

    expect(body).toContain("These changed while you were editing them");
    expect(body).toContain("- From the owner.</textarea>");
    expect(body).toContain("- From Claude.");
    expect(body).toContain('name="rev" value="1"');
    expect((await getInstructions()).text).toBe("- From Claude.");
  });
});
