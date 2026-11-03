import { describe, expect, it } from "vitest";
import { isValidPath, normalizePath, pageHref } from "./path";

describe("normalizePath", () => {
  it("anchors a bare name", () => {
    expect(normalizePath("about")).toBe("/about");
  });

  it("collapses anything empty to the home page", () => {
    expect(normalizePath("")).toBe("/");
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("///")).toBe("/");
    expect(normalizePath("/index")).toBe("/");
    expect(normalizePath("/index.html")).toBe("/");
  });

  it("lowercases and trims", () => {
    expect(normalizePath("  /About  ")).toBe("/about");
  });

  it("drops a trailing slash and empty segments", () => {
    expect(normalizePath("/blog/")).toBe("/blog");
    expect(normalizePath("/blog//first")).toBe("/blog/first");
  });

  it("strips page extensions but not others", () => {
    expect(normalizePath("/about.html")).toBe("/about");
    expect(normalizePath("/about.htm")).toBe("/about");
    expect(normalizePath("/notes.md")).toBe("/notes");
    expect(normalizePath("/notes.markdown")).toBe("/notes");
    expect(normalizePath("/data.json")).toBe("/data.json");
  });

  it("strips a query string and a fragment", () => {
    expect(normalizePath("/about?ref=x#top")).toBe("/about");
  });

  it("decodes percent escapes", () => {
    expect(normalizePath("/my%20page")).toBe("/my page");
  });

  it("survives a malformed escape rather than throwing", () => {
    expect(normalizePath("/100%")).toBe("/100%");
  });

  it("refuses to climb above the root", () => {
    expect(normalizePath("/../secret")).toBe("/secret");
    expect(normalizePath("/a/../../b")).toBe("/a/b");
    expect(normalizePath("/./a")).toBe("/a");
  });

  it("treats backslashes as separators", () => {
    expect(normalizePath("\\a\\b")).toBe("/a/b");
  });

  it("is idempotent", () => {
    for (const input of ["/About.html", "/blog//first/", "/../x", ""])
      expect(normalizePath(normalizePath(input))).toBe(normalizePath(input));
  });
});

describe("isValidPath", () => {
  it("accepts the home page and slug paths", () => {
    expect(isValidPath("/")).toBe(true);
    expect(isValidPath("/about")).toBe(true);
    expect(isValidPath("/blog/first-post")).toBe(true);
    expect(isValidPath("/a.b~c_d-e")).toBe(true);
  });

  it("rejects anything that is not a normalized path", () => {
    expect(isValidPath("about")).toBe(false);
    expect(isValidPath("/About")).toBe(false);
    expect(isValidPath("/my page")).toBe(false);
    expect(isValidPath("/blog/")).toBe(false);
    expect(isValidPath("/blog//first")).toBe(false);
    expect(isValidPath("/a?b")).toBe(false);
  });
});

describe("pageHref", () => {
  it("sends a page's path to its /p URL and /root to /", () => {
    expect(pageHref("/about")).toBe("/p/about");
    expect(pageHref("/essay/x?y=1#top")).toBe("/p/essay/x?y=1#top");
    expect(pageHref("/")).toBe("/");
    expect(pageHref("/root")).toBe("/");
  });

  it("leaves the site's own routes, outside addresses and fragments alone", () => {
    for (const value of ["/assets/a.png", "/data/x.json", "/docs/tools", "/p/about", "/login", "https://x.example/a", "//cdn.example/a.js", "#top", "mailto:a@b.c"])
      expect(pageHref(value)).toBe(value);
  });
});
