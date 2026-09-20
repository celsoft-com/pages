import { vi } from "vitest";

// The suite has never needed the network before: blobs are faked and nothing else left the process.
// Routing and geocoding are the first outbound calls the site makes, so they get the same treatment,
// with one canned answer per provider shaped exactly like the real one. The 3D coordinates in the
// BRouter fixture are not decoration: that provider returns elevation as a third ordinate and the
// code has to carry it through simplification untouched.

const NOMINATIM = [
  {
    lat: "49.8916",
    lon: "10.8868",
    name: "Springfield",
    display_name: "Springfield, Greenfield County, Illinois, United States",
    type: "town",
    importance: 0.72,
  },
  {
    lat: "49.9010",
    lon: "10.9000",
    name: "Springfield Union Station",
    display_name: "Springfield Union Station, Springfield, Illinois, United States",
    type: "station",
    importance: 0.41,
  },
];

const ORS_GEOCODE = {
  features: [
    {
      geometry: { coordinates: [10.8868, 49.8916] },
      properties: { name: "Springfield", label: "Springfield, Illinois, United States", layer: "locality", confidence: 0.9 },
    },
  ],
};

const BROUTER = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [10.9627, 50.2612, 291],
          [10.9628, 50.2, 300],
          [10.9629, 50.1, 305],
          [10.8917, 49.8917, 245],
        ],
      },
      properties: {
        "track-length": "56693",
        "total-time": "10104",
        "filtered ascend": "162",
        "plain-ascend": "-52",
        // One row per way segment, each ending on a coordinate of the line above. The real service
        // returns hundreds; three is enough to cover a tagged way, a prohibition and an untagged
        // surface, which are the three cases the analysis has to tell apart.
        messages: [
          ["Longitude", "Latitude", "Elevation", "Distance", "WayTags"],
          ["10962800", "50200000", "300", "12000", "highway=cycleway surface=asphalt route_bicycle_rcn=yes"],
          ["10962900", "50100000", "305", "11000", "highway=path surface=gravel bicycle=no"],
          ["10891700", "49891700", "245", "33693", "highway=residential"],
        ],
      },
    },
  ],
};

const OSRM = {
  routes: [
    {
      distance: 52300.4,
      duration: 2460.7,
      geometry: {
        type: "LineString",
        coordinates: [
          [10.9627, 50.2612],
          [10.93, 50.05],
          [10.8917, 49.8917],
        ],
      },
      legs: [{ distance: 52300.4, duration: 2460.7 }],
    },
  ],
};

const ORS_ROUTE = {
  features: [
    {
      geometry: {
        type: "LineString",
        coordinates: [
          [10.9627, 50.2612, 291],
          [10.8917, 49.8917, 245],
        ],
      },
      properties: {
        summary: { distance: 51000, duration: 9000 },
        ascent: 210,
        descent: 260,
        segments: [{ distance: 51000, duration: 9000 }],
      },
    },
  ],
};

function json(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

export interface GeoStub {
  calls: string[];
}

// Routes a request to the fixture for whichever provider the URL names, so a test that changes
// provider changes nothing else. An unrecognised host throws rather than returning an empty answer,
// because a silent empty result is what this whole feature exists to avoid.
export function stubGeoFetch(overrides: { fail?: "timeout" | "status" } = {}): GeoStub {
  const stub: GeoStub = { calls: [] };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    stub.calls.push(url);

    if (overrides.fail === "timeout") {
      const error = new Error("aborted");
      error.name = "TimeoutError";
      throw error;
    }
    if (overrides.fail === "status") {
      return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
    }

    if (url.includes("nominatim.openstreetmap.org")) return json(NOMINATIM);
    if (url.includes("api.openrouteservice.org/geocode")) return json(ORS_GEOCODE);
    if (url.includes("brouter.de")) return json(BROUTER);
    if (url.includes("router.project-osrm.org")) return json(OSRM);
    if (url.includes("api.openrouteservice.org/v2/directions")) return json(ORS_ROUTE);

    throw new Error(`No geo fixture for ${url}`);
  });
  return stub;
}

export function clearGeoFetch(): void {
  vi.unstubAllGlobals();
}
