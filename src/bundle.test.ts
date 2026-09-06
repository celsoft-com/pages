import { describe, expect, it } from "vitest";
import { contains, ownerOf, wouldBeOwner } from "./bundle";

describe("contains", () => {
  it("holds a resource directly beneath it", () => {
    expect(contains("/germanfunstuff", "/germanfunstuff/items")).toBe(true);
    expect(contains("/germanfunstuff", "/germanfunstuff/a/b/c")).toBe(true);
  });

  it("holds the path itself", () => {
    expect(contains("/germanfunstuff", "/germanfunstuff")).toBe(true);
  });

  it("stops at segment boundaries, not string prefixes", () => {
    expect(contains("/bavaria", "/bavaria-lessons/lessons")).toBe(false);
    expect(contains("/trip", "/tripwire/items")).toBe(false);
  });

  it("does not reach upward", () => {
    expect(contains("/trip/day1", "/trip")).toBe(false);
  });

  it("treats / as holding everything", () => {
    expect(contains("/", "/anything/at/all")).toBe(true);
  });
});

describe("ownerOf", () => {
  const pages = ["/", "/bavaria-lessons", "/trip", "/trip/day1"];

  it("picks the nearest page above a resource", () => {
    expect(ownerOf("/trip/day1/items", pages)).toBe("/trip/day1");
    expect(ownerOf("/trip/sections", pages)).toBe("/trip");
  });

  it("never assigns the root page", () => {
    expect(ownerOf("/loose/items", ["/"])).toBeNull();
    expect(ownerOf("/loose/items", pages)).toBeNull();
  });

  it("does not credit a page whose name merely starts the path", () => {
    expect(ownerOf("/bavaria/lessons", pages)).toBeNull();
    expect(ownerOf("/bavaria-lessons/lessons", pages)).toBe("/bavaria-lessons");
  });

  it("owns a resource sharing a page's exact path", () => {
    expect(ownerOf("/trip", pages)).toBe("/trip");
  });
});

describe("wouldBeOwner", () => {
  it("names the first segment", () => {
    expect(wouldBeOwner("/trip/items")).toBe("/trip");
    expect(wouldBeOwner("/a/b/c/d")).toBe("/a");
  });

  it("has no answer for the root", () => {
    expect(wouldBeOwner("/")).toBeNull();
  });
});
