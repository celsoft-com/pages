import { beforeEach, describe, expect, it } from "vitest";
import { handle } from "./app";
import { completeSetup } from "./auth/setup";
import { savePage } from "./pages/service";
import { resetBlobs } from "./test/blobs";

beforeEach(resetBlobs);

function get(path: string): Promise<Response> {
  return handle(new Request(`https://example.com${path}`));
}

async function publish(path: string, body: string) {
  await savePage({ path, contentType: "html", title: "t", body });
}

describe("route prefixes match on segment boundaries", () => {
  beforeEach(() => completeSetup("correct horse battery"));

  it("serves a page whose path starts with a reserved prefix", async () => {
    await publish("/admin-notes", "ADMIN NOTES PAGE");
    await publish("/assetsfoo", "ASSETSFOO PAGE");
    await publish("/database", "DATABASE PAGE");

    expect(await (await get("/admin-notes")).text()).toBe("ADMIN NOTES PAGE");
    expect(await (await get("/assetsfoo")).text()).toBe("ASSETSFOO PAGE");
    expect(await (await get("/database")).text()).toBe("DATABASE PAGE");
  });

  it("still routes the prefixes themselves", async () => {
    await publish("/admin-notes", "ADMIN NOTES PAGE");

    for (const path of ["/admin", "/admin/pages"]) {
      const body = await (await get(path)).text();
      expect(body).not.toContain("ADMIN NOTES PAGE");
    }
  });
});
