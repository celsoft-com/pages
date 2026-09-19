// The only outbound calls the site makes. Every one of them runs while a page is being authored and
// its answer is stored: a coordinate in a collection, a line in an asset. Nothing here is ever
// reached by a visitor, and that is the whole reason it is allowed to exist. A provider in the
// request path would put a third party in front of every reader and make a response that cannot be
// cached at the edge.
//
// Nothing a provider returns is passed through. Each adapter maps its answer onto the shapes below,
// which are the intersection of what every geocoder and router can produce: no vendor identifier,
// no vendor score scale, no formatted label, no styling. A vendor id in a published result would
// marry the API to that vendor for the life of the API.

const TIMEOUT_MS = 20_000;
const USER_AGENT = "pages-site (+https://github.com/celsoft-com/pages)";

export type Profile = "driving" | "cycling" | "walking";
export const PROFILES: Profile[] = ["driving", "cycling", "walking"];

// GeoJSON order, [lon, lat], optionally with elevation third (RFC 7946 §3.1.1). A router that knows
// the terrain says so here, and a bike page wanting an elevation profile reads it straight off the
// stored line rather than asking anyone a second time.
export type Position = number[];

export interface GeocodeCandidate {
  lat: number;
  lon: number;
  name: string;
  // The place around the place: "Bavaria, Germany". Components, never a label composed for display,
  // because a caller renders it and a renderer wants the pieces.
  context: string | null;
  // Provider supplied and advisory: "city", "locality", "railway". Not an enumeration, because
  // normalizing one across geocoders loses the distinction that made it worth having.
  kind: string | null;
  // Comparable between candidates in one response and nowhere else. Scales differ per provider.
  confidence: number | null;
}

export interface GeocodeResult {
  provider: string;
  attribution: string;
  candidates: GeocodeCandidate[];
}

export interface RouteLeg {
  distance_m: number;
  duration_s: number;
}

export interface RouteResult {
  provider: string;
  attribution: string;
  coordinates: Position[];
  distance_m: number;
  duration_s: number;
  // Null where the router does not report it rather than zero, because zero climb and no answer are
  // different facts and a cyclist reading the second as the first is being misled.
  ascent_m: number | null;
  descent_m: number | null;
  // Empty where the router does not break the line down by stop. Not every engine does.
  legs: RouteLeg[];
}

const OSM = "© OpenStreetMap contributors, ODbL";

function apiKey(): string {
  if (typeof process === "undefined") return "";
  return (process.env?.ORS_API_KEY ?? "").trim();
}

export function keyed(): boolean {
  return apiKey() !== "";
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: { "user-agent": USER_AGENT, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`The ${new URL(url).host} service answered ${response.status}. Nothing was written.`);
    }
    return response;
  } catch (error) {
    if (error instanceof Error && /answered \d+/.test(error.message)) throw error;
    const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "could not be reached";
    throw new Error(`The ${new URL(url).host} service ${reason}. Nothing was written; try again.`);
  }
}

async function getJson(url: string, init: RequestInit = {}): Promise<any> {
  return (await request(url, { ...init, headers: { accept: "application/json", ...(init.headers ?? {}) } })).json();
}

function trimContext(label: string, name: string): string | null {
  const rest = label.startsWith(`${name}, `) ? label.slice(name.length + 2) : label === name ? "" : label;
  return rest.trim() === "" ? null : rest.trim();
}

