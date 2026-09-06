# Requirements: copy, move and delete at every level

Status: implemented. Written 2026-09-06, superseding the earlier server-side move and copy draft, which
predated [bundles](bundles.md).

## 1. Goal

Reorganizing a site must never mean reading records out through a client and writing them back. That round
trip is slow, and it is lossy in a way a server-side operation is not: ids, array order, revs and declared
refs survive only if the client reproduces them exactly, and every string is a chance to mistype an umlaut
or drop a nested field.

Moving the six collections on the live site by hand costs roughly 500 tool calls and passes every stored
byte through a language model twice.

## 2. One service, three verbs, four levels

Twelve tools, one engine, one reply shape.

| | page | collection | asset | bundle |
|---|---|---|---|---|
| copy | `copy_page` | `copy_collection` | `copy_asset` | `copy_bundle` |
| move | `move_page` | `move_collection` | `move_asset` | `move_bundle` |
| delete | `delete_page` | `delete_collection` | `delete_asset` | `delete_bundle` |

- **A delete is a transfer with no target.** That is why all twelve share arguments and reply.
- **Copy and move take `from` and `to`. Delete takes `path`.**
- **`overwrite` on copy and move**, default false. **`confirm` on the bundle verbs.** **`if_rev` on the
  collection verbs.**
- **The level says what travels.** `move_collection` leaves the page that renders it behind;
  `move_page` leaves its data behind; `move_bundle` takes the page, its collections and its assets together.

Item-level operations stay out of scope: `put_item` and `delete_item` already change one item at a time.

## 3. What is preserved

- **Item ids and array order, exactly.** Order is the collection order and pages rely on it.
- **Every field value byte for byte**, including nested objects and arrays of objects.
- **Item revs on a move.** A copy is a new collection and starts at fresh revs; both are stated in the reply.
- **Bytes on an asset copy or move**, with the filename and content type intact.
- **Page bodies verbatim.** A copied page keeps the URLs written into it, so it still fetches the original's
  data until someone edits it. See section 6.

Replacing an occupied target always bumps the rev past what that target held, so no rev a client is holding
is ever reused for different content.

## 4. Declared references

- **Carried to the target.** A copy or move never silently drops a declaration.
- **Rewritten inside the operation.** A ref pointing at a collection moving in the same call follows it, so
  `move_bundle('/trip', '/gf')` leaves `/gf/items` declaring `group` against `/gf/filters`.
- **Left alone outside it.** Cross-bundle references are legitimate, so they are never rewritten.
- **Reported when broken.** A move takes the source path away just as a delete does, so refs from outside
  the operation are listed in `breaks` rather than being refused or silently repointed.

## 5. Collisions, validation, atomicity

- **Refuses an occupied target**, naming what is there, unless `overwrite: true`.
- **Refuses a no-op** where `from` and `to` normalize to the same path.
- **Refuses a bundle target nested in its own source**, which would consume itself. A single-resource move
  to a nested path is fine and allowed, because nothing recurses.
- **Refuses `/` at either end of a bundle verb.** `/` is not a bundle; see [bundles](bundles.md) for why.
  Refuses `/_collections` as a bundle path and as a collection path.
- **Normalizes both paths by kind.** Assets use `normalizeAssetPath` so a filename survives; pages and
  collections use `normalizePath`, and a trailing `.json` on a collection is ignored.
- **Atomic.** Every source is read and every target staged before a byte is written; each write carries its
  own undo and a failure unwinds in reverse. A partially populated target is never observable.
- **A bundle verb always asks twice.** Without `confirm: true` it changes nothing and returns the inventory
  it would write or remove.

## 6. Page content is never rewritten

Pages hardcode the URLs they fetch. There is no reliable way to tell which strings in arbitrary HTML are a
URL, so no operation edits a page.

Instead every move and delete reports `pages_to_update`: each page path with the matching lines and line
numbers. The scan matches a collection's `/data` URL and its parent prefix, which is what finds a
`const BASE = "/data/trip/"`, an asset's `/assets` URL the same way, and a page path on segment boundaries
so a link to `/trip` is not reported for `/tripwire`.

A URL a page assembles from pieces cannot be found at all. That is why the reply reports lines to read
rather than promising a clean result, and why a client that cannot break a page even briefly should copy,
repoint the page, confirm it renders, then delete the source.

## 7. The reply

Every tool returns the same envelope: `operation`, `scope`, `from`, `to`, `applied`, `resources`, `breaks`,
`pages_to_update`, `notes`, and `rest_of_bundle` on a page verb. Each resource carries its kind, both paths,
the target URL and whether it replaced something, plus item count, rev and refs for a collection and size for
an asset. Moving or deleting the `/root` page says so in `notes`, because that is the page a browser gets at
the site root.

That is enough to verify the result without a follow-up call.

## 8. Non-goals

- Item-level copy or move between collections, and merging two collections into one.
- Transforming, renaming or reshaping fields during a copy.
- Rewriting page content, under any flag.
- Any automatic or scheduled reorganization. These run only when a client calls them.
- Changing the `/data/<path>.json` serving scheme or existing `/assets/<hash>.<ext>` URLs.

## 9. Acceptance criteria

- A copy leaves the source with the same items and produces a target with the same ids in the same order.
- A round trip out and back is byte-identical, nested objects and arrays of objects included.
- `move_bundle('/trip', '/gf')` yields `/gf/items` declaring `group` against `/gf/filters`; moving
  `/trip/items` alone leaves it declaring `group` against `/trip/filters`.
- Copying onto an occupied path fails and changes nothing; with `overwrite` it succeeds.
- A copy interrupted by an induced failure leaves nothing at the target, and a failed delete puts every
  source back.
- After `move_collection('/trip/items', '/gf/items')`, `/data/trip/items.json` 404s and
  `/data/gf/items.json` serves every item as a bare array.
- That reply names the page holding `/data/trip/` and gives the line with `const BASE`.
- A move where source and target normalize to the same path is refused.
- `move_bundle('/trip', ...)` does not touch `/tripwire/items`, and `/` is refused at either end.
- A hash-keyed asset cannot be moved to a path, and can still be deleted by its key.
- `delete_page` leaves every collection and asset under its path intact and names them in `rest_of_bundle`.
- No operation modifies any page's stored content.
