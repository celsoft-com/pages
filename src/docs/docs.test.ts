import { beforeEach, describe, expect, it } from "vitest";
import { handle } from "../app";
import { completeSetup } from "../auth/setup";
import { TOOLS } from "../mcp/tools";
import { savePage } from "../pages/service";
import { resetBlobs } from "../test/blobs";
import { exampleArgs } from "./example";
import { inputHtml, outputHtml } from "./schema";
import { PLACEHOLDER, fills, topics } from "./topics";

// docs/tools.md introduces the generated reference rather than standing alone, so it is served at
// /docs/tools under the sidebar entry the reference already has.
const REFERENCE = "tools";
const PAGES = topics().filter((topic) => topic.slug !== REFERENCE);

beforeEach(resetBlobs);

function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return handle(new Request(`https://example.com${path}`, { headers }));
}

async function body(path: string): Promise<string> {
  return (await get(path)).text();
}

function slug(group: string): string {
  return group.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

const GROUPS = [...new Set(TOOLS.map((tool) => tool.group))];

describe("the documentation is served with the site", () => {
  it("renders the README at /docs", async () => {
    const html = await body("/docs");
    expect(html).toContain("A website you talk to Claude to build.");
    expect(html).toContain("Not a static site generator");
    // The one relative link the README carries points at a file on GitHub and at a page here.
    expect(html).toContain('href="/docs/license"');
  });

  it("renders the licence at /docs/license", async () => {
    const html = await body("/docs/license");
    expect(html).toContain("MIT License");
    expect(html).toContain("WITHOUT WARRANTY OF ANY KIND");
  });

  it("puts every section in the sidebar of every page", async () => {
    const pages = ["/docs", "/docs/tools", "/docs/license", ...PAGES.map((t) => `/docs/${t.slug}`)];
    for (const path of pages) {
      const html = await body(path);
      for (const href of pages) expect(html, path).toContain(`href="${href}"`);
      for (const group of GROUPS) expect(html, path).toContain(`href="/docs/tools/${slug(group)}"`);
    }
  });

  // A site with no owner yet is exactly where the documentation gets read, and every other public
  // path redirects to the welcome screen until setup finishes.
  it("is readable before the site is set up", async () => {
    expect((await get("/docs")).status).toBe(200);
    expect((await get("/docs/tools")).status).toBe(200);
  });

  it("is public, cacheable at the edge and cleared with everything else", async () => {
    const response = await get("/docs");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("netlify-cache-tag")).toBe("content");
  });

  it("answers an unknown docs path with the documentation's own 404", async () => {
    const response = await get("/docs/nothing-here");
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("pages documentation");
  });

  it("takes GET, not POST", async () => {
    const response = await handle(new Request("https://example.com/docs", { method: "POST" }));
    expect(response.status).toBe(405);
  });

  it("claims the prefix on segment boundaries only", async () => {
    await completeSetup("correct horse battery");
    await savePage({ path: "/docserver", contentType: "html", title: "t", body: "DOCSERVER PAGE" });
    expect(await body("/docserver")).toBe("DOCSERVER PAGE");
    expect(await body("/docs")).toContain("pages documentation");
  });

  it("names the origin the visitor is on, not the one the function was handed", async () => {
    const forwarded = await (
      await get("/docs/api", { "x-forwarded-proto": "https", host: "example.com" })
    ).text();
    expect(forwarded).toContain("https://example.com/mcp");
  });
});

