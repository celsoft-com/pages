import { assetUrlFor, putAsset } from "../assets/service";
import { normalizeAssetPath } from "../pages/path";
import {
  PROFILES,
  geocode as providerGeocode,
  route as providerRoute,
  type Position,
  type Profile,
  type RouteLeg,
} from "./providers";

// A route is written straight to an asset rather than returned. The geometry for a 126 km drive is
// 3330 points and 75 KB; handing that to a caller so the caller can hand it back spends the same
// bytes twice and asks every client to reimplement the same simplification. What comes back is the
// summary, which is what a caller actually reads.

export const MAX_STOPS = 50;
const MAX_ASSET_BYTES = 4 * 1024 * 1024;
const METRES_PER_DEGREE = 111_320;

export function parseStops(raw: unknown): Position[] {
  if (!Array.isArray(raw) || raw.length < 2) {
    throw new Error("stops must be an array of at least two {lat, lon} objects, in the order they are visited.");
  }
  if (raw.length > MAX_STOPS) {
    throw new Error(`stops is limited to ${MAX_STOPS}; ${raw.length} were given.`);
  }
  // Named fields, never a bare pair. GeoJSON orders coordinates [lon, lat] and most map libraries
  // take [lat, lon], so a two-element array in an argument is a silent transposition waiting to
  // happen: the write succeeds, the JSON validates, and the pin lands in the wrong hemisphere.
  return raw.map((stop, index) => {
    const lat = Number((stop as { lat?: unknown })?.lat);
    const lon = Number((stop as { lon?: unknown })?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error(`stops[${index}] needs a numeric lat and lon.`);
    }
    if (lat < -90 || lat > 90) throw new Error(`stops[${index}].lat is ${lat}; latitude runs from -90 to 90.`);
    if (lon < -180 || lon > 180) throw new Error(`stops[${index}].lon is ${lon}; longitude runs from -180 to 180.`);
    return [lon, lat];
  });
}

export function parseProfile(raw: unknown): Profile {
  if (raw === undefined || raw === null || raw === "") return "cycling";
  if (!PROFILES.includes(raw as Profile)) throw new Error(`profile must be one of ${PROFILES.join(", ")}.`);
  return raw as Profile;
}

function perpendicular(p: number[], a: number[], b: number[]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function douglasPeucker(points: number[][], tolerance: number): number[][] {
  if (points.length < 3) return points;
  let worst = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicular(points[i], points[0], points[points.length - 1]);
    if (distance > worst) {
      worst = distance;
      index = i;
    }
  }
  if (worst <= tolerance) return [points[0], points[points.length - 1]];
  return [
    ...douglasPeucker(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...douglasPeucker(points.slice(index), tolerance),
  ];
}

// Tolerance arrives in metres because a caller thinks in metres, and is applied in a space where a
// degree of longitude has been scaled by the latitude so the two axes are comparable. Points that
// survive are returned exactly as the router sent them, elevation included, because thinning a line
// must never also edit the points it keeps.
//
// Simplifying is the caller's choice and off by default: how much detail a line needs is a question
// about the zoom it will be drawn at, and that is a decision belonging to the page, not to storage.
export function simplify(coordinates: Position[], metres: number): Position[] {
  if (!(metres > 0) || coordinates.length < 3) return coordinates;
  const meanLat = coordinates.reduce((sum, position) => sum + position[1], 0) / coordinates.length;
  const scale = Math.max(Math.cos((meanLat * Math.PI) / 180), 1e-6);
  const projected = coordinates.map((position, index) => [position[0] * scale, position[1], index]);
  return douglasPeucker(projected, metres / METRES_PER_DEGREE).map((point) => coordinates[point[2]]);
}

export interface RouteWrite {
  path: string;
  url: string;
  provider: string;
  attribution: string;
  profile: Profile;
  distance_m: number;
  duration_s: number;
  ascent_m: number | null;
  descent_m: number | null;
  points: number;
  has_elevation: boolean;
  bytes: number;
  legs: RouteLeg[];
}

export async function routeToAsset(input: {
  stops: Position[];
  profile: Profile;
  to: string;
  simplifyMetres: number;
  siteUrl: string;
}): Promise<RouteWrite> {
  const path = normalizeAssetPath(input.to);
  if (path === "/") throw new Error("to must name a file, for example /trip/route.geojson");

  const result = await providerRoute(input.stops, input.profile);
  const coordinates = simplify(result.coordinates, input.simplifyMetres);

  // Provenance only. No name, no colour, no width: there is a whole convention for putting styling
  // into GeoJSON properties and it is the wrong place for it, because appearance belongs to the page
  // and a stored line outlives every design it is ever drawn in.
  const feature = {
    type: "Feature",
    geometry: { type: "LineString", coordinates },
    properties: {
      distance_m: result.distance_m,
      duration_s: result.duration_s,
      ascent_m: result.ascent_m,
      descent_m: result.descent_m,
      profile: input.profile,
      provider: result.provider,
      attribution: result.attribution,
      generated: new Date().toISOString().slice(0, 10),
    },
  };

  const bytes = new TextEncoder().encode(JSON.stringify(feature));
  if (bytes.byteLength > MAX_ASSET_BYTES) {
    throw new Error(
      `That route is ${Math.round(bytes.byteLength / (1024 * 1024))} MB of geometry. Pass simplify_m to reduce it.`,
    );
  }

  const asset = await putAsset({
    filename: path.split("/").pop() || "route.geojson",
    contentType: "application/geo+json",
    bytes: bytes.buffer as ArrayBuffer,
    path,
  });

  return {
    path: asset.path ?? path,
    url: `${input.siteUrl}${assetUrlFor(asset)}`,
    provider: result.provider,
    attribution: result.attribution,
    profile: input.profile,
    distance_m: result.distance_m,
    duration_s: result.duration_s,
    ascent_m: result.ascent_m,
    descent_m: result.descent_m,
    points: coordinates.length,
    has_elevation: coordinates.length > 0 && coordinates[0].length > 2,
    bytes: bytes.byteLength,
    legs: result.legs,
  };
}

export async function geocodeQuery(query: unknown, limit: unknown) {
  if (typeof query !== "string" || query.trim() === "") throw new Error("query is required");
  const capped = Math.max(1, Math.min(10, Math.trunc(Number(limit)) || 5));
  const result = await providerGeocode(query.trim(), capped);
  return {
    query: query.trim(),
    provider: result.provider,
    attribution: result.attribution,
    // Candidates, never an answer. A geocoder is a guess and the caller is the only thing that can
    // judge it: a service that silently took the first row put the wrong Springfield on a map and
    // nothing anywhere reported it.
    candidates: result.candidates,
    count: result.candidates.length,
  };
}
