# Maps

Status: implemented. Two tools, `geocode` and `route`, and no map code anywhere in the site.

## 1. What the site does and does not do

A map is a page. The site stores the data behind one and serves it, exactly as it does for anything
else: the stops are a collection, the route geometry is an asset, the map is a page that fetches
both and draws them with a library from a CDN. Nothing in this repo knows what a tile is.

What the site does own is the two things a client cannot do for itself without a shell: turning a
place name into coordinates, and turning coordinates into a line that follows real ways. Both run
once, while a page is being written, and their answers are stored.

```
authoring (once)          stored (forever)              page load (every visit)
─────────────────         ────────────────              ──────────────────────
geocode  →  lat/lon   →   collection item          →    GET /data/<path>.json
route    →  geometry  →   asset, GeoJSON           →    GET /assets/<path>.geojson
                                                        + tiles + library, from a CDN
```

## 2. The rule that keeps this from becoming an integration platform

> **The site may do authoring-time work whose output it stores. It may never fetch at request time.**

Geocoding and routing qualify: each produces durable content. A weather feed, a live price or a
transit departure does not, and putting one behind a tool would place a provider in front of every
visitor and make a response that cannot be cached at the edge. That is the line, and it is the same
one that already separates a collection from a page that renders one.

These are the first outbound calls the site makes. Before them, the function called nothing.

## 3. Result shapes are provider-neutral on purpose

A handler's result is published API, so a vendor identifier in one would marry the API to that
vendor for the life of the API. Every adapter maps its provider's answer onto the intersection of
what all of them can produce, and never passes anything through:

- **No vendor ids.** No `place_id`, no `mapbox_id`, no provider-specific encoding.
- **No vendor score scales.** `confidence` is comparable between candidates in one response and
  nowhere else, and says so.
- **No formatted labels.** `name` and `context` are components. A caller composes what it displays.
- **No styling.** There is an established convention for putting `stroke` and `stroke-width` into
  GeoJSON properties and it is the wrong place for it. Appearance belongs to the page, and a stored
  line outlives every design it is ever drawn in.
- **SI units.** `distance_m`, `duration_s`, `ascent_m`. Kilometres and minutes are presentation.

`null` where a provider does not report something, never zero: no answer and no climb are different
facts, and a cyclist reading the second as the first is being misled.

## 4. geocode returns candidates, never an answer

A geocoder is a guess, and the caller is the only thing that can judge it. Returning one row invites
a service to take it, and a wrong Springfield is silent on every axis: the write succeeds, the JSON
validates, the page renders, and the pin is simply in the wrong place.

Two failures are worth naming because both look like success:

- **Nothing matched** is not a bad match. Over-qualifying is the usual cause; `Forchheim,
  Oberfranken, Bavaria, Germany` returns nothing where `Forchheim, Bavaria` returns the town.
- **The wrong granularity.** A town is an area and a station is a point. Asking for `Fürth` and
  asking for `Bahnhof Fürth` give answers 2.5 km apart, and both are correct.

Coordinates are stored as separate numeric `lat` and `lon` fields, never a two-element array.
GeoJSON orders them `[lon, lat]` and most map libraries take `[lat, lon]`, so a transposed pair
validates, renders and is wrong. [parseStops](../src/geo/service.ts) refuses a bare pair outright.

## 5. route writes the asset and returns a summary

The line is never returned. A 126 km road route is 3330 points and 75 KB; handing that to a caller
so the caller can hand it back spends the whole thing twice and asks every client to reimplement the
same simplification. What comes back is distance, duration, ascent, point count and the asset url,
which is what a caller actually reads.

**Simplification is off by default and takes metres.** How much detail a line needs is a question
about the zoom it will be drawn at, and that is the page's decision, not storage's. Points that
survive are returned exactly as the router sent them, elevation included: thinning a line must never
also edit the points it keeps.

## 6. Bike routes: choosing, then checking

Two different jobs, and a bike page needs both.

**Choosing** is `prefer`: `safety`, `balanced` or `speed`, cycling only. A real trade, measured on one
67 km Bamberg–Nürnberg ride:

