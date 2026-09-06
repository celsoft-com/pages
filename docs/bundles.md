# Requirements: path bundles for the Pages MCP server

Status: draft for review. Written 2026-09-06 against the live state of `pages.odellfambly.us`.

## 1. Goal

Every page, collection and asset on a site groups by path alone. Given a path, list everything in it.
Given a collection or asset, say which page it belongs to.

Today nothing expresses this. Pages, collections and assets are separate flat namespaces that happen to
sit next to each other, and the relationship between them lives only inside each page's JavaScript.

## 2. Current state

Six pages, six collections, as of this writing.

| Page | Format | Collections it fetches |
|---|---|---|
| `/` | markdown | none |
| `/bavaria-lessons` | html | `/bavaria/lessons`, `/bavaria/meta` |
| `/fancy` | html | none |
| `/germanfunstuff` | html | `/trip/sections`, `/trip/filters`, `/trip/items`, `/trip/text` |
| `/hello` | markdown | none |
| `/hi` | html | none |

All six collections group under paths with no page, so after this release they report as ungrouped.
Rearranging them is the site owner's business, done through the ordinary tools whenever they get to it.

## 3. Definitions

- **Path**: the address of a page, collection or asset. Normalized to lowercase, leading slash, no
  trailing slash.
- **Bundle**: a path, plus every page, collection and asset at or under it. `/trip` is a bundle
  containing `/trip`, `/trip/items` and `/trip/day1/photo.jpg`. A bundle needs no page at its path.
- **Owner**: the page a resource belongs to. The nearest page above it. Computed from paths on every
  request, never stored.
- **Ungrouped**: no page above it. A description, not an error state.

## 4. The grouping rule

A path `P` contains a path `C` if `C` equals `P`, or `C` begins with `P` followed by `/`.

That single rule defines both operations:

- **A bundle** at `P` is every resource `P` contains.
- **The owner** of a resource is the longest page path containing it.

Bundles nest and overlap; owners do not. `/trip/day1/items` is in the bundle `/trip` and in the bundle
`/trip/day1`, and its owner is whichever of those is a page, the deeper one winning. A page at `/trip`
scopes everything below it even where a page at `/trip/day1` owns some of it directly.

### 4.1 Matching is on segment boundaries, not string prefixes

This is the requirement most likely to be implemented wrong, and the bug it prevents is silent.

A naive `C.startsWith(P)` check reports that `/bavaria` contains `/bavaria-lessons/lessons`. It does not.
`bavaria` and `bavaria-lessons` are different segments. This exact pair exists on the site today, which
is why it is called out rather than left to judgement.

Compare segment arrays, not strings. That removes the bug as a class rather than as a test case.

| Path | Resource | Contains |
|---|---|---|
| `/germanfunstuff` | `/germanfunstuff/items` | yes |
| `/germanfunstuff` | `/germanfunstuff` | yes |
| `/germanfunstuff` | `/germanfunstuff/a/b/c` | yes |
| `/bavaria` | `/bavaria-lessons/lessons` | **no** |
| `/bavaria-lessons` | `/bavaria-lessons/lessons` | yes |
| `/trip` | `/tripwire/items` | **no** |
| `/trip` | `/trip/day1/items` | yes |
| `/trip/day1` | `/trip/day1/items` | yes, and owns it over `/trip` |
| `/` | anything | **no**, see 4.2 |

**In `delete_bundle` this rule is the difference between a wrong listing and permanent data loss.**
See section 9.

### 4.2 The root page owns nothing

A page published at `/` is above every resource on the site. Exclude it from ownership entirely. A site
with a home page should not thereby have every collection assigned to the home page.

`/` is still a valid bundle path in the sense that it contains everything, which is exactly why
`delete_bundle` refuses it.

### 4.3 `/_collections` is reserved

The collection index is excluded from ownership, from bundle listings and from `delete_bundle`.

## 5. The rule applies to everything

