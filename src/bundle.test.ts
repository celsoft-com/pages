import { describe, expect, it } from "vitest";
import { contains } from "./bundle";

describe("contains", () => {
  it("holds a resource directly beneath it", () => {
    expect(contains("/gallery", "/gallery/items")).toBe(true);
    expect(contains("/gallery", "/gallery/a/b/c")).toBe(true);
  });

  it("holds the path itself", () => {
    expect(contains("/gallery", "/gallery")).toBe(true);
  });

  it("stops at segment boundaries, not string prefixes", () => {
    expect(contains("/photos", "/photos-archive/lessons")).toBe(false);
    expect(contains("/trip", "/tripwire/items")).toBe(false);
  });

  it("does not reach upward", () => {
    expect(contains("/trip/day1", "/trip")).toBe(false);
  });

  it("treats / as holding everything", () => {
    expect(contains("/", "/anything/at/all")).toBe(true);
  });
});
