import { describe, expect, it } from "vitest";
import { originOf, publicUrl } from "./origin";

function request(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe("the URL a browser is on", () => {
  it("is the request's own when nothing forwarded it", () => {
    expect(originOf(publicUrl(request("https://example.com/trip")))).toBe("https://example.com");
  });

  // Anything terminating TLS in front of this hands the function a plain http request. Without
  // this the share link, the OAuth metadata and the connector URL all name http.
  it("takes the scheme from a proxy that terminated TLS", () => {
    const url = publicUrl(request("http://example.com/trip", { "x-forwarded-proto": "https" }));
    expect(originOf(url)).toBe("https://example.com");
    expect(url.pathname).toBe("/trip");
  });

  it("reads the first hop of a chain", () => {
    expect(originOf(publicUrl(request("http://example.com/", { "x-forwarded-proto": "https, http" })))).toBe(
      "https://example.com",
    );
  });

  it("keeps a port, because a dev server is on one", () => {
    expect(originOf(publicUrl(request("http://localhost:8888/admin")))).toBe("http://localhost:8888");
  });

  it("ignores a header naming anything but http or https", () => {
    expect(originOf(publicUrl(request("https://example.com/", { "x-forwarded-proto": "gopher" })))).toBe(
      "https://example.com",
    );
  });
});
