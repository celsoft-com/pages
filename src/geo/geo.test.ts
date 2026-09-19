import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findAsset } from "../assets/service";
import { resetBlobs } from "../test/blobs";
import { clearGeoFetch, stubGeoFetch } from "../test/http";
import { geocodeQuery, parseProfile, parseStops, routeToAsset, simplify } from "./service";

const STOPS = [
  { lat: 50.2612, lon: 10.9627 },
  { lat: 49.8917, lon: 10.8917 },
];

beforeEach(() => {
  resetBlobs();
  delete process.env.ORS_API_KEY;
});
afterEach(clearGeoFetch);

async function write(args: Partial<Parameters<typeof routeToAsset>[0]> = {}) {
  return routeToAsset({
    stops: parseStops(STOPS),
    profile: "cycling",
    to: "/trip/route.geojson",
    simplifyMetres: 0,
    siteUrl: "https://example.com",
    ...args,
  });
}

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
    const result = await geocodeQuery("Bamberg", 5);
    expect(result.count).toBe(2);
    expect(result.candidates.map((c) => c.name)).toEqual(["Bamberg", "Bamberg Hauptbahnhof"]);
    expect(result.provider).toBe("nominatim");
    expect(result.attribution).toMatch(/OpenStreetMap/);
  });

  it("separates the name from the place around it", async () => {
    const [first] = (await geocodeQuery("Bamberg", 5)).candidates;
    expect(first.name).toBe("Bamberg");
    expect(first.context).toBe("Oberfranken, Bayern, Deutschland");
    expect(first.kind).toBe("town");
  });

  it("refuses an empty query", async () => {
    await expect(geocodeQuery("  ", 5)).rejects.toThrow(/query is required/);
  });

  it("switches provider when a key is set, without changing the shape", async () => {
    process.env.ORS_API_KEY = "test-key";
    const result = await geocodeQuery("Bamberg", 5);
    expect(result.provider).toBe("openrouteservice");
    expect(Object.keys(result.candidates[0]).sort()).toEqual(
      ["confidence", "context", "kind", "lat", "lon", "name"].sort(),
    );
  });
});

describe("route", () => {
  beforeEach(() => stubGeoFetch());

  it("writes the geometry to an asset and returns only a summary", async () => {
    const result = await write();
    expect(result.url).toBe("https://example.com/assets/trip/route.geojson");
    expect(result.distance_m).toBe(56693);
    expect(result.duration_s).toBe(10104);
    expect(result.points).toBe(4);
    expect(result).not.toHaveProperty("coordinates");
    expect(result).not.toHaveProperty("geometry");
  });

  // Cycling is the first thing this exists for, and the public OSRM server answers every profile
  // with the same car route, so cycling must never be sent there.
  it("sends cycling and walking to BRouter, and driving to OSRM", async () => {
    const stub = stubGeoFetch();
    await write({ profile: "cycling", to: "/a.geojson" });
    await write({ profile: "walking", to: "/b.geojson" });
    await write({ profile: "driving", to: "/c.geojson" });
    expect(stub.calls[0]).toContain("brouter.de");
    expect(stub.calls[0]).toContain("profile=trekking");
    expect(stub.calls[1]).toContain("profile=hiking-beta");
    expect(stub.calls[2]).toContain("router.project-osrm.org");
  });

  it("reports ascent where the router knows it and null where it does not", async () => {
    expect((await write({ profile: "cycling", to: "/a.geojson" })).ascent_m).toBe(162);
    const driving = await write({ profile: "driving", to: "/b.geojson" });
    expect(driving.ascent_m).toBeNull();
    expect(driving.has_elevation).toBe(false);
  });

  it("carries elevation through to the stored line", async () => {
    const result = await write();
    expect(result.has_elevation).toBe(true);
    const stored = await findAsset("/trip/route.geojson");
    const feature = JSON.parse(new TextDecoder().decode(stored!.body));
    expect(feature.geometry.coordinates[0]).toEqual([10.9627, 50.2612, 291]);
  });

  it("stores provenance and no styling", async () => {
    await write();
    const stored = await findAsset("/trip/route.geojson");
    expect(stored!.asset.contentType).toBe("application/geo+json");
    const feature = JSON.parse(new TextDecoder().decode(stored!.body));
    expect(feature.type).toBe("Feature");
    expect(Object.keys(feature.properties).sort()).toEqual(
      ["ascent_m", "attribution", "descent_m", "distance_m", "duration_s", "generated", "profile", "provider"].sort(),
    );
    // There is a whole convention for putting these in GeoJSON properties. Appearance is the page's.
    for (const styling of ["stroke", "stroke-width", "fill", "color", "name", "title"]) {
      expect(feature.properties).not.toHaveProperty(styling);
    }
  });

  it("refuses a target that names no file", async () => {
    await expect(write({ to: "/" })).rejects.toThrow(/must name a file/);
  });
});

describe("when a provider fails", () => {
  it("says nothing was written, on a timeout", async () => {
    stubGeoFetch({ fail: "timeout" });
    await expect(write()).rejects.toThrow(/timed out.*Nothing was written/s);
  });

  it("says nothing was written, on an error status", async () => {
    stubGeoFetch({ fail: "status" });
    await expect(write()).rejects.toThrow(/answered 503.*Nothing was written/s);
  });

  it("leaves no asset behind", async () => {
    stubGeoFetch({ fail: "status" });
    await expect(write()).rejects.toThrow();
    expect(await findAsset("/trip/route.geojson")).toBeNull();
  });
});