Pages, collections and assets group identically. A page's data and its images live in the same bundle.

- **Collection paths** already look like paths and need no change in shape.
- **Asset paths take the same form.** An image belonging to `/germanfunstuff` lives at
  `/germanfunstuff/images/coburg.jpg` and is served at `/assets/germanfunstuff/images/coburg.jpg`.
- **Pages nest.** A bundle listing for `/trip` includes the page `/trip/day1` as well as its resources.

### 5.1 Existing asset URLs keep working

Assets are currently keyed by a hash of their contents and served at `/assets/<hash>.<ext>`. Those URLs
keep resolving, unchanged, forever. The rooted form is additive. Hash-keyed assets have no path and are
therefore always ungrouped, which is correct: they are not in any bundle.

Two consequences to be deliberate about:

- **Hash keys deduplicate identical bytes; path keys do not.** Two pages uploading the same image share
  one blob today and will not once they name it themselves. That is the cost of naming it.
- **Asset paths must not use the page path normalizer.** `normalizePath` strips `.md`, `.markdown`,
  `.htm` and `.html`, and pops a trailing `index` segment, so it would turn an asset at
  `/foo/index.html` into `/foo` and `/notes.md` into `/notes`. Assets need normalization that lowercases
  and cleans segments but preserves the filename whole.

## 6. Grouping is organizational, not a boundary

A bundle says where a resource lives. It says nothing about who may read it or write it.

- **Cross-bundle reads are expected.** A page at `/germanfunstuff` fetching `/bavaria-lessons/meta.json`
  is a legitimate thing for a client to do, and the server has no opinion about it. Served JSON stays
  public and unauthenticated at `/data/<path>.json`.
- **Cross-bundle references are allowed.** `set_collection_refs` may point a field at a collection in a
  different bundle. The client decides when pulling from elsewhere makes sense.
- **Shared resources are therefore possible** by putting them in whichever bundle suits and reading them
  from anywhere.

## 7. The server neither enforces nor mutates as a side effect

The server computes grouping and reports it. It changes nothing on its own.

- **No write is ever rejected on grouping grounds.** Creating a collection at an ungrouped path, writing
  items to one, reordering, deleting, uploading an asset: all continue to work exactly as they do today.
- **No read is ever blocked.** Every collection and asset stays reachable at its current URL.
- **Nothing is moved, copied, renamed or deleted as a side effect of any operation.** No migration,
  backfill or normalization pass at startup or on upgrade.
- **`delete_page` deletes one page.** Resources under that path are untouched. Their owner becomes
  whatever page remains above them, or none. Report which ones in the response so the effect is visible.

The one operation that destroys anything is `delete_bundle`, where destruction is the stated purpose
rather than a side effect. It is specified in section 9.

A site whose data does not conform is not blocked, degraded or at risk. Its resources report as
ungrouped, and its owner has the full tool surface available to rearrange them whenever they choose.

## 8. Read operations

- **`list_collections` and `list_assets` gain an `owner` field**: the full normalized page path that owns each
  entry, or null. Nearest page, per section 4. A client must be able to pass the value straight to `get_page`.
- **Absence is never a word in the value position.** `owner` is null in JSON. In tool text the marker `ungrouped`
  stands alone rather than following `owner `, so a site with a page published at `/ungrouped` stays unambiguous.
- **New operation, bundle listing**: given a path, return every page, collection and asset it contains,
  with item counts, revs, declared refs, sizes and public URLs. Includes resources owned by deeper pages, and
  those deeper pages themselves. This is the operation the change exists to make possible.
  - A page that owns nothing lists the page and says so. A path where nothing at all is published is an error.
    Those are different situations and a client has to tell them apart.
  - A path with resources but no page lists them and says no page is published there.
  - `/` lists the whole site, because a bundle is containment and `/` contains everything. It says in the reply
    that the root page owns nothing by rule, so nothing there reads as ownership.
