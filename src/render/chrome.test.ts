import { beforeEach, describe, expect, it } from "vitest";
import { handle } from "../app";
import { createSessionCookie } from "../auth/session";
import { completeSetup, getOwner } from "../auth/setup";
import { TOOLS, type ToolContext } from "../mcp/tools";
import { handlePage } from "../pages/handler";
import { savePage } from "../pages/service";
import { getSettings } from "../settings";
import { resetBlobs } from "../test/blobs";

const ctx: ToolContext = { siteUrl: "https://example.com" };

async function raw(name: string, args: Record<string, unknown> = {}): Promise<any> {
  return TOOLS.find((t) => t.name === name)!.handler(args, ctx);
}

const visit = (path: string) => handlePage(new Request(`https://example.com${path}`));

function template(path: string, body: string) {
  return savePage({ path, contentType: "html", title: path, body });
}

beforeEach(async () => {
  resetBlobs();
  await savePage({ path: "/notes", contentType: "markdown", title: "Notes", body: "# Notes" });
  await template("/root/chrome/header", '<nav class="mine"><a href="/notes">Notes</a></nav>');
  await template("/root/chrome/footer", "<footer>Mine</footer>");
});

describe("site chrome", () => {
  it("puts the owner's head after the built-in styles, and their templates in place of the built-in header and footer", async () => {
    await raw("set_site_info", {
      head: '<link rel="stylesheet" href="/assets/root/app.css">',
      header: "/root/chrome/header",
      footer: "/root/chrome/footer",
    });
    const body = await (await visit("/notes")).text();

    expect(body.indexOf("/assets/root/app.css")).toBeGreaterThan(body.indexOf("<style>"));
    expect(body).toContain('<nav class="mine">');
    expect(body).toContain("<footer>Mine</footer>");
    expect(body).not.toContain('class="brand"');
    expect(body).not.toContain("Published with");
  });

  it("with theme none, is the whole page around the content", async () => {
    await raw("set_site_info", { theme: "none", header: "/root/chrome/header" });
    const body = await (await visit("/notes")).text();

    expect(body).not.toContain("<style>");
    expect(body).not.toContain('class="wrap"');
    expect(body).not.toContain("Published with");
    expect(body).toContain('</nav>\n<main><h1>Notes</h1>');
  });

  it("keeps a field it was not given, and empty brings the built-in one back", async () => {
    await raw("set_site_info", { header: "/root/chrome/header", footer: "/root/chrome/footer" });
    await raw("set_site_info", { header: "" });
    const settings = await getSettings();

    expect(settings.footer).toBe("/root/chrome/footer");
    expect(await (await visit("/notes")).text()).toContain('class="brand"');
  });

  it("never touches an html page", async () => {
    await savePage({ path: "/raw", contentType: "html", title: "Raw", body: "<!doctype html><p>raw</p>" });
    await raw("set_site_info", { head: "<script>injected</script>", theme: "none" });
    expect(await (await visit("/raw")).text()).toBe("<!doctype html><p>raw</p>");
  });

  it("refuses a template name with nothing stored there", async () => {
    await expect(raw("set_site_info", { header: "/root/chrome/nav" })).rejects.toThrow(
      "No page is stored at /root/chrome/nav to use as the header",
    );
  });

  it("follows an edit to the template on the next request", async () => {
    await raw("set_site_info", { footer: "/root/chrome/footer" });
    await template("/root/chrome/footer", "<footer>Edited</footer>");
    expect(await (await visit("/notes")).text()).toContain("<footer>Edited</footer>");
  });

  it("renders the built-in piece when a named template has gone", async () => {
    await raw("set_site_info", { header: "/root/chrome/header" });
    await raw("delete_page", { path: "/root/chrome/header" });
    expect(await (await visit("/notes")).text()).toContain('class="brand"');
  });

  it("refuses a theme it does not know", async () => {
    await expect(raw("set_site_info", { theme: "dark" })).rejects.toThrow('"default" or "none"');
  });

  // The page's own updatedAt does not move when the header does, so the tag has to carry both, or
  // a browser revalidating would be told its copy with the old header is current.
  it("moves the tag of a themed page and of the contents when the chrome or a template changes", async () => {
    await raw("set_site_info", { footer: "/root/chrome/footer" });
    const page = (await visit("/notes")).headers.get("etag");
    const contents = (await visit("/")).headers.get("etag");
    await template("/root/chrome/footer", "<footer>new</footer>");

    const edited = (await visit("/notes")).headers.get("etag");
    expect(edited).not.toBe(page);
    expect((await visit("/")).headers.get("etag")).not.toBe(contents);

    await raw("set_site_info", { head: "<meta name=x>" });
    expect((await visit("/notes")).headers.get("etag")).not.toBe(edited);
  });

  it("wraps a missing page and a private one in the same bytes", async () => {
    await raw("set_site_info", { header: "/root/chrome/header" });
    await raw("set_privacy", { path: "/notes", private: true });

    const missing = await visit("/nope");
    const closed = await visit("/notes");
    expect(await closed.text()).toBe((await missing.text()).replace("/nope", "/notes"));
  });
});

describe("site chrome in the admin", () => {
  let cookie: string;

  beforeEach(async () => {
    await completeSetup("correct horse battery");
    cookie = (await createSessionCookie((await getOwner())!)).split(";")[0];
  });

  it("saves from the settings screen and shows what it saved", async () => {
    await handle(
      new Request("https://example.com/admin/settings/chrome", {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ theme: "none", head: "<b>hi</b>", header: "/Root/Chrome/Header", footer: "" }).toString(),
      }),
    );
    const settings = await getSettings();
    expect(settings.theme).toBe("none");
    expect(settings.header).toBe("/root/chrome/header");

    const screen = await (await handle(new Request("https://example.com/admin/settings", { headers: { cookie } }))).text();
    expect(screen).toContain("&lt;b&gt;hi&lt;/b&gt;</textarea>");
    expect(screen).toContain('value="/root/chrome/header"');
    expect(screen).toContain('<option value="none" selected>');
  });

  it("says why it refused a template name, and saves nothing", async () => {
    const response = await handle(
      new Request("https://example.com/admin/settings/chrome", {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ theme: "none", head: "", header: "/nope", footer: "" }).toString(),
      }),
    );
    expect(response.headers.get("location")).toContain("No+page+is+stored+at+%2Fnope");
    expect((await getSettings()).theme).toBe("default");
  });
});
