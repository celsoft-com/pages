import { endpoint } from "@celsoft/platform";
import { z } from "zod";
import { normalizeAssetPath } from "../pages/path";
import { PREFERS, PROFILES } from "../geo/providers";
import { geocodeQuery, MAX_STOPS, parsePrefer, parseProfile, parseStops, routeToAsset } from "../geo/service";
import { atPath, site } from "./shared";

export const geoEndpoints = {
  geocode: endpoint(
    {
      serve: ["api", "mcp"],
      method: "GET",
      path: "/api/v1/geocode",
      description:
        "Turn a place name or address into candidate coordinates. It returns several candidates with the place around " +
        "each one, never a single answer, because a geocoder is a guess and only the caller can tell which candidate is " +
        "the place meant. Read them, choose one, and store its lat and lon on a collection item. " +
        "Ask for the specific thing rather than the town when precision matters: a town is an area and its station is " +
        "a point, and they can be kilometres apart. An empty result means nothing matched, which is not a bad match but " +
        "no match at all, and over-qualifying a query is the usual cause. " +
        "Store the pair as separate numeric lat and lon fields, never as a two-element array: GeoJSON writes [lon, lat] " +
        "and most map libraries take [lat, lon], so a transposed pair validates, renders and is silently wrong. " +
        "Show the attribution in the reply on any page built from these coordinates. This runs while a page is being " +
        "written and its answer is stored; a page never geocodes when a visitor opens it.",
      access: { point: site, level: "read" },
      input: z.object({
        query: z.string().describe("A place name or address, for example 'Union Station, Springfield'"),
        limit: z.number().optional().describe("How many candidates to return, 1 to 10. Default 5."),
      }),
      output: z.object({
        query: z.string().describe("Echoed back, trimmed"),
        provider: z.string(),
        attribution: z.string().describe("Show this on any page built from these coordinates. It is a licence condition."),
        candidates: z
          .array(
            z.object({
              lat: z.number(),
              lon: z.number(),
              name: z.string(),
              context: z.string().nullable().describe("The place around the place, in components rather than a label"),
              kind: z.string().nullable().describe("Provider supplied and advisory: city, locality, railway"),
              confidence: z.number().nullable().describe("Comparable between candidates in one response and nowhere else"),
            }),
          )
          .describe("Candidates to judge, never an answer. Empty means nothing matched at all."),
        count: z.number(),
      }),
    },
    ({ query, limit }, app) => geocodeQuery(app, query, limit),
  ),

  route: endpoint(
    {
      serve: ["api", "mcp"],
      method: "POST",
      path: "/api/v1/route",
      description:
        "Route through stops in the order given and write the geometry to an asset as a GeoJSON LineString, returning " +
        "only a summary. The line itself is never returned: a road route runs to thousands of points, and sending it out " +
        "so that it can be sent back spends the whole thing twice. Routing happens once, here, and the page fetches the " +
        "stored asset. Never route when a visitor opens a page: the answer cannot change, and it would put a third party " +
        "in front of every reader. " +
        "profile is cycling, walking or driving, cycling by default. Cycling and walking are routed by BRouter, whose " +
        "lines carry elevation and whose reply reports ascent; driving by OSRM. A deploy with an openrouteservice key " +
        "routes everything through openrouteservice instead, which takes no prefer and reports no ways. " +
        "prefer is safety, balanced or speed, and applies to cycling only. It is a real trade rather than a label: on one " +
        "67 km ride, safety spent 1.6 km extra to cut main-road riding from 4.5 km to 2.7 km, while speed put 49 km of the " +
        "same ride on primary and secondary roads. Asking for safety on a walking or driving route is refused rather than " +
        "ignored. " +
        "The reply reports what the ways are actually made of, under ways: metres by surface and by highway type, how much " +
        "is on a signed cycle route, and warnings for explicit prohibitions such as bicycle=no. Check those before telling " +
        "anyone a route is rideable. analyzed_m is how much of the route carried tags at all, and it is 0 when the router " +
        "reports none: that means nothing was examined, which is not the same as nothing being wrong. None of it is a " +
        "safety score, because safe depends on the rider; it is what OpenStreetMap records, and OpenStreetMap can be " +
        "wrong or silent. The stored asset also carries a per-way segments table keyed to coordinate indices, so a page " +
        "can colour the line by surface and point at the stretch it warns about. " +
        "The full line is stored unless simplify_m is passed, because how much detail a line needs depends on the zoom it " +
        "will be drawn at. Keep the stops themselves in a collection so the owner can edit them, and put the attribution " +
        "from the reply on any page that draws the line.",
      access: { point: atPath(normalizeAssetPath), level: "write" },
      input: z.object({
        stops: z
          .array(z.object({ lat: z.number(), lon: z.number() }))
          .describe(`Ordered stops, two to ${MAX_STOPS}, each an object with numeric lat and lon`),
        path: z.string().describe("Asset path to write, for example /trip/route.geojson"),
        profile: z.enum(PROFILES).optional().describe("cycling, walking or driving. Default cycling."),
        prefer: z.enum(PREFERS).optional().describe("Cycling only: safety, balanced or speed. Default balanced."),
        simplify_m: z
          .number()
          .optional()
          .describe("Drop points that move the line by less than this many metres. Default keeps every point."),
      }),
      output: z.object({
        path: z.string().describe("The asset the GeoJSON was written to"),
        url: z.string().describe("Where the page fetches the line"),
        provider: z.string(),
        attribution: z.string().describe("Put this on any page that draws the line"),
        profile: z.string().describe("cycling, walking or driving"),
        prefer: z.string().describe("safety, balanced or speed"),
        distance_m: z.number(),
        duration_s: z.number(),
        ascent_m: z.number().nullable().describe("Null where the router reports none, which is not the same as no climb"),
        descent_m: z.number().nullable(),
        points: z.number().describe("Coordinates in the stored line, after any simplification"),
        has_elevation: z.boolean().describe("The stored coordinates carry a third number"),
        bytes: z.number().describe("Size of the stored GeoJSON"),
        legs: z
          .array(z.object({ distance_m: z.number(), duration_s: z.number() }))
          .describe("One per pair of stops. Empty where the router does not break the line down."),
        ways: z.object({
          analyzed_m: z
            .number()
            .describe("How much of the route carried tags at all. 0 means nothing was examined, not that nothing is wrong."),
          surface_m: z.record(z.string(), z.number()).describe("Metres by surface. Untagged ground is counted under its own name."),
          way_type_m: z.record(z.string(), z.number()).describe("Metres by highway type"),
          on_cycle_route_m: z.number().describe("Metres on a signed cycle route"),
          warnings: z
            .array(
              z.object({
                kind: z.string().describe("An explicit prohibition, for example bicycle=no"),
                metres: z.number(),
                where: z.array(z.array(z.number())).describe("Ranges of coordinate indices into the stored line"),
              }),
            )
            .describe("Prohibitions somebody wrote down, never opinions about traffic"),
          segment_count: z.number().describe("Rows in the per-way table stored in the asset"),
        }),
      }),
    },
    ({ stops, path, profile, prefer, simplify_m }, app) =>
      routeToAsset(app, {
        stops: parseStops(stops),
        profile: parseProfile(profile),
        prefer: parsePrefer(prefer),
        to: path,
        simplifyMetres: simplify_m ?? 0,
        siteUrl: app.env.APP_URL,
      }),
  ),
};
