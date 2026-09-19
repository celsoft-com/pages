import { beforeEach, describe, expect, it } from "vitest";
import { apiCallWrites } from "./api/handler";
import { handle } from "./app";
import { completeSetup } from "./auth/setup";
import { mintToken, revokeToken } from "./auth/tokens";
import { saveCollection } from "./data/service";
import { TOOLS } from "./mcp/tools";
import { resetBlobs } from "./test/blobs";

beforeEach(resetBlobs);

async function token(access: "read" | "write"): Promise<string> {
  return (await mintToken(`${access} token`, access)).secret;
}

function api(path: string, secret: string | null, body?: unknown): Promise<Response> {
  return handle(
    new Request(`https://example.com/api/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

function mcp(secret: string, method: string, params?: Record<string, unknown>): Promise<Response> {
  return handle(
    new Request("https://example.com/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
}

describe("the credential", () => {
  beforeEach(() => completeSetup("correct horse battery"));

  it("refuses an absent, malformed and revoked token identically", async () => {
    const live = await mintToken("doomed", "write");
    await revokeToken(live.token.id);

    for (const secret of [null, "not-a-token", "pat_wrong", live.secret]) {
      const response = await api("", secret);
      expect(response.status, String(secret)).toBe(401);
      expect(await response.json()).toEqual({ error: { message: "Unknown or revoked token." } });
    }
  });

  it("stops working on the next request after it is revoked", async () => {
    const { secret, token: record } = await mintToken("backup job", "write");
    expect((await api("", secret)).status).toBe(200);

    await revokeToken(record.id);
    expect((await api("", secret)).status).toBe(401);
  });

  it("stops an address guessing tokens, and says nothing about how close it got", async () => {
    // The admin login's ceiling, under its own key.
    for (let i = 0; i < 8; i++) expect((await api("", "pat_guess")).status).toBe(401);

    const limited = await api("", "pat_guess");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("900");
    expect((await limited.json()).error.message).not.toMatch(/token/i);
  });

  it("refuses a valid token from a limited address too, rather than leaking that it was valid", async () => {
    const secret = await token("write");
    for (let i = 0; i < 8; i++) await api("", "pat_guess");

    expect((await api("", secret)).status).toBe(429);
  });

  it("charges nothing for a credential that works, so a polling service is never limited", async () => {
    const secret = await token("read");
    for (let i = 0; i < 12; i++) expect((await api("", secret)).status).toBe(200);
  });

  it("keeps the API bucket clear of the admin login, so a stale cron cannot lock the owner out", async () => {
    for (let i = 0; i < 8; i++) await api("", "pat_guess");
    expect((await api("", "pat_guess")).status).toBe(429);

    const login = await handle(
      new Request("https://example.com/admin/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ password: "correct horse battery" }).toString(),
      }),
    );
    expect(login.status).toBe(303);
  });

  it("guards /mcp with the same counter", async () => {
    for (let i = 0; i < 8; i++) await handle(
      new Request("https://example.com/mcp", {
        method: "POST",
        headers: { authorization: "Bearer pat_guess", "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    expect((await mcp("pat_guess", "tools/list")).status).toBe(429);
  });

  it("refuses everything before the site is set up", async () => {
    const secret = await token("write");
    resetBlobs();
    expect((await api("", secret)).status).toBe(401);
  });
});

describe("discovery", () => {
  beforeEach(() => completeSetup("correct horse battery"));

  it("describes every tool a read-write token may call", async () => {
    const body = await (await api("", await token("write"))).json();
    expect(body.access).toBe("write");
    expect(body.tools).toHaveLength(TOOLS.length);
    expect(body.tools.map((t: any) => t.name)).toContain("put_item");
    expect(body.instructions).toContain("/data/products.json");
  });

  it("hides write tools from a read-only token rather than listing what it cannot call", async () => {
    const body = await (await api("", await token("read"))).json();
    const names = body.tools.map((t: any) => t.name);

    expect(body.access).toBe("read");
    expect(names).toContain("list_items");
    expect(names).not.toContain("put_item");
    expect(names).not.toContain("delete_bundle");
    expect(body.tools.every((t: any) => t.access === "read")).toBe(true);
  });

  it("carries the schema a client builds its call from", async () => {
    const body = await (await api("", await token("read"))).json();
    const listItems = body.tools.find((t: any) => t.name === "list_items");
    expect(listItems.input_schema.properties.path).toBeDefined();
    expect(listItems.url).toBe("https://example.com/api/v1/list_items");
  });
});

describe("calling a tool", () => {
  beforeEach(() => completeSetup("correct horse battery"));

  it("returns the structured result rather than the sentence MCP renders", async () => {
    const secret = await token("write");
    const response = await api("/put_item", secret, { path: "/beers", fields: { name: "Pilsner" } });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      path: "/beers",
      url: "https://example.com/data/beers.json",
      created: true,
      rev: 1,
    });
  });

  it("answers an unknown tool with 404", async () => {
    const response = await api("/no_such_tool", await token("write"), {});
    expect(response.status).toBe(404);
    expect((await response.json()).error.message).toContain("no_such_tool");
  });

  it("answers a thrown tool error with 400", async () => {
    const response = await api("/get_page", await token("read"), { path: "/nothing" });
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe("No page exists at /nothing");
  });

  it("answers a stale if_rev with 409, so a retry loop can tell a conflict from a failure", async () => {
    const secret = await token("write");
    await saveCollection("/beers", [{ id: "pils", name: "Pilsner" }]);

    const response = await api("/put_item", secret, {
      path: "/beers",
      id: "pils",
      fields: { name: "Helles" },
      if_rev: 99,
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toContain("has changed since you read it");
  });

  it("refuses a body that is not an object of arguments", async () => {
    const response = await handle(
      new Request("https://example.com/api/v1/list_pages", {
        method: "POST",
        headers: { authorization: `Bearer ${await token("read")}` },
        body: "[1,2,3]",
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe("a read-only token", () => {
  beforeEach(() => completeSetup("correct horse battery"));

  it("is refused a write and changes nothing", async () => {
    const response = await api("/put_item", await token("read"), { path: "/beers", fields: { name: "Pilsner" } });

    expect(response.status).toBe(403);
    expect((await response.json()).error.message).toContain("read-only");

    const served = await handle(new Request("https://example.com/data/beers.json"));
    expect(served.status).toBe(404);
  });

  it("is refused every write tool in the registry", async () => {
    const secret = await token("read");
    for (const tool of TOOLS.filter((t) => t.access === "write"))
      expect((await api(`/${tool.name}`, secret, {})).status, tool.name).toBe(403);
  });
});

describe("both doors", () => {
  beforeEach(() => completeSetup("correct horse battery"));

  it("accepts a minted token at /mcp, with its level applied there too", async () => {
    const readOnly = await token("read");

    const listed = await (await mcp(readOnly, "tools/list")).json();
    const names = listed.result.tools.map((t: any) => t.name);
    expect(names).toContain("list_items");
    expect(names).not.toContain("put_item");

    const called = await (await mcp(readOnly, "tools/call", { name: "put_item", arguments: {} })).json();
    expect(called.error.message).toContain("Unknown tool");
  });

  it("lets a read-write token do over MCP what it does over HTTP", async () => {
    const secret = await token("write");
    const called = await (
      await mcp(secret, "tools/call", { name: "publish_page", arguments: { path: "/hi", content: "# Hi" } })
    ).json();
    expect(called.result.content[0].text).toBe("Published Hi at https://example.com/hi");
  });
});

describe("caching", () => {
  beforeEach(() => completeSetup("correct horse battery"));

  it("never lets an API response be stored at the edge", async () => {
    const response = await api("", await token("read"));
    expect(response.headers.get("netlify-cdn-cache-control")).toBeNull();
    expect(response.headers.get("netlify-cache-tag")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("the upload ceiling", () => {
  beforeEach(() => completeSetup("correct horse battery"));

  it("refuses an oversized file in its own words, naming the limit", async () => {
    const response = await api("/upload_asset", await token("write"), {
      filename: "huge.bin",
      content_type: "application/octet-stream",
      content_base64: "A".repeat(8 * 1024 * 1024),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain("4 MB is the most");
  });
});

describe("the purge boundary", () => {
  // A service polling a read every minute must not keep clearing the edge cache for the whole site.
  it("does not purge for a read tool", () => {
    expect(apiCallWrites("/api/v1/list_items")).toBe(false);
    expect(apiCallWrites("/api/v1/get_page")).toBe(false);
  });

  // Only a proven read opts out. Everything else purges, so forgetting is slow rather than wrong.
  it("purges for a write, an unknown name and every other path", () => {
    expect(apiCallWrites("/api/v1/put_item")).toBe(true);
    expect(apiCallWrites("/api/v1/move_bundle")).toBe(true);
    expect(apiCallWrites("/api/v1/no_such_tool")).toBe(true);
    expect(apiCallWrites("/api/v1")).toBe(true);
    expect(apiCallWrites("/mcp")).toBe(true);
    expect(apiCallWrites("/admin/pages/save")).toBe(true);
  });
});
