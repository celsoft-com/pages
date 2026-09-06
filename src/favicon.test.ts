import { beforeEach, describe, expect, it } from "vitest";
import { handle } from "./app";
import { putAsset } from "./assets/service";
import { completeSetup } from "./auth/setup";
import { DEFAULT_FAVICON } from "./favicon-default";
import { TOOLS } from "./mcp/tools";
import { resetBlobs } from "./test/blobs";

beforeEach(resetBlobs);

function icon(): Promise<Response> {
  return handle(new Request("https://example.com/favicon.ico"));
}

function upload(path: string, contentType: string, body: string) {
  const bytes = new TextEncoder().encode(body);
  return putAsset({ filename: path.split("/").pop()!, contentType, bytes: bytes.buffer, path });
}

describe("favicon", () => {
  it("serves the built-in default before setup", async () => {
    const response = await icon();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(DEFAULT_FAVICON.contentType);
  });

  it("serves the asset in /root instead, with its own type", async () => {
    await completeSetup("correct horse battery");
    await upload("/root/favicon.png", "image/png", "PNGBYTES");

    const response = await icon();
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(await response.text()).toBe("PNGBYTES");
  });

  it("prefers favicon.ico over the other names", async () => {
    await upload("/root/favicon.png", "image/png", "PNGBYTES");
    await upload("/root/favicon.ico", "image/x-icon", "ICOBYTES");

    expect(await (await icon()).text()).toBe("ICOBYTES");
  });

  it("ignores a favicon anywhere but /root", async () => {
    await upload("/favicon.png", "image/png", "PNGBYTES");
    await upload("/blog/favicon.png", "image/png", "OTHERBYTES");

    expect((await icon()).headers.get("content-type")).toBe(DEFAULT_FAVICON.contentType);
  });

  it("is set by upload_asset naming the path", async () => {
    const tool = TOOLS.find((t) => t.name === "upload_asset")!;
    await tool.handler(
      {
        filename: "favicon.png",
        content_base64: btoa("UPLOADED"),
        content_type: "image/png",
        path: "/root/favicon.png",
      },
      { siteUrl: "https://example.com" },
    );

    const response = await icon();
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(await response.text()).toBe("UPLOADED");
  });

  it("links the well-known URL from themed pages and admin", async () => {
    await completeSetup("correct horse battery");
    const page = await handle(new Request("https://example.com/nothing-here"));
    expect(await page.text()).toContain('<link rel="icon" href="/favicon.ico">');
  });
});
