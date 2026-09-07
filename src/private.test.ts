import { beforeEach, describe, expect, it } from "vitest";
import { handle } from "./app";
import { createSessionCookie } from "./auth/session";
import { completeSetup, getOwner } from "./auth/setup";
import { saveCollection } from "./data/service";
import { TOOLS, type ToolContext } from "./mcp/tools";
import { savePage } from "./pages/service";
import { putAsset } from "./assets/service";
import { resetBlobs } from "./test/blobs";

const ctx: ToolContext = { siteUrl: "https://example.com" };

beforeEach(async () => {
  resetBlobs();
  await completeSetup("correct horse battery");
});

function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`No tool named ${name}`);
  return tool.handler(args, ctx);
}

async function json(name: string, args: Record<string, unknown> = {}): Promise<any> {
  return JSON.parse(await call(name, args));
}

function get(path: string, cookie?: string): Promise<Response> {
  return handle(
    new Request(`https://example.com${path}`, { headers: cookie ? { cookie } : undefined }),
  );
}

function unlock(token: string): Promise<Response> {
  return handle(new Request("https://example.com/_unlock", { method: "POST", body: token }));
}

// The whole flow a recipient goes through: click the link, the script POSTs the fragment, the
// cookie comes back, the reload is a plain request carrying it.
async function redeem(link: string): Promise<string> {
  const response = await unlock(link.split("#")[1]);
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")!;
  return cookie.split(";")[0];
}

async function share(path: string, label = "dana"): Promise<string> {
  return (await json("share_path", { path, label })).link;
}

beforeEach(async () => {
  await savePage({ path: "/trip", contentType: "html", title: "t", body: "TRIP PAGE" });
  await savePage({ path: "/trip/day1", contentType: "html", title: "d", body: "DAY ONE PAGE" });
  await savePage({ path: "/tripwire", contentType: "html", title: "w", body: "TRIPWIRE PAGE" });
  await saveCollection("/trip/items", [{ id: "a", name: "one" }]);
  await saveCollection("/tripwire/items", [{ id: "b", name: "two" }]);
  await putAsset({
    filename: "map.png",
    contentType: "image/png",
    bytes: new TextEncoder().encode("MAPBYTES").buffer,
    path: "/trip/map.png",
  });
});

describe("a private path is closed", () => {
  beforeEach(() => call("set_privacy", { path: "/trip", private: true }));

  it("hides the page, the collection and the asset", async () => {
    expect((await get("/trip")).status).toBe(404);
    expect((await get("/trip/day1")).status).toBe(404);
    expect((await get("/data/trip/items.json")).status).toBe(404);
    expect((await get("/assets/trip/map.png")).status).toBe(404);
  });

  it("answers exactly as if nothing were published there", async () => {
    const missing = await get("/nothing-at-all");
    const closed = await get("/trip");

    expect(closed.status).toBe(missing.status);
    expect(await closed.text()).toBe((await missing.text()).replace("/nothing-at-all", "/trip"));
  });

  it("leaves the neighbouring path alone", async () => {
    expect(await (await get("/tripwire")).text()).toBe("TRIPWIRE PAGE");
    expect((await get("/data/tripwire/items.json")).status).toBe(200);
  });

  it("drops the collection from the public index", async () => {
    const index = await (await get("/data/_collections.json")).json();
    expect(index.map((c: { path: string }) => c.path)).toEqual(["/tripwire/items"]);
  });

  const GATED = ["/trip", "/trip/day1", "/data/trip/items.json", "/assets/trip/map.png"];

  it("is never cached anywhere, closed or open", async () => {
    const cookie = await redeem(await share("/trip"));

    // The granted response is the one that matters: a private page stored at the edge would be
    // handed to the next visitor, and the purge is blind to what changed so it cannot be relied on.
    for (const path of GATED) {
      for (const response of [await get(path), await get(path, cookie)]) {
        expect(response.headers.get("netlify-cdn-cache-control")).toBeNull();
        expect(response.headers.get("netlify-cache-tag")).toBeNull();
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      }
    }
  });

  it("hands a private collection no wildcard origin", async () => {
    const cookie = await redeem(await share("/trip"));
    const open = await get("/data/trip/items.json", cookie);

    expect(open.status).toBe(200);
    expect(open.headers.get("access-control-allow-origin")).toBeNull();
    expect((await get("/data/tripwire/items.json")).headers.get("access-control-allow-origin")).toBe("*");
  });

  it("carries the unlock script on the closed page, so a share link can bootstrap", async () => {
    expect(await (await get("/trip")).text()).toContain("/_unlock");
  });
});

