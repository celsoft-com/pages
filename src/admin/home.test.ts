import { beforeEach, describe, expect, it } from "vitest";
import { handle } from "../app";
import { createSessionCookie } from "../auth/session";
import { completeSetup, getOwner } from "../auth/setup";
import { savePage } from "../pages/service";
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

// The site root is generated, so the admin offers exactly one thing about it: who may see it.
describe("the contents row on the Pages screen", () => {
  it("is there with no way to edit or delete it", async () => {
    const body = await (await get("/admin")).text();

    expect(body).toContain("Contents");
    expect(body).toContain("Every public page, listed automatically.");
    expect(body).not.toContain("/admin/pages/edit?path=%2Froot");
    expect(body).not.toContain("Delete /root");
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
  it("turns away the site root, which is not a page", async () => {
    for (const path of ["%2Froot", "%2F"]) {
      const response = await get(`/admin/pages/edit?path=${path}`);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toContain("site+contents");
    }
  });

  it("turns away a save aimed at it", async () => {
    const response = await post("/admin/pages/save", { path: "/root", format: "markdown", content: "# Mine" });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("site+contents");
    expect(await (await get("/")).text()).not.toContain("Mine");
  });
});
