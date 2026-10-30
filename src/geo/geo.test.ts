import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearGeoFetch, stubGeoFetch } from "../test/http";
import { geocodeQuery, parsePrefer, parseProfile, parseStops, simplify } from "./service";

const STOPS = [
  { lat: 50.2612, lon: 10.9627 },
  { lat: 49.8917, lon: 10.8917 },
];

beforeEach(() => {
  delete process.env.ORS_API_KEY;
});
afterEach(clearGeoFetch);

describe("stops", () => {
  // GeoJSON is [lon, lat] and most map libraries are [lat, lon]. A bare pair in an argument is a
  // transposition that validates, renders, and puts the pin in the wrong country.
  it("takes named fields and returns GeoJSON order", () => {
    expect(parseStops(STOPS)).toEqual([
      [10.9627, 50.2612],
      [10.8917, 49.8917],
    ]);
  });

  it("refuses fewer than two", () => {
    expect(() => parseStops([{ lat: 1, lon: 1 }])).toThrow(/at least two/);
  });

  it("refuses a bare pair, which is the transposition trap", () => {
    expect(() => parseStops([[10.9, 50.2], [10.8, 49.8]])).toThrow(/numeric lat and lon/);
  });

  it("refuses coordinates outside the world", () => {
    expect(() => parseStops([{ lat: 95, lon: 10 }, { lat: 49, lon: 10 }])).toThrow(/-90 to 90/);
    expect(() => parseStops([{ lat: 50, lon: 200 }, { lat: 49, lon: 10 }])).toThrow(/-180 to 180/);
  });

  it("defaults to cycling", () => {
    expect(parseProfile(undefined)).toBe("cycling");
    expect(() => parseProfile("hovercraft")).toThrow(/driving, cycling, walking/);
  });
});

describe("simplify", () => {
  const line = [
    [10, 50, 100],
    [10.00001, 50.5, 150],
    [10, 51, 200],
  ];

  it("is off at zero and keeps every point", () => {
    expect(simplify(line, 0)).toEqual(line);
  });

  // Thinning a line must never also edit the points it keeps: the survivors come back byte for byte,
  // elevation included, or a stored route quietly loses its third ordinate.
  it("returns surviving points exactly as given, elevation and all", () => {
    const kept = simplify(line, 500);
    expect(kept).toEqual([line[0], line[2]]);
    expect(kept[0]).toBe(line[0]);
  });

  it("keeps a point that genuinely bends the line", () => {
    const bent = [
      [10, 50],
      [10.5, 50.5],
      [10, 51],
    ];
    expect(simplify(bent, 100)).toHaveLength(3);
  });
});

describe("geocode", () => {
  beforeEach(() => stubGeoFetch());

  it("returns candidates rather than an answer", async () => {
    const result = await geocodeQuery("Springfield", 5);
    expect(result.count).toBe(2);
    expect(result.candidates.map((c) => c.name)).toEqual(["Springfield", "Springfield Union Station"]);
    expect(result.provider).toBe("nominatim");
    expect(result.attribution).toMatch(/OpenStreetMap/);
  });

  it("separates the name from the place around it", async () => {
    const [first] = (await geocodeQuery("Springfield", 5)).candidates;
    expect(first.name).toBe("Springfield");
    expect(first.context).toBe("Greenfield County, Illinois, United States");
    expect(first.kind).toBe("town");
  });

  it("refuses an empty query", async () => {
    await expect(geocodeQuery("  ", 5)).rejects.toThrow(/query is required/);
  });

  it("switches provider when a key is set, without changing the shape", async () => {
    process.env.ORS_API_KEY = "test-key";
    const result = await geocodeQuery("Springfield", 5);
    expect(result.provider).toBe("openrouteservice");
    expect(Object.keys(result.candidates[0]).sort()).toEqual(
      ["confidence", "context", "kind", "lat", "lon", "name"].sort(),
    );
  });
});
