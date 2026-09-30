import { beforeEach, describe, expect, it } from "vitest";
import { handle } from "../app";
import { createSessionCookie } from "../auth/session";
import { completeSetup, getOwner } from "../auth/setup";
import { getPage, savePage } from "../pages/service";
import { resetBlobs } from "../test/blobs";

let cookie: string;

beforeEach(async () => {
  resetBlobs();
  await completeSetup("correct horse battery");
  cookie = (await createSessionCookie((await getOwner())!)).split(";")[0];
  await savePage({ path: "/trip", contentType: "markdown", title: "Trip", body: "# Trip" });
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

// Until a home page is written, / is generated, and the row offers access and a way to write one.
describe("the contents row on the Pages screen", () => {
  it("offers to write a home page, and nothing to delete", async () => {
    const body = await (await get("/admin")).text();

    expect(body).toContain("Contents");
    expect(body).toContain("Every public page, listed automatically.");
    expect(body).toContain('href="/admin/pages/edit?path=%2Froot">Write a home page</a>');
    expect(body).not.toContain("Delete the home page");
  });

  it("becomes the home page once one is stored, with a delete that says what comes back", async () => {
    await savePage({ path: "/root", contentType: "markdown", title: "Welcome", body: "# Welcome" });
    const body = await (await get("/admin")).text();

    expect(body).toContain('href="/admin/pages/edit?path=%2Froot">Welcome</a>');
    expect(body).toContain("Delete the home page and list every page at / again");
    expect(body).not.toContain("Every public page, listed automatically.");
  });

  it("offers the same access control as any other row", async () => {
    expect(await (await get("/admin")).text()).toContain('value="/root"');

    await post("/admin/pages/private", { path: "/root", return: "/admin" });
    const body = await (await get("/admin")).text();

    expect(body).toContain("/admin/pages/access?path=%2Froot");
    expect(body).not.toContain("Private paths with no page");
  });

  it("names the path a visitor sees, not the one it is stored under", async () => {
    await post("/admin/pages/private", { path: "/root", return: "/admin" });
    const body = await (await get("/admin/pages/access?path=%2Froot")).text();

    expect(body).toContain("The site contents is closed");
    expect(body).not.toContain("No page is published at this path");
  });
});

describe("the page editor", () => {
  it("turns away /, and names /root instead", async () => {
    const response = await get("/admin/pages/edit?path=%2F");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("stored+at+%2Froot");
  });

  it("opens a new page already at /root", async () => {
    expect(await (await get("/admin/pages/edit?path=%2Froot")).text()).toContain('value="/root"');
  });

  it("saves a home page that / then serves", async () => {
    await post("/admin/pages/save", { path: "/root", format: "markdown", content: "# Mine" });

    expect((await getPage("/root"))!.body).toBe("# Mine");
    expect(await (await get("/")).text()).toContain("Mine");
  });
});
