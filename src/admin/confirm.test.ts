import { beforeEach, describe, expect, it } from "vitest";
import { handle } from "../app";
import { putAsset } from "../assets/service";
import { createSessionCookie } from "../auth/session";
import { completeSetup, getOwner } from "../auth/setup";
import { saveCollection } from "../data/service";
import { getPage, savePage } from "../pages/service";
import { saveGrant } from "../oauth/store";
import { mintShare, setPrivate } from "../private/service";
import { resetBlobs } from "../test/blobs";

let cookie: string;

beforeEach(async () => {
  resetBlobs();
  await completeSetup("correct horse battery");
  cookie = (await createSessionCookie((await getOwner())!)).split(";")[0];

  await savePage({ path: "/trip", contentType: "html", title: "Trip", body: "TRIP" });
  await savePage({ path: "/notes", contentType: "markdown", title: "Notes", body: "# Notes" });
  await saveCollection("/trip/items", [{ id: "muc" }, { id: "ber" }, { id: "cob" }]);
  await putAsset({
    filename: "coburg.jpg",
    contentType: "image/jpeg",
    bytes: new TextEncoder().encode("PICTURE").buffer,
  });
  await saveGrant({
    id: "g1",
    clientId: "c1",
    clientName: "Claude",
    ownerId: "owner",
    createdAt: Date.now(),
  });
});

function get(path: string): Promise<Response> {
  return handle(new Request(`https://example.com${path}`, { headers: { cookie } }));
}

function screen(path: string): Promise<string> {
  return get(path).then((response) => response.text());
}

function row(body: string, path: string): string {
  const from = body.slice(body.indexOf(`>${path}<`));
  return from.slice(0, from.indexOf("</tr>"));
}

const SCREENS = [
  "/admin",
  "/admin/assets",
  "/admin/data",
  "/admin/connections",
  "/admin/settings",
  "/admin/pages/edit?path=%2Ftrip",
  "/admin/pages/move?path=%2Ftrip",
];

describe("the admin asks its own questions", () => {
  it("draws no browser dialog anywhere", async () => {
    for (const path of SCREENS) {
      const body = await screen(path);
      expect(body).not.toMatch(/\bconfirm\(/);
      expect(body).not.toMatch(/\balert\(/);
      expect(body).not.toMatch(/\bprompt\(/);
      expect(body).not.toContain("onsubmit");
    }
  });

  // Both states ship in the row, so a press swaps them where they stand and nothing is fetched to
  // ask the question.
  it("ships the question next to the control it stands in front of", async () => {
    const cell = row(await screen("/admin"), "/trip");

    expect(cell).toContain("data-arm");
    expect(cell).toContain('action="/admin/pages/delete"');
    expect(cell).toContain("Delete /trip for good");
    expect(cell).toContain("Keep it");
    // Hidden until the press, and `[hidden]` beats the button's own display rule.
    expect(cell).toMatch(/<form[^>]* hidden>/);
    expect(await screen("/admin")).toContain("[hidden] { display: none !important; }");
  });

  it("swaps in place with one listener, on every screen", async () => {
    for (const path of SCREENS) {
      const body = await screen(path);
      expect(body.match(/a\[data-arm\]/g)!.length).toBeGreaterThan(0);
      expect(body).toContain("e.preventDefault()");
    }
  });

  // Without a script the arm link is still a link, so a delete is never one unasked press.
  it("arms through the query when nothing runs the swap", async () => {
    const armed = row(await screen("/admin?confirm=delete%3A%2Ftrip"), "/trip");

    expect(armed).not.toMatch(/<form[^>]* hidden>/);
    expect(armed).not.toContain("data-arm");
    expect(armed).toContain("Delete /trip for good");

    const other = row(await screen("/admin?confirm=delete%3A%2Ftrip"), "/notes");
    expect(other).toMatch(/<form[^>]* hidden>/);
  });

  it("cancels back to the screen it armed on", async () => {
    const armed = row(await screen("/admin?confirm=delete%3A%2Ftrip"), "/trip");

    expect(armed).toContain('href="/admin"');
  });

  // A press has to say what it does, and what a delete costs is the items in it.
  it("prices a collection in the button", async () => {
    expect(await screen("/admin/data")).toContain("Delete /trip/items and its 3 items");
  });

  it("names the file and the client it would take away", async () => {
    expect(await screen("/admin/assets")).toContain("Delete coburg.jpg for good");
    expect(await screen("/admin/connections")).toContain("Revoke Claude, it has to connect again");
  });

  // Access is armed inside the panel it lives in, so answering lands back on the question rather
  // than at the top of the editor.
  it("arms the access controls through the panel's own anchor", async () => {
    await setPrivate("/trip");
    await mintShare("/trip", "dana");
    const editor = await screen("/admin/pages/edit?path=%2Ftrip");

    expect(editor).toContain("confirm=public#access");
    expect(editor).toContain("confirm=revoke%3Adana#access");
    expect(editor).toContain("Open /trip to everyone and break 1 link");
    expect(editor).toContain("Leave it private");
    expect(editor).toContain("Revoke dana, that link stops opening it");
  });

  it("commits on the armed press", async () => {
    expect(await screen("/admin")).toContain('name="path" value="/trip"');

    const response = await handle(
      new Request("https://example.com/admin/pages/delete", {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ path: "/trip" }).toString(),
      }),
    );

    expect(response.status).toBe(303);
    expect(await getPage("/trip")).toBeNull();
  });
});