function num(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function nominatimGeocode(query: string, limit: number): Promise<GeocodeResult> {
  const url =
    "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({ q: query, format: "jsonv2", limit: String(limit) });
  const rows = (await getJson(url)) as any[];
  return {
    provider: "nominatim",
    attribution: OSM,
    candidates: (Array.isArray(rows) ? rows : []).map((row) => {
      const label = String(row.display_name ?? "");
      const name = String(row.name || label.split(",")[0] || query).trim();
      return {
        lat: Number(row.lat),
        lon: Number(row.lon),
        name,
        context: trimContext(label, name),
        kind: row.type ? String(row.type) : null,
        confidence: typeof row.importance === "number" ? row.importance : null,
      };
    }),
  };
}

async function orsGeocode(query: string, limit: number): Promise<GeocodeResult> {
  const url =
    "https://api.openrouteservice.org/geocode/search?" +
    new URLSearchParams({ api_key: apiKey(), text: query, size: String(limit) });
  const body = await getJson(url);
  const features = Array.isArray(body?.features) ? body.features : [];
  return {
    provider: "openrouteservice",
    attribution: `${OSM}; geocoding by openrouteservice`,
    candidates: features.map((feature: any) => {
      const p = feature?.properties ?? {};
      const [lon, lat] = feature?.geometry?.coordinates ?? [NaN, NaN];
      const name = String(p.name ?? query).trim();
      return {
        lat: Number(lat),
        lon: Number(lon),
        name,
        context: p.label ? trimContext(String(p.label), name) : null,
        kind: p.layer ? String(p.layer) : null,
        confidence: typeof p.confidence === "number" ? p.confidence : null,
      };
    }),
  };
}

export async function geocode(query: string, limit: number): Promise<GeocodeResult> {
  return keyed() ? orsGeocode(query, limit) : nominatimGeocode(query, limit);
}

// The public OSRM server is a car-only deployment that accepts any profile in its path and answers
// the same either way: driving, bike and foot return an identical distance and duration for the same
// pair. So it is used for driving and never for anything else, and BRouter, which is a bicycle
// router first, carries cycling and walking. A walking route that was silently a motorway is the
// exact failure this codebase refuses everywhere else.
async function osrmRoute(stops: Position[]): Promise<RouteResult> {
  const path = stops.map(([lon, lat]) => `${lon},${lat}`).join(";");
  const url =
    `https://router.project-osrm.org/route/v1/driving/${path}?` +
    new URLSearchParams({ overview: "full", geometries: "geojson" });
  const body = await getJson(url);
  const route = body?.routes?.[0];
  if (!route) throw new Error("No route was found between those stops.");
  return {
    provider: "osrm",
    attribution: `${OSM}; routing by OSRM`,
    coordinates: route.geometry.coordinates as Position[],
    distance_m: Math.round(route.distance),
    duration_s: Math.round(route.duration),
    ascent_m: null,
    descent_m: null,
    legs: (route.legs ?? []).map((leg: any) => ({
      distance_m: Math.round(leg.distance),
      duration_s: Math.round(leg.duration),
    })),
  };
}

// BRouter answers with GeoJSON already, carries elevation as the third ordinate, and reports a
// filtered ascent rather than the raw sum of every wobble in the terrain data, which is the number a
// cyclist actually wants. It returns one line and no per-stop breakdown, so legs comes back empty.
const BROUTER_PROFILE: Partial<Record<Profile, string>> = {
  cycling: "trekking",
  walking: "hiking-beta",
};

async function brouterRoute(stops: Position[], profile: Profile): Promise<RouteResult> {
  const name = BROUTER_PROFILE[profile];
  if (!name) throw new Error(`BRouter has no profile for ${profile}.`);
  const url =
    "https://brouter.de/brouter?" +
    new URLSearchParams({
      lonlats: stops.map(([lon, lat]) => `${lon},${lat}`).join("|"),
      profile: name,
      alternativeidx: "0",
      format: "geojson",
    });
  const body = await getJson(url);
  const feature = body?.features?.[0];
  if (!feature?.geometry?.coordinates?.length) throw new Error("No route was found between those stops.");
  const p = feature.properties ?? {};
  const distance = num(p["track-length"]);
  const duration = num(p["total-time"]);
  return {
    provider: "brouter",
    attribution: `${OSM}; routing by BRouter`,
    coordinates: feature.geometry.coordinates as Position[],
    distance_m: distance === null ? 0 : Math.round(distance),
    duration_s: duration === null ? 0 : Math.round(duration),
    ascent_m: num(p["filtered ascend"]),
    descent_m: null,
    legs: [],
  };
}

const ORS_PROFILE: Record<Profile, string> = {
  driving: "driving-car",
  cycling: "cycling-regular",
  walking: "foot-walking",
};

async function orsRoute(stops: Position[], profile: Profile): Promise<RouteResult> {
  const url = `https://api.openrouteservice.org/v2/directions/${ORS_PROFILE[profile]}/geojson`;
  const body = await getJson(url, {
    method: "POST",
    headers: { authorization: apiKey(), "content-type": "application/json" },
    body: JSON.stringify({ coordinates: stops.map(([lon, lat]) => [lon, lat]), elevation: true }),
  });
  const feature = body?.features?.[0];
  if (!feature) throw new Error("No route was found between those stops.");
  const summary = feature.properties?.summary ?? {};
  return {
    provider: "openrouteservice",
    attribution: `${OSM}; routing by openrouteservice`,
    coordinates: feature.geometry.coordinates as Position[],
    distance_m: Math.round(summary.distance ?? 0),
    duration_s: Math.round(summary.duration ?? 0),
    ascent_m: num(feature.properties?.ascent),
    descent_m: num(feature.properties?.descent),
    legs: (feature.properties?.segments ?? []).map((segment: any) => ({
      distance_m: Math.round(segment.distance),
      duration_s: Math.round(segment.duration),
    })),
  };
}

export async function route(stops: Position[], profile: Profile): Promise<RouteResult> {
  if (keyed()) return orsRoute(stops, profile);
  return profile === "driving" ? osrmRoute(stops) : brouterRoute(stops, profile);
}
