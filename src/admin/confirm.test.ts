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

  // The question is asked in the control that answers it, so an unarmed screen carries no way to
  // submit the destructive thing at all: the first press only arms it.
  it("keeps a delete out of reach until the button is armed", async () => {
    const listing = await screen("/admin");

    expect(listing).not.toContain('action="/admin/pages/delete"');
    expect(listing).toContain("confirm=delete%3A%2Ftrip");

    const armed = await screen("/admin?confirm=delete%3A%2Ftrip");

    expect(armed).toContain('action="/admin/pages/delete"');
    expect(armed).toContain("Delete /trip for good");
    expect(armed).toContain("Keep it");
  });

  it("arms one row and leaves the rest alone", async () => {
    const armed = await screen("/admin?confirm=delete%3A%2Ftrip");
    const notes = armed.slice(armed.indexOf("/notes"));

    expect(notes).not.toContain("Delete /notes for good");
    expect(notes).toContain("confirm=delete%3A%2Fnotes");
  });

  it("cancels back to the screen it armed on", async () => {
    const armed = await screen("/admin?confirm=delete%3A%2Ftrip");
    const cancel = armed.slice(armed.indexOf("Delete /trip for good"));

    expect(cancel).toContain('href="/admin"');
  });

  // A press has to say what it does, and what a delete costs is the items in it.
  it("prices a collection in the button", async () => {
    expect(await screen("/admin/data?confirm=delete%3A%2Ftrip%2Fitems")).toContain(
      "Delete /trip/items and its 3 items",
    );
  });

  it("names the file and the client it would take away", async () => {
    const assets = await screen("/admin/assets");
    const key = /confirm=delete%3A([^"]+)/.exec(assets)![1];

    expect(await screen(`/admin/assets?confirm=delete%3A${key}`)).toContain("Delete coburg.jpg for good");
    expect(await screen("/admin/connections?confirm=revoke%3Ag1")).toContain(
      "Revoke Claude, it has to connect again",
    );
  });

  // Access is armed inside the panel it lives in, so answering lands back on the question rather
  // than at the top of the editor.
  it("arms the access controls through the panel's own anchor", async () => {
    await setPrivate("/trip");
    await mintShare("/trip", "dana");
    const editor = await screen("/admin/pages/edit?path=%2Ftrip");

    expect(editor).toContain("confirm=public#access");
    expect(editor).toContain("confirm=revoke%3Adana#access");
    expect(editor).not.toContain('action="/admin/pages/public"');

    const armed = await screen("/admin/pages/edit?path=%2Ftrip&confirm=public");

    expect(armed).toContain('action="/admin/pages/public"');
    expect(armed).toContain("Open /trip to everyone and break 1 link");
    expect(armed).toContain("Leave it private");
  });

  it("says what a revoke stops", async () => {
    await setPrivate("/trip");
    await mintShare("/trip", "dana");

    expect(await screen("/admin/pages/edit?path=%2Ftrip&confirm=revoke%3Adana")).toContain(
      "Revoke dana, that link stops opening it",
    );
  });

  it("commits on the armed press", async () => {
    const armed = await screen("/admin?confirm=delete%3A%2Ftrip");
    expect(armed).toContain('name="path" value="/trip"');

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
