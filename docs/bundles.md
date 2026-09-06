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
/trip/images/coburg.jpg  asset, in /trip
```

Pages, collections and assets are all just things at paths. None of them owns any other. Bundles nest,
so a resource is in every bundle above it, and a path is a bundle whether or not a page sits at it.

Nothing is stored. The rule is computed from paths on every request.

## Matching is on segments, never string prefixes

This is the one place the implementation goes wrong, and the bug is silent.

`"/bavaria-lessons/lessons".startsWith("/bavaria")` is true, but `bavaria` and `bavaria-lessons` are
different segments, so `/bavaria` does not hold it. That pair exists on the live site. Compare segment
arrays, not strings.

| Bundle | Path | Held |
|---|---|---|
| `/trip` | `/trip` | yes |
| `/trip` | `/trip/items` | yes |
| `/trip` | `/trip/day1/items` | yes |
| `/trip` | `/tripwire/items` | **no** |
| `/bavaria` | `/bavaria-lessons/lessons` | **no** |
| `/bavaria-lessons` | `/bavaria-lessons/lessons` | yes |

In `delete_bundle` this is the difference between a wrong listing and permanent data loss.

## The one exception: nothing holds the whole site

`/` would hold everything, so it is not a bundle.

- **`list_bundle` and `delete_bundle` refuse `/`.** That is the entire rule.
- **A resource may still sit at `/`.** A page, collection or asset there is an ordinary resource; it is just
  not reachable through a bundle. A collection at `/` keeps its `/data/index.json` address.
- **What a browser gets at `/` is the page in the `/root` folder.** `/root` is an ordinary bundle, and `/root`
  itself redirects to `/` so that page has one URL.
- **Nothing is migrated.** A page already stored at `/` stays exactly where it is.

## Organization is not a boundary

A bundle says where something lives. It says nothing about who may read or write it.

- Any page may fetch any collection, from any bundle. Served JSON stays public at `/data/<path>.json`.
- `set_collection_refs` may point at a collection in another bundle.
- No write is ever rejected, and nothing is ever moved, renamed or deleted as a side effect.

## Operations

- **`list_bundle <path>`** — every page, collection and asset at or under the path, with item counts,
  revs, declared refs, sizes and public URLs. Errors where nothing is published at the path at all,
  which is a different situation from a bundle holding only its own page.
- **`delete_bundle <path>`** — deletes everything at and under the path. The only tool that deletes more
  than one thing. Without `confirm: true` it deletes nothing and returns the inventory it would delete,
  plus every record in another bundle that references an id it would remove.
- **`delete_page <path>`** — deletes one page and leaves the rest of its bundle untouched, naming it.
- **`upload_asset`** — takes an optional `path` to file the asset into a bundle. Without one it is stored
  under a content hash, which keeps working forever but sits in no bundle.

Serving is unchanged. Collection `/a/b` is served at `/data/a/b.json` as a bare JSON array.

## Acceptance

- `/bavaria` does not hold `/bavaria-lessons/lessons`, in listing or in delete.
- `list_bundle('/trip')` holds `/trip/day1/items`, and so does `list_bundle('/trip/day1')`.
- `list_bundle` and `delete_bundle` refuse `/`, while a page or collection may still sit there.
- A collection at `/` still writes and still serves at `/data/index.json`.
- The home page at `/root` serves at `/`, and `/root` redirects there.
- An asset at `/trip/images/coburg.jpg` serves at `/assets/trip/images/coburg.jpg`; one uploaded before
  paths keeps its exact hash URL.
- An asset named `index.html` or `notes.md` keeps its filename.
- `delete_bundle` without `confirm` deletes nothing and lists what it would remove.
- Against the current site: zero bytes of stored data change, `GET /data/trip/items.json` still returns
  all 195 items, and `put_item` to `/trip/items` still succeeds.
