import { describe, expect, it } from "vitest";
import { pointsFor } from "./pages-app";

describe("pointsFor", () => {
  it("names the path, every folder above it and then the site", () => {
    expect(pointsFor("/trip/day1/stops")).toEqual(["path:/trip/day1/stops", "path:/trip/day1", "path:/trip", "site"]);
  });

  it("gates / on the site alone", () => {
    expect(pointsFor("/")).toEqual(["site"]);
  });
});
