import { beforeEach, describe, expect, it } from "vitest";
import { handle } from "../app";
import { completeSetup } from "../auth/setup";
import { saveCollection } from "../data/service";
import { TOOLS, type ToolContext } from "../mcp/tools";
import { handlePage } from "../pages/handler";
import { savePage } from "../pages/service";
import { resetBlobs } from "../test/blobs";

const ctx: ToolContext = { siteUrl: "https://example.com" };

async function raw(name: string, args: Record<string, unknown> = {}): Promise<any> {
  return TOOLS.find((t) => t.name === name)!.handler(args, ctx);
}

const visit = async (path: string) => (await handlePage(new Request(`https://example.com${path}`))).text();

function fence(source: string): string {
  return "```pages\n" + source + "\n```";
}

function markdown(path: string, body: string, meta: Record<string, string> = {}) {
  return savePage({ path, contentType: "markdown", title: path, body, meta });
}

beforeEach(async () => {
  resetBlobs();
  await markdown("/essay/one", "# One", { kind: "essay", date: "2026-01-01", dek: "First" });
  await markdown("/essay/two", "# Two", { kind: "essay", date: "2026-03-01", dek: "Second" });
  await markdown("/note/three", "# Three", { kind: "note", date: "2026-02-01" });
});

describe("a pages fence", () => {
  it("queries the site's pages by meta, sorted and limited", async () => {
    await markdown(
      "/list",
      `# Essays\n\n${fence(`{% assign essays = site.pages | where: "meta.kind", "essay" | sort: "meta.date" | reverse %}<ul>{% for p in essays limit: 1 %}<li><a href="{{ p.path }}">{{ p.meta.dek }}</a></li>{% endfor %}</ul>`)}\n\nAfter.`,
    );
    const body = await visit("/list");

    expect(body).toContain('<ul><li><a href="/essay/two">Second</a></li></ul>');
    expect(body).not.toContain("First");
    expect(body).toContain("<h1>Essays</h1>");
    expect(body).toContain("<p>After.</p>");
  });

  it("reads a collection by its path, in collection order", async () => {
    await saveCollection("/trip/stops", [
      { id: "b", name: "Bern" },
      { id: "a", name: "Aarau" },
    ]);
    await markdown("/trip", fence(`{% for s in collections["/trip/stops"] %}[{{ s.name }}]{% endfor %}`));
    expect(await visit("/trip")).toContain("[Bern][Aarau]");
  });

  it("sees the page it is on", async () => {
    await markdown("/me", fence("{{ page.path }} {{ page.meta.kind }}"), { kind: "self" });
    expect(await visit("/me")).toContain("/me self");
  });

  it("escapes what it prints unless told not to", async () => {
    await saveCollection("/x", [{ id: "a", name: "<b>bold</b>" }]);
    await markdown("/esc", fence(`{{ collections["/x"][0].name }}|{{ collections["/x"][0].name | raw }}`));
    expect(await visit("/esc")).toContain("&lt;b&gt;bold&lt;/b&gt;|<b>bold</b>");
  });

  it("renders a named template stored as a page", async () => {
    await savePage({ path: "/root/t/card", contentType: "html", title: "card", body: "<div>{{ p.title }}</div>" });
    await markdown(
      "/cards",
      fence(`{% for p in site.pages %}{% if p.meta.kind == "note" %}{% render "/root/t/card", p: p %}{% endif %}{% endfor %}`),
    );
    expect(await visit("/cards")).toContain("<div>/note/three</div>");
  });

  it("costs only its own block when it fails", async () => {
    await markdown("/broken", `# Still here\n\n${fence("{{ x | nosuchfilter }}")}`);
    const body = await visit("/broken");
    expect(body).toContain("<h1>Still here</h1>");
    expect(body).toContain('<pre class="pages-error">Template error: undefined filter: nosuchfilter');
  });

  it("stops a loop nobody meant to write", async () => {
    await markdown("/loop", fence("{% for i in (1..100000000) %}x{% endfor %}"));
    expect(await visit("/loop")).toContain("Template error");
  });

  it("is left alone in an html page, which is verbatim", async () => {
    const body = `<!doctype html>\n${fence("{{ page.path }}")}`;
    await savePage({ path: "/verbatim", contentType: "html", title: "v", body });
    expect(await visit("/verbatim")).toBe(body);
  });

  it("leaves an ordinary code block alone", async () => {
    await markdown("/code", "```liquid\n{{ page.path }}\n```");
    expect(await visit("/code")).toContain("{{ page.path }}");
  });
});

