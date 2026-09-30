import { beforeEach, describe, expect, it } from "vitest";
import { handle } from "../app";
import { createSessionCookie } from "../auth/session";
import { completeSetup, getOwner } from "../auth/setup";
import { TOOLS, type ToolContext } from "../mcp/tools";
import { encodeKey, stores } from "../store";
import { resetBlobs } from "../test/blobs";
import { getPage, listPages } from "./service";

const ctx: ToolContext = { siteUrl: "https://example.com" };

async function raw(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const tool = TOOLS.find((t) => t.name === name)!;
  return tool.handler(args, ctx);
}

beforeEach(resetBlobs);

describe("page meta through the tools", () => {
  beforeEach(async () => {
    await raw("publish_page", {
      path: "/essay/sensors",
      content: "# Sensors\n\nA line.\n",
      meta: { kind: "essay", date: "2026-09-30" },
    });
  });

  it("is stored beside the body and listed without reading it", async () => {
    expect((await getPage("/essay/sensors"))!.body).not.toContain("kind");
    const [summary] = await listPages();
    expect(summary.meta).toEqual({ kind: "essay", date: "2026-09-30" });
  });

  it("is merged by update_page one key at a time, and a null removes a key", async () => {
    await raw("update_page", { path: "/essay/sensors", meta: { date: "2026-10-01", dek: "Hot attic" } });
    await raw("update_page", { path: "/essay/sensors", meta: { kind: null } });

    const page = (await getPage("/essay/sensors"))!;
    expect(page.meta).toEqual({ date: "2026-10-01", dek: "Hot attic" });
    expect(page.body).toBe("# Sensors\n\nA line.\n");
  });

  it("survives an edit to the body", async () => {
    await raw("edit_page", { path: "/essay/sensors", find: "A line.", replace: "A change." });
    expect((await getPage("/essay/sensors"))!.meta).toEqual({ kind: "essay", date: "2026-09-30" });
  });

  it("is replaced whole by an overwriting publish", async () => {
    await raw("publish_page", { path: "/essay/sensors", content: "# Again", overwrite: true });
    expect((await getPage("/essay/sensors"))!.meta).toEqual({});
  });

  it("travels with a copy and a move", async () => {
    await raw("copy_page", { from: "/essay/sensors", to: "/essay/copy" });
    await raw("move_page", { from: "/essay/copy", to: "/essay/moved" });
    expect((await getPage("/essay/moved"))!.meta).toEqual({ kind: "essay", date: "2026-09-30" });
  });

  it("refuses an update with nothing in it", async () => {
    await expect(raw("update_page", { path: "/essay/sensors" })).rejects.toThrow("nothing to update");
  });

  it.each([
    [{ title: "x" }, "field of the page itself"],
    [{ path: "/x" }, "field of the page itself"],
    [{ "2nd": "x" }, "must start with a letter"],
    [{ "a b": "x" }, "must start with a letter"],
    [{ part: 2 }, "must be a string"],
  ])("refuses %j", async (meta, message) => {
    await expect(raw("publish_page", { path: "/bad", content: "# Bad", meta })).rejects.toThrow(message);
    await expect(raw("update_page", { path: "/essay/sensors", meta })).rejects.toThrow(message);
  });
});

describe("a page stored before meta existed", () => {
  it("comes back carrying an empty one", async () => {
    await stores.pages().setJSON(encodeKey("/old"), {
      path: "/old",
      contentType: "markdown",
      title: "Old",
      body: "# Old",
      createdAt: 1,
      updatedAt: 1,
    });

    expect((await getPage("/old"))!.meta).toEqual({});
    expect((await listPages())[0].meta).toEqual({});
    expect((await raw("get_page", { path: "/old" })).meta).toEqual({});
  });
});

describe("page meta in the admin editor", () => {
  let cookie: string;

  beforeEach(async () => {
    await completeSetup("correct horse battery");
    cookie = (await createSessionCookie((await getOwner())!)).split(";")[0];
  });

  function save(fields: Record<string, string>): Promise<Response> {
    return handle(
      new Request("https://example.com/admin/pages/save", {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
      }),
    );
  }

  it("is one key: value per line, and a value may hold a colon", async () => {
    await save({ path: "/talk", format: "markdown", title: "", content: "# Talk", meta: "kind: talk\n\ntime: 10:30\n" });
    expect((await getPage("/talk"))!.meta).toEqual({ kind: "talk", time: "10:30" });

    const response = await handle(
      new Request("https://example.com/admin/pages/edit?path=%2Ftalk", { headers: { cookie } }),
    );
    expect(await response.text()).toContain("kind: talk\ntime: 10:30</textarea>");
  });

  it("gives back everything that was typed when a line is refused", async () => {
    const response = await save({
      path: "/talk",
      format: "markdown",
      title: "Talk",
      content: "# A long body worth keeping",
      meta: "kind talk",
    });
    const html = await response.text();

    expect(html).toContain("Meta line 1 needs a key, a colon and a value");
    expect(html).toContain("# A long body worth keeping");
    expect(html).toContain('value="/talk"');
    expect(html).toContain('history.replaceState(null,"","/admin/pages/edit")');
    expect(await getPage("/talk")).toBeNull();
  });
});
