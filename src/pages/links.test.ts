import { beforeEach, describe, expect, it } from "vitest";
import { putAsset } from "../assets/service";
import { saveCollection } from "../data/service";
import { TOOLS, type ToolContext } from "../mcp/tools";
import { resetBlobs } from "../test/blobs";
import { savePage } from "./service";

const ctx: ToolContext = { siteUrl: "https://example.com" };

async function raw(name: string, args: Record<string, unknown> = {}): Promise<any> {
  return TOOLS.find((t) => t.name === name)!.handler(args, ctx);
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const tool = TOOLS.find((t) => t.name === name)!;
  return tool.render(await tool.handler(args, ctx));
}

function markdown(path: string, body: string) {
  return savePage({ path, contentType: "markdown", title: path, body });
}

beforeEach(async () => {
  resetBlobs();
  await markdown("/about", "# About");
  await saveCollection("/trip/stops", [{ id: "a" }]);
  await putAsset({
    filename: "photo.jpg",
    contentType: "image/jpeg",
    bytes: new TextEncoder().encode("JPEG").buffer,
    path: "/trip/images/photo.jpg",
  });
});

describe("check_links", () => {
  it("resolves pages, assets, collections and the app's own routes", async () => {
    await markdown(
      "/trip",
      [
        "[about](/about#team) [home](/) [root](/root) [docs](/docs/pages) [admin](/admin)",
        '<img src="/assets/trip/images/photo.jpg"> <a href="/About.html?x=1">',
        "fetch('/data/trip/stops.json') [index](/data/_collections.json) [icon](/favicon.ico)",
      ].join("\n"),
    );
    const report = await raw("check_links");
    expect(report.broken).toEqual([]);
    expect(report.links).toBe(10);
  });

  it("names the page, the line and the link as written for every miss", async () => {
    await markdown("/trip", "fine [about](/about)\n[old](/trip/day1) and ![](/assets/trip/images/gone.jpg)\n<a href='/data/trip/nope.json'>");
    expect((await raw("check_links")).broken).toEqual([
      { path: "/trip", line: 2, link: "/trip/day1" },
      { path: "/trip", line: 2, link: "/assets/trip/images/gone.jpg" },
      { path: "/trip", line: 3, link: "/data/trip/nope.json" },
    ]);
  });

  it("reports a link a move left behind", async () => {
    await markdown("/index-page", "[trip](/trip)");
    await markdown("/trip", "# Trip");
    await raw("move_page", { from: "/trip", to: "/journey" });
    expect(await call("check_links")).toBe("Checked 1 links in 3 pages. 1 point at nothing:\n/index-page:1  /trip");
  });

  it("finds a collection a script fetches, but not one it builds from pieces", async () => {
    await markdown("/x", "fetch('/data/trip/gone.json'); fetch(BASE + 'items.json'); const u = `/data/trip/stops.json`;");
    expect((await raw("check_links")).broken).toEqual([{ path: "/x", line: 1, link: "/data/trip/gone.json" }]);
  });

  it("does not count a link to another site or one it cannot read", async () => {
    await markdown("/x", "[out](https://example.org/x) [proto](//cdn.example/x) <a href=\"{{ p.path }}\">");
    expect(await call("check_links")).toContain("nothing was checked");
  });

  it("reads stored templates, which are pages", async () => {
    await savePage({ path: "/root/chrome/header", contentType: "html", title: "h", body: '<a href="/missing">' });
    expect((await raw("check_links")).broken).toEqual([{ path: "/root/chrome/header", line: 1, link: "/missing" }]);
  });
});
