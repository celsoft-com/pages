import { beforeEach, describe, expect, it } from "vitest";
import { handle } from "../app";
import { createSessionCookie } from "../auth/session";
import { completeSetup, getOwner } from "../auth/setup";
import { mintToken } from "../auth/tokens";
import { TOOLS, type ToolContext } from "../mcp/tools";
import { resetBlobs } from "../test/blobs";
import { getPage, listPages } from "./service";

const ctx: ToolContext = { siteUrl: "https://example.com" };

async function raw(name: string, args: Record<string, unknown> = {}): Promise<any> {
  return TOOLS.find((t) => t.name === name)!.handler(args, ctx);
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const tool = TOOLS.find((t) => t.name === name)!;
  return tool.render(await tool.handler(args, ctx));
}

function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return handle(new Request(`https://example.com${path}`, { headers }));
}

let cookie: string;

beforeEach(async () => {
  resetBlobs();
  await completeSetup("correct horse battery");
  cookie = (await createSessionCookie((await getOwner())!)).split(";")[0];
  await raw("publish_page", { path: "/essay", content: "# Live\n\nThe live line.\n", meta: { date: "2026-01-01" } });
});

describe("a working copy", () => {
  it("is written by a draft update while readers keep the live page", async () => {
    const reply = await raw("update_page", { path: "/essay", content: "# Revised", meta: { date: "2026-02-02" }, draft: true });

    expect(reply.preview_url).toBe("https://example.com/essay?preview");
    expect(await (await get("/essay")).text()).toContain("The live line.");
    const page = (await getPage("/essay"))!;
    expect(page.body).toBe("# Live\n\nThe live line.\n");
    expect(page.meta).toEqual({ date: "2026-01-01" });
    expect(page.draft!.meta).toEqual({ date: "2026-02-02" });
  });

  it("is edited in place by a draft edit, starting from the live page", async () => {
    await raw("edit_page", { path: "/essay", find: "The live line.", replace: "A draft line.", draft: true });
    await raw("edit_page", { path: "/essay", find: "# Live", replace: "# Draft", draft: true });

    expect((await raw("get_page", { path: "/essay", draft: true })).content).toBe("# Draft\n\nA draft line.\n");
    expect((await raw("get_page", { path: "/essay" })).content).toBe("# Live\n\nThe live line.\n");
  });

  it("is shown in listings as a flag, never as its content", async () => {
    await raw("update_page", { path: "/essay", content: "# Revised", draft: true });
    const [summary] = await listPages();
    expect(summary.hasDraft).toBe(true);
    expect(summary.title).toBe("Live");
    expect((await raw("list_pages")).pages[0].has_draft).toBe(true);
  });

  it("goes live on publish_draft and is cleared", async () => {
    await raw("update_page", { path: "/essay", content: "# Revised", meta: { date: "2026-02-02" }, draft: true });
    await raw("publish_draft", { path: "/essay" });

    const page = (await getPage("/essay"))!;
    expect(page.body).toBe("# Revised");
    expect(page.title).toBe("Live");
    expect(page.meta).toEqual({ date: "2026-02-02" });
    expect(page.draft).toBeNull();
    expect(await (await get("/essay")).text()).toContain("<h1>Revised</h1>");
  });

  it("is thrown away by discard_draft, leaving the live page alone", async () => {
    await raw("update_page", { path: "/essay", content: "# Revised", draft: true });
    expect(await call("discard_draft", { path: "/essay" })).toBe("Discarded the working copy of /essay");
    expect(await call("discard_draft", { path: "/essay" })).toBe("/essay had no working copy");
    expect((await getPage("/essay"))!.body).toBe("# Live\n\nThe live line.\n");
  });

  it("survives a direct write to the live page", async () => {
    await raw("update_page", { path: "/essay", content: "# Revised", draft: true });
    await raw("update_page", { path: "/essay", meta: { date: "2026-03-03" } });
    expect((await getPage("/essay"))!.draft!.body).toBe("# Revised");
  });

  it("travels with a move", async () => {
    await raw("update_page", { path: "/essay", content: "# Revised", draft: true });
    await raw("move_page", { from: "/essay", to: "/essays/one" });
    expect((await getPage("/essays/one"))!.draft!.body).toBe("# Revised");
  });

  it("refuses to publish or read what does not exist", async () => {
    await expect(raw("publish_draft", { path: "/essay" })).rejects.toThrow("has no working copy");
    await expect(raw("get_page", { path: "/essay", draft: true })).rejects.toThrow("has no working copy");
    await expect(raw("update_page", { path: "/nope", content: "# x", draft: true })).rejects.toThrow("No page exists");
  });
});

