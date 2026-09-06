import { describe, expect, it } from "vitest";
import { changedContent, contentHeaders, immutableHeaders } from "./cache";

function decide(method: string, path: string, status = 200): boolean {
  return changedContent(new Request(`https://example.com${path}`, { method }), path, new Response(null, { status }));
}

describe("headers", () => {
  it("keeps a browser out of the business of caching content", () => {
    const headers = contentHeaders();
    expect(headers["cache-control"]).toBe("no-cache");
    expect(headers["netlify-cdn-cache-control"]).toContain("durable");
    expect(headers["netlify-cache-tag"]).toBe("content");
  });

  // Without this the worst case of a missed purge is forever rather than five minutes.
  it("bounds the edge copy even though a write clears it", () => {
    expect(contentHeaders()["netlify-cdn-cache-control"]).toContain("s-maxage=300");
  });

  it("lets a content-addressed URL live in a browser, since its bytes cannot change", () => {
    expect(immutableHeaders()["cache-control"]).toContain("immutable");
  });
});

describe("deciding to purge", () => {
  it("ignores reads", () => {
    expect(decide("GET", "/mcp")).toBe(false);
    expect(decide("HEAD", "/")).toBe(false);
  });

  it("purges after a write, whichever code did the writing", () => {
    expect(decide("POST", "/mcp")).toBe(true);
    expect(decide("POST", "/admin/pages/new")).toBe(true);
    expect(decide("DELETE", "/admin/assets/coat.jpg")).toBe(true);
  });

  it("leaves the cache alone when the request failed", () => {
    expect(decide("POST", "/mcp", 401)).toBe(false);
    expect(decide("POST", "/admin/pages/new", 500)).toBe(false);
  });

  it("does not treat the OAuth dance as a change", () => {
    expect(decide("POST", "/oauth/token")).toBe(false);
    expect(decide("POST", "/oauth/register")).toBe(false);
  });
});
