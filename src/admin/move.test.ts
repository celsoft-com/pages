import { beforeEach, describe, expect, it } from "vitest";
import { handle } from "../app";
import { putAsset } from "../assets/service";
import { createSessionCookie } from "../auth/session";
import { completeSetup, getOwner } from "../auth/setup";
import { getCollection, saveCollection } from "../data/service";
import { getPage, savePage } from "../pages/service";
import { resetBlobs } from "../test/blobs";

const BODY =
  '<!doctype html>\n<script>\nconst BASE = "/data/trip/";\nfetch(BASE + "items.json");\n' +
  '</script>\n<img src="/assets/trip/images/coburg.jpg">\n';

let cookie: string;

beforeEach(async () => {
  resetBlobs();
  await completeSetup("correct horse battery");
  cookie = (await createSessionCookie((await getOwner())!)).split(";")[0];

  await savePage({ path: "/trip", contentType: "html", title: "Trip", body: BODY });
  await saveCollection("/trip/items", [{ id: "muc", name: "München" }]);
  await putAsset({
    filename: "coburg.jpg",
    contentType: "image/jpeg",
    bytes: new TextEncoder().encode("PICTURE").buffer,
    path: "/trip/images/coburg.jpg",
  });
});

function get(path: string): Promise<Response> {
  return handle(new Request(`https://example.com${path}`, { headers: { cookie } }));
}

function post(path: string, fields: Record<string, string>): Promise<Response> {
  return handle(
    new Request(`https://example.com${path}`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    }),
  );
}

function editor(path: string): Promise<Response> {
  return get(`/admin/pages/edit?path=${encodeURIComponent(path)}`);
}

// Retyping the path in the editor used to write a new page and delete the old one, which stranded
// every collection and file under the old path, lost the page's own createdAt, and said nothing.
describe("the editor does not rename", () => {
  it("shows the path as a fact and sends a change to the move screen", async () => {
    const body = await (await editor("/trip")).text();
    const content = body.slice(body.indexOf('action="/admin/pages/save"'));

    expect(content).not.toContain('name="path" type="text"');
    expect(content).toContain('<input type="hidden" name="path" value="/trip">');
    expect(content).toContain("/admin/pages/move?path=%2Ftrip");
    expect(content).toContain("Move or rename");
  });

  it("still asks a new page for its path", async () => {
    const body = await (await get("/admin/pages/edit")).text();

    expect(body).toContain('id="path" name="path" type="text"');
    expect(body).not.toContain("/admin/pages/move");
  });

  it("deletes nothing when a save arrives naming another path", async () => {
    await post("/admin/pages/save", {
      path: "/elsewhere",
      original: "/trip",
      format: "html",
      title: "Trip",
      content: BODY,
    });

    expect(await getPage("/trip")).not.toBeNull();
    expect(await getPage("/elsewhere")).not.toBeNull();
  });
});

describe("the move screen", () => {
  it("defaults to the whole bundle and names what comes along", async () => {
    const body = await (await get("/admin/pages/move?path=%2Ftrip")).text();
    const bundle = body.slice(body.indexOf('value="bundle"'), body.indexOf('value="page"'));

    expect(bundle).toContain("checked");
    expect(body).toContain("1 collection and 1 asset");
    expect(body).toContain("/trip/items");
    expect(body).toContain("/trip/images/coburg.jpg");
  });

  it("says what a page-only move leaves behind", async () => {
    const body = await (await get("/admin/pages/move?path=%2Ftrip")).text();

    expect(body).toContain("Move only the page");
    expect(body).toContain("stays behind at its old URL");
  });

  it("warns that moving the home page empties the site root", async () => {
    await savePage({ path: "/root", contentType: "markdown", title: "Home", body: "# Home" });
    const body = await (await get("/admin/pages/move?path=%2Froot")).text();

    expect(body).toContain("no home page");
  });

  it("turns away a path with no page", async () => {
    const response = await get("/admin/pages/move?path=%2Fnope");

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("nothing+to+move");
  });
});

describe("a bundle move", () => {
  it("takes the collection and the asset with the page", async () => {
    const response = await post("/admin/pages/move", { from: "/trip", to: "/travel", scope: "bundle" });

    expect(response.status).toBe(200);
    expect(await getPage("/trip")).toBeNull();
    expect(await getPage("/travel")).not.toBeNull();
    expect(await getCollection("/trip/items")).toBeNull();
    expect((await getCollection("/travel/items"))!.items[0].id).toBe("muc");
    expect((await handle(new Request("https://example.com/assets/travel/images/coburg.jpg"))).status).toBe(200);
    expect((await handle(new Request("https://example.com/assets/trip/images/coburg.jpg"))).status).toBe(404);
  });

  it("lists the page lines still naming the old path, having changed none of them", async () => {
    const body = await (await post("/admin/pages/move", { from: "/trip", to: "/travel", scope: "bundle" })).text();

    expect(body).toContain("No page content was changed");
    expect(body).toContain("const BASE = &quot;/data/trip/&quot;");
    expect((await getPage("/travel"))!.body).toBe(BODY);
  });

  it("rewrites its history entry to the editor at the new path", async () => {
    const body = await (await post("/admin/pages/move", { from: "/trip", to: "/travel", scope: "bundle" })).text();

    expect(body).toContain('history.replaceState(null,"","/admin/pages/edit?path=%2Ftravel")');
  });

  it("refuses an occupied path and changes nothing until overwrite is asked for", async () => {
    await savePage({ path: "/travel", contentType: "markdown", title: "Held", body: "# Held" });

    const refused = await post("/admin/pages/move", { from: "/trip", to: "/travel", scope: "bundle" });
    expect(refused.status).toBe(303);
    expect(refused.headers.get("location")).toContain("already+exists");
    expect(await getPage("/trip")).not.toBeNull();
    expect((await getPage("/travel"))!.title).toBe("Held");

    await post("/admin/pages/move", { from: "/trip", to: "/travel", scope: "bundle", overwrite: "1" });
    expect(await getPage("/trip")).toBeNull();
    expect((await getPage("/travel"))!.title).toBe("Trip");
  });

  it("refuses a target inside the path it is moving", async () => {
    const response = await post("/admin/pages/move", { from: "/trip", to: "/trip/deeper", scope: "bundle" });

    expect(response.headers.get("location")).toContain("nested+inside");
    expect(await getPage("/trip")).not.toBeNull();
  });
});

describe("a page-only move", () => {
  it("leaves the rest of the bundle where it was and says so", async () => {
    const body = await (await post("/admin/pages/move", { from: "/trip", to: "/travel", scope: "page" })).text();

    expect(await getCollection("/trip/items")).not.toBeNull();
    expect(await getCollection("/travel/items")).toBeNull();
    expect(body).toContain("Left where it was");
    expect(body).toContain("/trip/items");
  });
});
