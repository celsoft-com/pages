---
title: Path bundles
order: 70
---

# Path bundles

Everything on the site is organized by path, exactly like a folder tree. Nothing else.

## The rule

A path is a **bundle**. It holds every page, collection and asset at or under it.

```
/trip                  bundle
/trip                  page
/trip/items            collection, in /trip
/trip/day1             page, in /trip
/trip/day1/items       collection, in /trip/day1 and in /trip
/trip/images/photo.jpg  asset, in /trip
```

Pages, collections and assets are all just things at paths. None of them owns any other. Bundles nest,
so a resource is in every bundle above it, and a path is a bundle whether or not a page sits at it.

Nothing is stored. The rule is computed from paths on every request.

## Matching is on segments, never string prefixes

This is the one place the implementation goes wrong, and the bug is silent.

`"/photos-archive/lessons".startsWith("/photos")` is true, but `photos` and `photos-archive` are
different segments, so `/photos` does not hold it. Near-miss neighbours like that are common. Compare segment
arrays, not strings.

| Bundle | Path | Held |
|---|---|---|
| `/trip` | `/trip` | yes |
| `/trip` | `/trip/items` | yes |
| `/trip` | `/trip/day1/items` | yes |
| `/trip` | `/tripwire/items` | **no** |
| `/photos` | `/photos-archive/lessons` | **no** |
| `/photos-archive` | `/photos-archive/lessons` | yes |

In `delete_bundle` this is the difference between a wrong listing and permanent data loss.

## The one exception: nothing holds the whole site

`/` would hold everything, so it is not a bundle.

- **Every operation that takes a bundle path refuses `/`.** Listing, deleting, copying and moving alike, and
  at both ends of a copy or move. That is the entire rule. State it that way rather than naming the tools,
  so it stays true as tools are added.
- **A resource may still sit at `/`.** A page, collection or asset there is an ordinary resource; it is just
  not reachable through a bundle. A collection at `/` keeps its `/data/index.json` address.
- **What a browser gets at `/` is the site contents**, a list of every public page, generated on every request.
  Nothing publishes, edits or deletes it. `/root` names it as a path, which is what closes it and opens it with a
  share link, and `/root` itself redirects to `/` so it has one URL. The `/root` folder is otherwise ordinary: the
  favicon and anything else filed there behaves like any other resource.
- **Nothing is migrated.** A page already stored at `/` stays exactly where it is.

## Organization is not a boundary

A bundle says where something lives. It says nothing about who may read or write it.

- Any page may fetch any collection, from any bundle. Served JSON stays public at `/data/<path>.json`.
- `set_collection_refs` may point at a collection in another bundle.
- No write is ever rejected, and nothing is ever moved, renamed or deleted as a side effect.

## The tools that work on a bundle

`list_bundle` returns everything at or under a path, with item counts, revisions, declared references,
sizes and public URLs, which is how you see what one page is made of. `copy_bundle`, `move_bundle` and
`delete_bundle` take the whole thing together, and do nothing until you confirm. See
[copy, move and delete](transfer.md), and the [tool reference](/docs/tools) for the calls themselves.

Serving is unaffected by any of it: collection `/a/b` is served at `/data/a/b.json` as a bare JSON
array, wherever the collection sits.