| prefer | distance | main roads | on a signed cycle route |
| --- | --- | --- | --- |
| `safety` | 68.7 km | 2.7 km | 93% |
| `balanced` | 67.1 km | 4.5 km | 89% |
| `speed` | 63.8 km | 48.4 km | 10% |

Safety buys that with unpaved: it adds around 2 km of track and path. Whether that is a good trade is
the rider's call, which is the argument for reporting the mix rather than scoring it. Asking for a
`prefer` on a walking or driving route is refused rather than ignored, because a caller who asked for
a safer line and silently got the ordinary one believes something untrue about their route.

**Checking** is `ways` in the reply: metres by surface, metres by highway type, metres on a signed
cycle route, and `warnings` for explicit prohibitions. Only unambiguous ones — `bicycle=no`,
`bicycle=dismount`, `access=private`, `access=no`. "Busy road" is an opinion; `bicycle=no` is a fact
somebody went and wrote down. That ride has 96 m of it, at both ends, which no profile avoids because
it is the way in and out of Bamberg's old town.

**`analyzed_m` is the honesty field.** It is how much of the route carried tags at all, and it is `0`
when the router reports none, which is the [check_refs](../src/mcp/tools.ts) rule again: a summary
that checked nothing must not read like a summary that passed. Untagged ground is counted under
`untagged` in the breakdowns for the same reason. OSM coverage is near total in Bavaria and thin
elsewhere, and a route that is 40% untagged must not look like a route that is 40% asphalt.

**None of it is a safety score**, and nothing here will add one. Safe depends on whether it is you or
a seven-year-old, a score cannot survive a provider change, and the moment one exists people stop
reading the breakdown.

The stored asset carries a per-way `segments` table keyed to coordinate indices, so a page can colour
the line by surface and point at the stretch it warns about. Simplification remaps those indices,
because thinning the line must never leave the table pointing at the wrong places while still looking
valid.

## 7. Providers

| profile | keyless | with `ORS_API_KEY` |
| --- | --- | --- |
| cycling | BRouter, `safety` / `trekking` / `fastbike` by `prefer` | openrouteservice, `cycling-regular` |
| walking | BRouter, `hiking-beta` | openrouteservice, `foot-walking` |
| driving | OSRM | openrouteservice, `driving-car` |
| geocoding | Nominatim | openrouteservice (Pelias) |

**Cycling and walking must never go to the public OSRM server.** It is a car-only deployment that
accepts any profile in its path and answers identically either way: `driving`, `bike` and `foot`
return the same distance and duration for the same pair. A walking route that is silently a motorway
is exactly the failure this codebase refuses everywhere else.

BRouter answers in GeoJSON already, carries elevation as a third ordinate, and reports a *filtered*
ascent rather than the sum of every wobble in the terrain data, which is the number a cyclist wants.
It returns one line and no per-stop breakdown, so `legs` comes back empty; OSRM and openrouteservice
fill it. An empty `legs` means the router does not break the line down, not that the route has one
leg.

All of these are fair-use services. `ORS_API_KEY` buys an SLA, and today it costs two things: there is
no equivalent of BRouter's `safety` profile, so a non-balanced `prefer` is refused rather than
approximated, and openrouteservice reports surface through a different encoding that nothing here has
been able to verify against a real key, so `analyzed_m` comes back `0`. Both are stated by the
response rather than papered over. Wiring `extra_info` up is the obvious next job.

## 8. The page side

The site steers it and does not implement it. The MCP instructions in
[handler.ts](../src/mcp/handler.ts) tell a client to keep stops in a collection, fetch the asset for
the line, route once rather than per visit, and carry the attribution string, which is a licence
condition rather than a courtesy. That text is served by the site, so it updates when the site
deploys and there is no second copy to go stale.

The shipped skill is unchanged and needs no change: it names no tools and carries no instructions,
it points an agent at the site to fetch both. A newer deploy teaches its own conventions with nothing
to update on anyone's laptop.

Renderer and tiles are page decisions the repo has no opinion about. Leaflet is small and takes
raster tiles; MapLibre GL is larger, takes vector tiles and can be restyled in the browser. The
stored line is plain GeoJSON and is tied to neither, so swapping one for the other touches no data.