describe("?preview", () => {
  beforeEach(async () => {
    await raw("update_page", { path: "/essay", content: "# Revised\n\n```pages\n{{ page.meta.date }}\n```", meta: { date: "2026-02-02" }, draft: true });
  });

  it("renders the working copy for the owner, templates included, and stores it nowhere", async () => {
    const response = await get("/essay?preview", { cookie });
    const body = await response.text();

    expect(body).toContain("<h1>Revised</h1>");
    expect(body).toContain("2026-02-02");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("netlify-cdn-cache-control")).toBeNull();
  });

  it("opens to a bearer token too", async () => {
    const { secret } = await mintToken("preview", "read");
    expect(await (await get("/essay?preview", { authorization: `Bearer ${secret}` })).text()).toContain("Revised");
  });

  it("is the live page to anybody else, exactly as if they had not asked", async () => {
    const asked = await get("/essay?preview");
    const plain = await get("/essay");
    expect(await asked.text()).toBe(await plain.text());
    expect(asked.headers.get("etag")).toBe(plain.headers.get("etag"));
  });

  it("shows the live page when there is no working copy", async () => {
    await raw("discard_draft", { path: "/essay" });
    expect(await (await get("/essay?preview", { cookie })).text()).toContain("The live line.");
  });

  it("previews the home page at /", async () => {
    await raw("publish_page", { path: "/root", content: "# Home" });
    await raw("update_page", { path: "/root", content: "# New home", draft: true });
    expect(await (await get("/?preview", { cookie })).text()).toContain("New home");
    expect(await (await get("/")).text()).not.toContain("New home");
  });
});

describe("the editor", () => {
  function save(fields: Record<string, string>): Promise<Response> {
    return handle(
      new Request("https://example.com/admin/pages/save", {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
      }),
    );
  }
  const fields = { path: "/essay", format: "markdown", title: "Live", meta: "date: 2026-01-01" };

  it("saves a draft, shows it on return, and publishes what the form holds", async () => {
    await save({ ...fields, content: "# Working", action: "draft" });
    expect((await getPage("/essay"))!.body).toBe("# Live\n\nThe live line.\n");

    const screen = await (await get("/admin/pages/edit?path=%2Fessay", { cookie })).text();
    expect(screen).toContain("Unpublished changes");
    expect(screen).toContain('href="/essay?preview"');
    expect(screen).toContain("# Working</textarea>");
    expect(screen).toContain("Discard the working copy and keep /essay as it is live");

    await save({ ...fields, content: "# Final", action: "publish" });
    const page = (await getPage("/essay"))!;
    expect(page.body).toBe("# Final");
    expect(page.draft).toBeNull();
  });

  it("marks a page with a working copy on the Pages screen", async () => {
    await save({ ...fields, content: "# Working", action: "draft" });
    expect(await (await get("/admin", { cookie })).text()).toContain('<span class="pill warn">draft</span>');
  });

  it("discards from the working copy panel", async () => {
    await save({ ...fields, content: "# Working", action: "draft" });
    await handle(
      new Request("https://example.com/admin/pages/discard", {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ path: "/essay" }).toString(),
      }),
    );
    expect((await getPage("/essay"))!.draft).toBeNull();
  });
});
