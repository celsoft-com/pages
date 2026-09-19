import type { Position } from "./providers";

// What the ways under a route are actually made of. This reports and never scores: OSM tags are
// facts, "safe" is a judgement that depends on the rider, and a single number would be the first
// thing to break when the provider changes. A page decides what it considers rideable.

export interface Segment {
  from: number;
  to: number;
  m: number;
  surface: string | null;
  way: string | null;
  // Present only when the way says something explicit about bicycles.
  bicycle: string | null;
  cycle_route: boolean;
}

export interface Warning {
  kind: string;
  metres: number;
  where: [number, number][];
}

export interface TagAnalysis {
  // How much of the route carried usable tags. Zero means nothing was examined, which is not the
  // same as nothing being wrong, and the caller has to be able to tell those apart.
  analyzed_m: number;
  surface_m: Record<string, number>;
  way_type_m: Record<string, number>;
  on_cycle_route_m: number;
  warnings: Warning[];
  segments: Segment[];
}

// Only unambiguous prohibitions. "Busy road" is an opinion; bicycle=no is a fact written down by
// somebody who went and looked.
const PROHIBITIONS: Record<string, (tags: Record<string, string>) => boolean> = {
  "bicycle=no": (t) => t.bicycle === "no",
  "bicycle=dismount": (t) => t.bicycle === "dismount",
  "access=private": (t) => t.access === "private",
  "access=no": (t) => t.access === "no",
};

function parseTags(raw: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const pair of raw.split(/\s+/)) {
    const at = pair.indexOf("=");
    if (at > 0) tags[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return tags;
}

function add(into: Record<string, number>, key: string, metres: number): void {
  into[key] = (into[key] ?? 0) + metres;
}

export function emptyAnalysis(): TagAnalysis {
  return { analyzed_m: 0, surface_m: {}, way_type_m: {}, on_cycle_route_m: 0, warnings: [], segments: [] };
}

// BRouter reports one row per way segment, each carrying the OSM tags of that way and the distance
// along it, and each row's coordinate is a point of the returned line. Every row matches a
// coordinate exactly and the distances sum to the stated track length, so the table below is the
// whole route with nothing dropped and nothing invented.
export function analyseBrouter(messages: unknown, coordinates: Position[]): TagAnalysis {
  const rows = Array.isArray(messages) ? (messages as string[][]) : [];
  if (rows.length < 2) return emptyAnalysis();

  const header = rows[0];
  const iDistance = header.indexOf("Distance");
  const iTags = header.indexOf("WayTags");
  if (iDistance < 0 || iTags < 0) return emptyAnalysis();

  const index = new Map<string, number>();
  coordinates.forEach((position, at) => {
    const key = `${position[0].toFixed(6)},${position[1].toFixed(6)}`;
    if (!index.has(key)) index.set(key, at);
  });

  const analysis = emptyAnalysis();
  const hits: Record<string, { metres: number; where: [number, number][] }> = {};
  let previous = 0;

  for (const row of rows.slice(1)) {
    const metres = Number(row[iDistance]);
    if (!Number.isFinite(metres)) continue;
    const lon = Number(row[0]) / 1e6;
    const lat = Number(row[1]) / 1e6;
    const to = index.get(`${lon.toFixed(6)},${lat.toFixed(6)}`) ?? previous;
    const tags = parseTags(row[iTags] ?? "");

    const surface = tags.surface ?? null;
    const way = tags.highway ?? null;
    const onRoute = Object.keys(tags).some((key) => key.startsWith("route_bicycle"));

    analysis.analyzed_m += metres;
    // An untagged way is unknown, not fine, and it is counted under its own name so a summary can
    // never read as a clean bill of health for ground nobody has surveyed.
    add(analysis.surface_m, surface ?? "untagged", metres);
    add(analysis.way_type_m, way ?? "untagged", metres);
    if (onRoute) analysis.on_cycle_route_m += metres;

    for (const [kind, matches] of Object.entries(PROHIBITIONS)) {
      if (!matches(tags)) continue;
      const found = (hits[kind] ??= { metres: 0, where: [] });
      found.metres += metres;
      const last = found.where[found.where.length - 1];
      if (last && last[1] === previous) last[1] = to;
      else found.where.push([previous, to]);
    }

    analysis.segments.push({
      from: previous,
      to,
      m: Math.round(metres),
      surface,
      way,
      bicycle: tags.bicycle ?? null,
      cycle_route: onRoute,
    });
    previous = to;
  }

  analysis.analyzed_m = Math.round(analysis.analyzed_m);
  analysis.on_cycle_route_m = Math.round(analysis.on_cycle_route_m);
  for (const bucket of [analysis.surface_m, analysis.way_type_m]) {
    for (const key of Object.keys(bucket)) bucket[key] = Math.round(bucket[key]);
  }
  analysis.warnings = Object.entries(hits)
    .map(([kind, found]) => ({ kind, metres: Math.round(found.metres), where: found.where }))
    .sort((a, b) => b.metres - a.metres);

  return analysis;
}

// Simplification drops coordinates, so every index in the table has to move with them or the
// segments would point at the wrong places while still looking valid.
export function remapSegments(analysis: TagAnalysis, kept: number[]): TagAnalysis {
  if (analysis.segments.length === 0) return analysis;
  const moved = new Map<number, number>();
  kept.forEach((original, now) => moved.set(original, now));

  const nearest = (original: number): number => {
    for (let at = original; at >= 0; at--) {
      const found = moved.get(at);
      if (found !== undefined) return found;
    }
    return 0;
  };

  return {
    ...analysis,
    segments: analysis.segments.map((segment) => ({
      ...segment,
      from: nearest(segment.from),
      to: nearest(segment.to),
    })),
    warnings: analysis.warnings.map((warning) => ({
      ...warning,
      where: warning.where.map(([from, to]) => [nearest(from), nearest(to)] as [number, number]),
    })),
  };
}
