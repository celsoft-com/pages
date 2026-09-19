import { beforeEach, describe, expect, it } from "vitest";
import { handle } from "../app";
import { createSessionCookie } from "../auth/session";
import { completeSetup, getOwner } from "../auth/setup";
import { listTokens } from "../auth/tokens";
import { resetBlobs } from "../test/blobs";

let cookie: string;

beforeEach(async () => {
  resetBlobs();
  await completeSetup("correct horse battery");
  cookie = (await createSessionCookie((await getOwner())!)).split(";")[0];
});

function screen(): Promise<string> {
  return handle(new Request("https://example.com/admin/connections", { headers: { cookie } })).then((r) => r.text());
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

describe("minting a token", () => {
  it("renders the secret in its own response rather than redirecting with it", async () => {
    const response = await post("/admin/connections/tokens", { label: "backup job", access: "write" });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();

    const secret = body.match(/pat_[A-Za-z0-9_-]+/)?.[0];
    expect(secret).toBeTruthy();
    expect(body).toContain("backup job");
    expect(body).toContain("cannot be shown again");
  });

  // A POST left in history means a refresh offers to submit it again, and this one mints a credential.
  it("rewrites its history entry to the screen it came from", async () => {
    const body = await (await post("/admin/connections/tokens", { label: "feed", access: "read" })).text();
    expect(body).toContain('history.replaceState(null,"","/admin/connections")');
  });

  it("never shows the secret a second time", async () => {
    const minted = await (await post("/admin/connections/tokens", { label: "feed", access: "read" })).text();
    const secret = minted.match(/pat_[A-Za-z0-9_-]+/)![0];

    expect(await screen()).not.toContain(secret);
  });

  it("stores what the token may do", async () => {
    await post("/admin/connections/tokens", { label: "reader", access: "read" });
    await post("/admin/connections/tokens", { label: "writer", access: "write" });

    const stored = await listTokens();
    expect(stored.map((t) => [t.label, t.access]).sort()).toEqual([
      ["reader", "read"],
      ["writer", "write"],
    ]);
  });

  it("refuses an unnamed token, because the name is how one is told from another when revoking", async () => {
    await post("/admin/connections/tokens", { label: "  ", access: "read" });
    expect(await listTokens()).toHaveLength(0);
  });
});

describe("the setup commands", () => {
  it("bakes this site's own address into the command, so it is never typed", async () => {
    const body = await screen();
    expect(body).toContain("npx skills add celsoft-com/pages --skill '*' -g -y");
    expect(body).toContain("pages-login https://example.com");
    expect(body).toContain(`data-copy="npx skills add celsoft-com/pages --skill '*' -g -y"`);
  });

  // The whole point of the second command asking for the token is that the token is not in it.
  it("never puts a token in a command", async () => {
    const minted = await (await post("/admin/connections/tokens", { label: "feed", access: "write" })).text();
    const secret = minted.match(/pat_[A-Za-z0-9_-]+/)![0];

    for (const match of minted.match(/data-copy="[^"]*"/g) ?? [])
      if (match.includes("pages-login") || match.includes("npx skills"))
        expect(match).not.toContain(secret);
  });
});

describe("the token list", () => {
  it("says what each one can do and offers revoke in the row", async () => {
    await post("/admin/connections/tokens", { label: "price feed", access: "read" });
    const body = await screen();

    expect(body).toContain("price feed");
    expect(body).toContain("Read only");
    expect(body).toContain("Revoke price feed, it stops working on its next request");
  });

  it("asks in the button rather than in a browser dialog", async () => {
    await post("/admin/connections/tokens", { label: "price feed", access: "read" });
    const body = await screen();

    expect(body).toContain("data-arm");
    expect(body).not.toMatch(/\bconfirm\s*\(/);
    expect(body).not.toMatch(/\balert\s*\(/);
  });

  it("removes the token it names and leaves the others working", async () => {
    await post("/admin/connections/tokens", { label: "one", access: "read" });
    await post("/admin/connections/tokens", { label: "two", access: "read" });

    const doomed = (await listTokens()).find((t) => t.label === "one")!;
    await post("/admin/connections/tokens/revoke", { token_id: doomed.id });

    expect((await listTokens()).map((t) => t.label)).toEqual(["two"]);
  });

  it("says so plainly when the token is already gone", async () => {
    const response = await post("/admin/connections/tokens/revoke", { token_id: "nothing" });
    expect(response.headers.get("location")).toContain("already+gone");
  });
});