// A public response is cached at the edge for everyone, so what it may read is only what is public.
describe("what a template may read", () => {
  beforeEach(async () => {
    await markdown("/trip/secret", "# Secret", { kind: "essay" });
    await saveCollection("/trip/stops", [{ id: "a", name: "Hidden stop" }]);
    await raw("set_privacy", { path: "/trip", private: true });
  });

  it("leaves private pages and collections out of a public page", async () => {
    await markdown(
      "/public",
      fence(`{% for p in site.pages %}{{ p.path }};{% endfor %}|{{ collections["/trip/stops"] | size }}`),
    );
    const body = await visit("/public");
    expect(body).not.toContain("/trip/secret");
    expect(body).toContain("/essay/one;");
    expect(body).toContain("|0");
  });

  it("refuses a named template stored under a private path", async () => {
    await savePage({ path: "/trip/card", contentType: "html", title: "card", body: "PRIVATE" });
    await markdown("/public", fence(`{% render "/trip/card" %}`));
    const body = await visit("/public");
    expect(body).not.toContain("PRIVATE");
    expect(body).toContain("Template error");
  });

  it("lets a page read what shares its own private scope, for a visitor holding its link", async () => {
    await completeSetup("correct horse battery");
    await markdown("/trip/day1", fence(`{{ collections["/trip/stops"][0].name }}`));
    const link = (await raw("share_path", { path: "/trip", label: "x" })).link as string;
    const unlocked = await handle(new Request("https://example.com/_unlock", { method: "POST", body: link.split("#")[1] }));
    const cookie = unlocked.headers.get("set-cookie")!.split(";")[0];

    const body = await (await handle(new Request("https://example.com/trip/day1", { headers: { cookie } }))).text();
    expect(body).toContain("Hidden stop");
  });
});

describe("chrome templates", () => {
  it("render with the page they wrap and the site around it", async () => {
    await savePage({
      path: "/root/chrome/header",
      contentType: "html",
      title: "header",
      body: `<nav>{{ page.title }} of {{ site.title }}: {% for p in site.pages %}{% if p.meta.kind == "essay" %}{{ p.path }} {% endif %}{% endfor %}</nav>`,
    });
    await raw("set_site_info", { title: "Sean", header: "/root/chrome/header" });

    expect(await visit("/note/three")).toContain("<nav>/note/three of Sean: /essay/one /essay/two </nav>");
  });
});

// The bytes change when anything a template read changes, and nothing on the page itself did.
// A page that lists other pages is rendered on the server, so its edge copy has to go when any
// other page changes. It does because every public response carries the one tag the blind purge
// clears, and a write anywhere fires that purge; this pins both halves of that.
describe("a page built from other pages", () => {
  it("shares the one cache tag every write clears, and renders the change on its next request", async () => {
    await markdown("/list", fence(`{% for p in site.pages %}{{ p.path }};{% endfor %}`));
    const before = await handlePage(new Request("https://example.com/list"));
    const other = await handlePage(new Request("https://example.com/essay/one"));
    expect(before.headers.get("netlify-cache-tag")).toBe(other.headers.get("netlify-cache-tag"));
    expect(await before.text()).not.toContain("/essay/four");

    await raw("publish_page", { path: "/essay/four", content: "# Four" });
    expect(await visit("/list")).toContain("/essay/four;");
  });
});

describe("the tag of a page with a fence", () => {
  it("moves when another page is published", async () => {
    await markdown("/list", fence(`{% for p in site.pages %}{{ p.path }};{% endfor %}`));
    const before = (await handlePage(new Request("https://example.com/list"))).headers.get("etag");
    await markdown("/essay/four", "# Four");
    const after = (await handlePage(new Request("https://example.com/list"))).headers.get("etag");
    expect(after).not.toBe(before);
  });
});