- **New operation, ungrouped listing**: every collection and asset with no page above it, grouped by the path
  that would own it if a page were published there, because resources needing the same fix are one decision
  rather than several. Assets stored under a content hash are listed apart, since no page can ever own them.
  Read-only. This is what an owner uses to see what to move and to confirm they are done.
- **`/data/_collections.json` gains the same `owner` field.** The served index already lets a page
  discover collections over plain HTTP with no tool access, so grouping belongs there too.

Serving is unchanged. `/a/b` is still served at `/data/a/b.json` as a bare JSON array.

**Implementation note.** Ownership needs the set of page paths, not the pages. Page blob keys are
`encodeKey(path)` and `decodeKey` recovers the path, so one `list()` on the pages store yields every
page path. Do not call `listPages`, which issues one GET per page; `/data/_collections.json` is public
and cached and must not fan out.

## 9. Deleting a bundle

`delete_bundle` removes everything at and under a path: the page at that path, every page beneath it,
every collection beneath it, every asset beneath it. The path need not have a page.

- **Matching is on segment boundaries** per section 4.1. `delete_bundle('/bavaria')` does not touch
  `/bavaria-lessons/lessons`. Here that rule is load-bearing: got wrong, it destroys a bundle nobody
  named.
- **`/` and `/_collections` are refused.**
- **Called without `confirm: true`, it deletes nothing** and returns the full inventory of what it would
  delete, plus every record in another bundle that references an id it would remove.
- **Called with `confirm: true`, it deletes** and returns the same inventory as a record of what it did,
  including references it broke elsewhere. The caller who reached for a bundle delete is the one least
  likely to audit afterwards, and the information is already in hand.
- **Hash-keyed assets are never in a bundle** and are never touched by this operation.

## 10. Non-goals

- Validating, rejecting or warning on any write.
- Any form of migration, backfill or compatibility mode.
- Changing the `/data/<path>.json` serving scheme, the 60 second cache, or the bare-array response shape.
- Changing existing `/assets/<hash>.<ext>` URLs.
- Changing rev or `if_rev` optimistic concurrency semantics.
- Adding authentication to served data.
- Restricting which collections a page may read.
- Enforcing anything about resource names within a bundle. `/foo/items` and `/foo/whatever` are equally
  valid.

## 11. Acceptance criteria

- `/bavaria` does not contain `/bavaria-lessons/lessons`, in listing or in delete.
- A page at `/` owns no resources.
- With pages `/trip` and `/trip/day1` both present, `/trip/day1/items` is owned by `/trip/day1` **and**
  appears in the bundle listing for `/trip`, alongside the page `/trip/day1`.
- Bundle listing for `/germanfunstuff` returns its collections and assets, and nothing belonging to
  `/bavaria-lessons`.
- A collection declaring a ref to a collection in a different bundle is accepted.
- `delete_page` on `/trip` leaves every collection and asset under `/trip` intact and names them.
- `delete_bundle` without `confirm` deletes nothing and lists what it would remove.
- `delete_bundle('/')` is refused.
- An asset uploaded at `/germanfunstuff/images/coburg.jpg` is owned by `/germanfunstuff` and served at
  `/assets/germanfunstuff/images/coburg.jpg`.
- An asset uploaded before this release keeps its exact URL and reports as ungrouped.
- No tool reply or served endpoint puts the word `ungrouped` where a page path goes, with a page at `/ungrouped`
  published to prove it.
- `list_bundle` on a page that owns nothing succeeds; on a path where nothing is published it errors.
- The full segment-boundary matrix is covered by automated tests, not by inspection of a live site.
- An asset named `index.html` or `notes.md` keeps its filename.
- Against the current site: the release changes zero bytes of stored data, `GET /data/trip/items.json`
  still returns all 195 items, `put_item` to `/trip/items` still succeeds, and the ungrouped listing
  names all six existing collections.