describe("a share link opens it", () => {
  it("serves the page, its collection and its asset", async () => {
    const cookie = await redeem(await share("/trip"));

    expect(await (await get("/trip", cookie)).text()).toBe("TRIP PAGE");
    expect(await (await get("/trip/day1", cookie)).text()).toBe("DAY ONE PAGE");
    expect(await (await get("/data/trip/items.json", cookie)).json()).toEqual([{ id: "a", name: "one" }]);
    expect(await (await get("/assets/trip/map.png", cookie)).text()).toBe("MAPBYTES");
  });

  it("makes the path private on its own", async () => {
    await share("/trip");
    expect((await get("/trip")).status).toBe(404);
  });

  it("names the page to open, so the same token works from any entry point", async () => {
    const link = await share("/trip");
    const body = await (await unlock(link.split("#")[1])).json();
    expect(body).toEqual({ path: "/trip" });
  });

  it("puts the token in the fragment, so no request can carry it", async () => {
    const link = await share("/trip");
    const [url, token] = link.split("#");
    expect(url).toBe("https://example.com/trip");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("sends the grant back HttpOnly and site-wide, since data and assets live elsewhere", async () => {
    const response = await unlock((await share("/trip")).split("#")[1]);
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Path=/");
  });

  it("refuses an unknown token the same way as a revoked one", async () => {
    expect((await unlock("not-a-real-token")).status).toBe(404);
    expect((await unlock("")).status).toBe(404);
  });

  it("stores no token, only a hash", async () => {
    const link = await share("/trip");
    const token = link.split("#")[1];
    const stored = JSON.stringify(await json("list_shares"));
    expect(stored).not.toContain(token);
  });
});

describe("revocation", () => {
  it("takes effect on the next request", async () => {
    const cookie = await redeem(await share("/trip"));
    expect((await get("/trip", cookie)).status).toBe(200);

    await call("revoke_share", { path: "/trip", label: "dana" });
    expect((await get("/trip", cookie)).status).toBe(404);
  });

  it("kills one recipient and leaves the others", async () => {
    const dana = await redeem(await share("/trip", "dana"));
    const sam = await redeem(await share("/trip", "sam"));

    await call("revoke_share", { path: "/trip", label: "dana" });
    expect((await get("/trip", dana)).status).toBe(404);
    expect((await get("/trip", sam)).status).toBe(200);
  });

  it("leaves the path private when the last link goes", async () => {
    await share("/trip");
    const revoked = await json("revoke_share", { path: "/trip" });

    expect(revoked.remaining).toBe(0);
    expect((await get("/trip")).status).toBe(404);
    expect((await json("list_shares")).private[0].path).toBe("/trip");
  });

  it("reopens everything when the path is made public", async () => {
    const cookie = await redeem(await share("/trip"));
    const back = await json("set_privacy", { path: "/trip", private: false });

    expect(back.revoked).toEqual(["dana"]);
    expect(await (await get("/trip")).text()).toBe("TRIP PAGE");
    // The dead cookie is simply ignored, not an error.
    expect((await get("/trip", cookie)).status).toBe(200);
  });
});

describe("a grant is only what it says", () => {
  it("does not open another private path", async () => {
    await savePage({ path: "/quotes", contentType: "html", title: "q", body: "QUOTES PAGE" });
    const trip = await redeem(await share("/trip"));
    await call("set_privacy", { path: "/quotes", private: true });

    expect((await get("/quotes", trip)).status).toBe(404);
  });

  it("holds grants for two private paths at once", async () => {
    await savePage({ path: "/quotes", contentType: "html", title: "q", body: "QUOTES PAGE" });
    const trip = await redeem(await share("/trip"));
    const quotes = await redeem(await share("/quotes"));

    expect((await get("/trip", `${trip}; ${quotes}`)).status).toBe(200);
    expect((await get("/quotes", `${trip}; ${quotes}`)).status).toBe(200);
  });

  it("rejects a tampered cookie rather than erroring", async () => {
    const cookie = await redeem(await share("/trip"));
    const [name, value] = cookie.split("=");
    const parts = decodeURIComponent(value).split(".");

    for (const forged of [
      `${parts[0]}.${Date.now() + 1000000}.${parts[2]}`,
      `${parts[0]}.${parts[1]}.notbase64!!`,
      "nonsense",
    ]) {
      const response = await get("/trip", `${name}=${encodeURIComponent(forged)}`);
      expect(response.status).toBe(404);
    }
  });
});

describe("the shape of privacy", () => {
  it("does not nest", async () => {
    await call("set_privacy", { path: "/trip", private: true });
    await expect(call("set_privacy", { path: "/trip/day1", private: true })).rejects.toThrow(/does not nest/);
    await expect(call("share_path", { path: "/trip/day1", label: "x" })).rejects.toThrow(/does not nest/);
  });

  it("refuses to close the whole site", async () => {
    await expect(call("set_privacy", { path: "/", private: true })).rejects.toThrow(/cannot be private/);
    await expect(call("share_path", { path: "/", label: "x" })).rejects.toThrow(/cannot be private/);
  });

  it("refuses a duplicate label, so revoking by label is unambiguous", async () => {
    await share("/trip", "dana");
    await expect(call("share_path", { path: "/trip", label: "dana" })).rejects.toThrow(/already has a share/);
  });

  it("says a path is private because an ancestor is", async () => {
    await call("set_privacy", { path: "/trip", private: true });
    expect(await json("list_shares", { path: "/trip/day1" })).toMatchObject({
      private: true,
      closed_by: "/trip",
    });
  });

  it("reports private paths on get_site", async () => {
    await share("/trip");
    expect((await json("get_site")).private).toEqual([{ path: "/trip", shares: 1 }]);
  });
});

describe("the home page can be private", () => {
  it("closes / and opens it with the link", async () => {
    await savePage({ path: "/root", contentType: "html", title: "h", body: "HOME PAGE" });
    const link = await share("/root");
    expect((await get("/")).status).toBe(404);

    const response = await unlock(link.split("#")[1]);
    // The home page bundle is /root but its one URL is /, so that is where the script sends them.
    expect(await response.json()).toEqual({ path: "/" });

    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    expect(await (await get("/", cookie)).text()).toBe("HOME PAGE");
  });
});

describe("a hash-keyed asset is in no scope", () => {
  it("stays reachable, because nothing under a private path has a hash URL", async () => {
    const asset = await putAsset({
      filename: "old.png",
      contentType: "image/png",
      bytes: new TextEncoder().encode("OLDBYTES").buffer,
      path: undefined,
    });
    await call("set_privacy", { path: "/trip", private: true });

    expect(await (await get(`/assets/${asset.key}`)).text()).toBe("OLDBYTES");
    expect(asset.path).toBeUndefined();
  });

  // findAsset tries the blob key verbatim before the path key, so this URL reaches the same bytes.
  // It has to be gated on the resolved asset's path, not on the shape of the URL that asked.
  it("cannot be reached through the raw blob key of a private asset", async () => {
    expect(await (await get("/assets/trip~map.png")).text()).toBe("MAPBYTES");

    await call("set_privacy", { path: "/trip", private: true });
    expect((await get("/assets/trip~map.png")).status).toBe(404);
  });
});

describe("the dashboard, on the Pages screen", () => {
  async function session(): Promise<string> {
    return (await createSessionCookie((await getOwner())!)).split(";")[0];
  }

  function post(path: string, fields: Record<string, string>, cookie: string): Promise<Response> {
    return handle(
      new Request(`https://example.com${path}`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
      }),
    );
  }

  it("needs a login", async () => {
    const response = await get("/admin");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("/admin/login");
  });

  it("closes a path and lists it", async () => {
    const cookie = await session();
    await post("/admin/pages/private", { path: "/trip" }, cookie);

    expect((await get("/trip")).status).toBe(404);
    const screen = await (await get("/admin", cookie)).text();
    expect(screen).toContain("Private");
    expect(screen).toContain("Add a link");
    expect(screen).toContain("Nobody can reach it.");
  });

  // The one place a share token could still reach a log is a redirect that carries it in a query
  // string, so minting renders the link in its own response instead of redirecting.
  it("shows a new link in the response body, never in a redirect URL", async () => {
    const cookie = await session();
    const response = await post("/admin/pages/share", { path: "/trip", label: "dana" }, cookie);

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();

    const body = await response.text();
    const token = body.match(/https:\/\/example\.com\/trip#([A-Za-z0-9_-]{43})/)?.[1];
    expect(token).toBeTruthy();
    expect(await (await get("/trip", await redeem(`x#${token}`))).text()).toBe("TRIP PAGE");
  });

  // A POST response left in history means a refresh offers to submit it again, so the minted
  // screen rewrites its own history entry to the GET that renders an empty form.
  it("rewrites history to the form's own GET, which mints nothing", async () => {
    const cookie = await session();
    const body = await (await post("/admin/pages/share", { path: "/trip", label: "dana" }, cookie)).text();
    // /trip has a page, so its access is managed in that page's editor.
    expect(body).toContain('history.replaceState(null,"","/admin/pages/edit?path=%2Ftrip")');

    const refreshed = await get("/admin/pages/edit?path=%2Ftrip", cookie);
    expect(refreshed.status).toBe(200);
    const form = await refreshed.text();
    expect(form).toContain("Name this link");
    // Everything the row gave up is here.
    expect(form).toContain("/admin/pages/public");
    expect(form).toContain("/admin/pages/revoke");
    expect(form).not.toMatch(/#[A-Za-z0-9_-]{43}/);
    expect((await json("list_shares", { path: "/trip" })).private[0].shares).toHaveLength(1);
  });

  it("offers the link to the clipboard", async () => {
    const cookie = await session();
    const body = await (await post("/admin/pages/share", { path: "/trip", label: "dana" }, cookie)).text();

    expect(body).toContain("data-copy=");
    expect(body).toContain("navigator.clipboard.writeText");
  });

  it("refuses to mint for a path that is not private", async () => {
    const cookie = await session();
    const response = await get("/admin/pages/access?path=%2Fquotes", cookie);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("error=");
  });

  // Two screens for one path is how they drift, so the standalone one only exists for a private
  // path that has no page of its own.
  it("sends a private path that has a page to that page's editor", async () => {
    const cookie = await session();
    await call("set_privacy", { path: "/trip", private: true });
    const response = await get("/admin/pages/access?path=%2Ftrip", cookie);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/admin/pages/edit?path=%2Ftrip#access");
  });

  it("keeps its own screen for a private path with no page", async () => {
    const cookie = await session();
    await call("set_privacy", { path: "/quotes", private: true });
    const body = await (await get("/admin/pages/access?path=%2Fquotes", cookie)).text();

    expect(body).toContain("No page is published at this path");
    expect(body).toContain("Name this link");
  });

  it("keeps a missing name on the mint screen rather than dumping to Pages", async () => {
    const cookie = await session();
    await post("/admin/pages/private", { path: "/trip" }, cookie);
    const response = await post("/admin/pages/share", { path: "/trip", label: "  " }, cookie);

    expect(response.headers.get("location")).toContain("/admin/pages/edit?path=%2Ftrip");
    expect(response.headers.get("location")).toContain("error=");
  });

  it("revokes one link", async () => {
    const cookie = await session();
    const grant = await redeem(await share("/trip", "dana"));
    await post("/admin/pages/revoke", { path: "/trip", label: "dana" }, cookie);

    expect((await get("/trip", grant)).status).toBe(404);
  });

  it("refuses to close the whole site", async () => {
    const cookie = await session();
    const response = await post("/admin/pages/private", { path: "/" }, cookie);

    expect(response.headers.get("location")).toContain("error=");
    expect((await get("/tripwire")).status).toBe(200);
    expect((await get("/trip")).status).toBe(200);
  });
});

// A move is not blocked by privacy, the same way it is not blocked by a bundle, but the path is
// what makes something private, so the reply has to say what it just changed.
describe("moving across a privacy boundary", () => {
  it("reports content moved out of a private path as now public", async () => {
    await call("set_privacy", { path: "/trip", private: true });
    const moved = await json("move_page", { from: "/trip/day1", to: "/day1", confirm: true });

    expect(moved.privacy_changes).toEqual([
      { kind: "page", path: "/day1", was: "private, under /trip", now: "public" },
    ]);
    expect(moved.notes.join(" ")).toMatch(/now public to anyone who has the URL/);
    expect(await (await get("/day1")).text()).toBe("DAY ONE PAGE");
  });

  it("reports content moved into a private path as now closed", async () => {
    await call("set_privacy", { path: "/trip", private: true });
    const moved = await json("move_page", { from: "/tripwire", to: "/trip/wire", confirm: true });

    expect(moved.privacy_changes).toEqual([
      { kind: "page", path: "/trip/wire", was: "public", now: "private, under /trip" },
    ]);
    expect((await get("/trip/wire")).status).toBe(404);
  });

  it("says nothing when a move stays on one side", async () => {
    await call("set_privacy", { path: "/trip", private: true });
    const moved = await json("move_page", { from: "/trip/day1", to: "/trip/day2", confirm: true });

    expect(moved.privacy_changes).toBeUndefined();
  });
});

describe("the Pages screen shows what is private", () => {
  async function screen(): Promise<string> {
    const cookie = (await createSessionCookie((await getOwner())!)).split(";")[0];
    return (await get("/admin", cookie)).text();
  }

  it("marks a page private and its descendants as covered by it", async () => {
    await call("set_privacy", { path: "/trip", private: true });
    const body = await screen();

    expect(body).toContain("Access");
    expect(body).toContain("Private");
    expect(body).toContain("Public");
    expect(body).toContain("Make private");
    // The descendant says which scope closed it and offers no switch of its own.
    expect(body).toContain('via <span class="mono">/trip</span>');
  });

  it("offers no separate control on a page inside a private path", async () => {
    await call("set_privacy", { path: "/trip", private: true });
    const body = await screen();
    const day1 = body.slice(body.indexOf("/trip/day1"));
    const row = day1.slice(0, day1.indexOf("</tr>"));

    expect(row).toContain("via");
    expect(row).not.toContain("/admin/pages/private");
    expect(row).not.toContain("/admin/pages/public");
    expect(row).not.toContain("/admin/pages/sharing");
  });

  it("lists a private path that has no page of its own", async () => {
    await call("set_privacy", { path: "/quotes", private: true });
    expect(await screen()).toContain("Private paths with no page");
  });

  it("has no sharing tab", async () => {
    expect(await screen()).not.toContain("/admin/sharing?");
  });

  // The row is one line: a state and a link to the screen that changes it. Every control that used
  // to sit in the cell lives on that screen now.
  it("keeps every control off the row and points at the editor", async () => {
    await call("set_privacy", { path: "/trip", private: true });
    const body = await screen();
    const table = body.slice(body.indexOf("<thead>"), body.indexOf("</tbody>"));

    expect(table).toContain("/admin/pages/edit?path=%2Ftrip#access");
    expect(table).not.toContain("/admin/pages/public");
    expect(table).not.toContain("/admin/pages/revoke");
    expect(table).not.toContain("/admin/pages/share\"");
  });
});

// A page's access lives with its content, so opening a page to edit it is the one place that
// answers who can read it and does something about it.
describe("the page editor holds every access control", () => {
  async function editor(path: string): Promise<string> {
    const cookie = (await createSessionCookie((await getOwner())!)).split(";")[0];
    return (await get(`/admin/pages/edit?path=${encodeURIComponent(path)}`, cookie)).text();
  }

  it("puts access above the content form", async () => {
    const body = await editor("/trip");

    expect(body.indexOf('id="access"')).toBeGreaterThan(-1);
    expect(body.indexOf('id="access"')).toBeLessThan(body.indexOf("<h2>Content</h2>"));
    expect(body.indexOf("<h2>Content</h2>")).toBeLessThan(body.indexOf('name="content"'));
  });

  it("offers Make private on a public page", async () => {
    const body = await editor("/trip");

    expect(body).toContain('id="access"');
    expect(body).toContain("/admin/pages/private");
    expect(body).toContain("Make private");
    expect(body).toContain("Anyone with the URL can read this.");
  });

  it("offers links, revoke and Make public on a private page", async () => {
    await share("/trip", "dana");
    const body = await editor("/trip");

    expect(body).toContain("dana");
    expect(body).toContain("/admin/pages/revoke");
    expect(body).toContain("/admin/pages/share");
    expect(body).toContain("/admin/pages/public");
    expect(body).toContain("Name this link");
  });

  it("sends a covered page to the scope that closed it, with no switch of its own", async () => {
    await call("set_privacy", { path: "/trip", private: true });
    const body = await editor("/trip/day1");

    expect(body).toContain("Closed because");
    expect(body).toContain("/admin/pages/edit?path=%2Ftrip#access");
    expect(body).not.toContain("/admin/pages/private");
    expect(body).not.toContain("/admin/pages/public");
  });

  it("shows a minted link in the editor it was minted from", async () => {
    await call("set_privacy", { path: "/trip", private: true });
    const cookie = (await createSessionCookie((await getOwner())!)).split(";")[0];
    const response = await handle(
      new Request("https://example.com/admin/pages/share", {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ path: "/trip", label: "dana" }).toString(),
      }),
    );
    const body = await response.text();

    expect(body).toContain("Content");
    expect(body).toContain("data-copy=");
    expect(body).toMatch(/https:\/\/example\.com\/trip#[A-Za-z0-9_-]{43}/);
  });

  it("says nothing about access on a page that does not exist yet", async () => {
    const cookie = (await createSessionCookie((await getOwner())!)).split(";")[0];
    const body = await (await get("/admin/pages/edit", cookie)).text();

    expect(body).not.toContain('id="access"');
  });

  it("nests no form inside the access panel, which a browser would drop", async () => {
    await share("/trip", "dana");
    const body = await editor("/trip");
    const panel = body.slice(body.indexOf('id="access"'));

    let depth = 0;
    for (const tag of panel.match(/<\/?form/g) ?? []) {
      depth += tag === "<form" ? 1 : -1;
      expect(depth).toBeLessThanOrEqual(1);
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  });
});
