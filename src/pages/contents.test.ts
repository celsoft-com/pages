import { beforeEach, describe, expect, it } from "vitest";
import { TOOLS, type ToolContext } from "../mcp/tools";
import { resetBlobs } from "../test/blobs";
import { saveSettings } from "../settings";
import { handlePage } from "./handler";
import { savePage } from "./service";

const ctx: ToolContext = { siteUrl: "https://example.com" };

beforeEach(resetBlobs);

// Goes through the renderer, so every reply pinned in this file is still the text a client gets.
async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`No tool named ${name}`);
  return tool.render(await tool.handler(args, ctx));
}

function root(): Promise<Response> {
  return handlePage(new Request("https://example.com/"));
}

describe("the contents page", () => {
  it("lists pages in path order, whatever order they were published in", async () => {
    await savePage({ path: "/zebra", contentType: "markdown", title: "Zebra", body: "# Zebra" });
    await savePage({ path: "/apple", contentType: "markdown", title: "Apple", body: "# Apple" });

    const body = await (await root()).text();
    expect(body.indexOf("Apple")).toBeLessThan(body.indexOf("Zebra"));
  });

  it("carries the site title and description, like any other page", async () => {
    await saveSettings({ title: "Odell Family", description: "Trips and things" });
    const body = await (await root()).text();

    expect(body).toContain("Odell Family");
    expect(body).toContain("Trips and things");
  });

  it("escapes a title, because a page names itself", async () => {
    await savePage({ path: "/x", contentType: "html", title: "<script>alert(1)</script>", body: "hi" });
    expect(await (await root()).text()).not.toContain("<script>alert(1)</script>");
  });

  // It is public and overwritable by the owner, so it caches exactly like a published page.
  it("is cached at the edge and revalidated by a browser", async () => {
    const response = await root();
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("netlify-cache-tag")).toBe("content");
  });

  it("changes its etag when the list changes", async () => {
    const before = (await root()).headers.get("etag");
    await savePage({ path: "/new", contentType: "markdown", title: "New", body: "# New" });
    expect((await root()).headers.get("etag")).not.toBe(before);
  });
});

describe("closing the contents", () => {
  // /root names it, but a recipient opens /, and a share link has to be the URL they open.
  it("is addressed by the URL a visitor opens", async () => {
    expect(JSON.parse(await call("set_privacy", { path: "/root", private: true })).url).toBe("https://example.com");

    const shared = JSON.parse(await call("share_path", { path: "/root", label: "Dana" }));
    expect(shared.link.split("#")[0]).toBe("https://example.com");
  });
});

// The tools have to say what / is, not that nothing is there: a client told a page is missing
// publishes one.
describe("a tool aimed at the site root", () => {
  it("says the contents is generated rather than that nothing is published", async () => {
    for (const [name, args] of [
      ["get_page", { path: "/root" }],
      ["update_page", { path: "/root", content: "# Mine" }],
      ["edit_page", { path: "/root", find: "a", replace: "b" }],
      ["delete_page", { path: "/root" }],
    ] as const) {
      await expect(call(name, args)).rejects.toThrow(/site contents/);
    }
  });
});