describe("a topic is a markdown file in docs/", () => {
  it("serves every one of them, titled by its frontmatter", async () => {
    for (const topic of PAGES) {
      const response = await get(`/docs/${topic.slug}`);
      expect(response.status, topic.slug).toBe(200);
      const html = await response.text();
      expect(html, topic.slug).toContain(`<title>${topic.title} · pages docs</title>`);
      expect(html, topic.slug).not.toContain("---\ntitle:");
    }
  });

  it("orders the sidebar by the order in the frontmatter", async () => {
    const html = await body("/docs");
    const positions = PAGES.map((topic) => html.indexOf(`href="/docs/${topic.slug}"`));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // Pinning the list of slugs here would churn on every topic added. What matters is that each
    // one says where it goes and no two claim the same place, so the order is always a decision.
    const orders = topics().map((topic) => topic.order);
    for (const topic of topics()) {
      expect(topic.title, `docs/${topic.slug}.md needs a title`).not.toBe(topic.slug);
      expect(Number.isFinite(topic.order), `docs/${topic.slug}.md needs an order`).toBe(true);
    }
    expect(new Set(orders).size, "two topics claim the same order").toBe(orders.length);
  });

  it("gives the reference its introduction instead of a page of its own", async () => {
    const intro = topics().find((topic) => topic.slug === REFERENCE)!;
    const html = await body("/docs/tools");
    expect(html).toContain("One API, two services in front of it.");
    // One entry in the sidebar, not two.
    expect(html.split(`href="/docs/tools"`).length - 1).toBe(1);
    expect(html).toContain(`<a href="/docs/tools" aria-current="page">${intro.title}</a>`);
  });

  // The one thing a topic takes from the code. A placeholder nobody implements would print itself
  // on the page, so an unknown one is a failure here instead.
  it("fills only placeholders the code supplies, and leaves none behind", async () => {
    const known = Object.keys(fills("https://example.com"));
    for (const topic of topics())
      for (const [, name] of topic.source.matchAll(PLACEHOLDER))
        expect(known, `${topic.slug}.md uses {{${name}}}`).toContain(name);

    for (const topic of PAGES) expect(await body(`/docs/${topic.slug}`), topic.slug).not.toContain("{{");
    expect(await body("/docs/tools")).not.toContain("{{");
  });

  it("links only to things the site serves", async () => {
    for (const topic of topics())
      for (const [, target] of topic.source.matchAll(/\]\(([^)]+)\)/g)) {
        if (/^(https?:|mailto:|#)/.test(target)) continue;
        const ok = /^\/docs(\/|#|$)/.test(target) || /^[A-Za-z0-9._-]+\.md(#.*)?$/.test(target);
        expect(ok, `docs/${topic.slug}.md links to ${target}`).toBe(true);
      }
  });

  it("turns a link between markdown files into a link between pages", async () => {
    // transfer.md links to bundles.md, which is a file in the folder and a page here.
    expect(await body("/docs/transfer")).toContain('href="/docs/bundles"');
    expect(await body("/docs/tools")).toContain('href="/docs/api"');
  });
});

describe("the tool reference comes from the registry", () => {
  it("documents every tool on its group's page, once", async () => {
    const pages = new Map<string, string>();
    for (const group of GROUPS) pages.set(group, await body(`/docs/tools/${slug(group)}`));

    for (const tool of TOOLS) {
      const page = pages.get(tool.group)!;
      expect(page, tool.name).toContain(`id="${tool.name}"`);
      expect(page, tool.name).toContain(`/api/v1/${tool.name}`);
      // The description is the tool's own text, so the reference cannot describe it differently.
      expect(page, tool.name).toContain(tool.description.slice(0, 60).replace(/&/g, "&amp;"));
    }
  });

  it("lists every tool on the index with its access level", async () => {
    const html = await body("/docs/tools");
    for (const tool of TOOLS) {
      expect(html, tool.name).toContain(`#${tool.name}"`);
      expect(html, tool.name).toContain(tool.title);
    }
    expect(html).toContain('<span class="pill read">read</span>');
    expect(html).toContain('<span class="pill write">write</span>');
  });

  it("shows one entry per tool with the call in both transports", async () => {
    const html = await body(`/docs/tools/${slug("Data")}`);
    // The same tool, once, with a tab each rather than a page each.
    expect(html.split('id="put_item"').length - 1).toBe(1);
    expect(html).toContain('id="call-put_item-mcp"');
    expect(html).toContain('id="call-put_item-rest"');
    expect(html).toContain('&quot;method&quot;: &quot;tools/call&quot;');
    expect(html).toContain("POST https://example.com/api/v1/put_item");
    expect(html).toContain("POST https://example.com/mcp");
    // Required arguments only, built from the schema the client is handed.
    expect(html).toContain("&quot;path&quot;: &quot;&lt;string&gt;&quot;");
    expect(html).not.toContain("&quot;merge&quot;:");
  });

  it("builds a nested example from the schema, down to an array of objects", async () => {
    const html = await body(`/docs/tools/${slug("Maps")}`);
    expect(html).toContain("&quot;lat&quot;: 0");
    expect(html).toContain("&quot;lon&quot;: 0");
    // profile is optional, so it stays out of the example and stays in the arguments table.
    expect(html).not.toContain("&quot;profile&quot;:");
    expect(html).toContain("cycling, walking or driving. Default cycling.");
  });

  it("uses an enum's own first value where one is required", () => {
    expect(
      exampleArgs({
        type: "object",
        properties: { mode: { type: "string", enum: ["safety", "speed"] } },
        required: ["mode"],
      }),
    ).toEqual({ mode: "safety" });
  });

  it("documents the arguments and the result of a tool from its schemas", async () => {
    const html = await body(`/docs/tools/${slug("Data")}`);
    expect(html).toContain("if_rev");
    expect(html).toContain("Refuse unless the collection is still at this rev.");
    // A result field, which exists nowhere but the outputSchema.
    expect(html).toContain("The item's new rev");
  });

  it("flattens a nested result onto dotted names", () => {
    const html = outputHtml(TOOLS.find((tool) => tool.name === "list_bundle")!.outputSchema);
    expect(html).toContain("collections[].refs");
    expect(html).toContain("object of string");
  });

  it("draws a branchy reply as one table per branch", () => {
    const html = outputHtml(TOOLS.find((tool) => tool.name === "get_page")!.outputSchema);
    expect(html).toContain("The whole page, when nothing narrowed the read");
    expect(html).toContain("Numbered lines, when find, offset or limit was passed");
    expect(html).toContain("lines[].line");
  });

  it("says a tool takes no arguments rather than drawing an empty table", () => {
    expect(inputHtml(TOOLS.find((tool) => tool.name === "list_pages")!.inputSchema)).toContain(
      "Takes no arguments.",
    );
  });
});

describe("the two services are one page, taking their facts from the code", () => {
  it("covers both doors in one topic rather than one each", async () => {
    const html = await body("/docs/api");
    // MCP: connector URL, protocol version, the OAuth documents, the instructions the site serves.
    expect(html).toContain("https://example.com/mcp");
    expect(html).toContain("2025-06-18");
    expect(html).toContain(".well-known/oauth-protected-resource");
    expect(html).toContain("Publish and edit pages on this site.");
    // REST: the base URL, a call, and the statuses a caller has to tell apart.
    expect(html).toContain("https://example.com/api/v1");
    expect(html).toContain("409");
    expect(html).toContain("403");
    expect(html).toContain("429");
  });

  it("leaves no page documenting one service's tools apart from the other's", async () => {
    expect((await get("/docs/mcp")).status).toBe(404);
    const sidebar = await body("/docs");
    expect(sidebar).not.toContain('href="/docs/mcp"');
  });
});
