# pages

Self-deployable MCP-driven site host on Netlify.

## Local development

```
npm install
netlify dev
```

`npm test` runs the suite, `npx tsc --noEmit` typechecks. Blobs run locally through `netlify dev`.

## Architecture

One function serves everything, routed in [app.ts](src/app.ts):

- **Public pages** — anything not claimed by another prefix.
- **Admin UI** — `/admin/*`, server-rendered HTML, no client framework.
- **Assets** — `/assets/*`, uploaded files served from blobs. Two key schemes: a rooted path
  (`/germanfunstuff/images/coburg.jpg`, encoded like any other path) and, for anything uploaded before bundles,
  a content hash. Hash URLs keep resolving forever and belong to no bundle.
- **Data** — `/data/<path>.json`, a collection served whole as JSON for a page to fetch and render.
  `/data/_collections.json` is the reserved index of every collection.
- **MCP** — `/mcp`, JSON-RPC over Streamable HTTP.
- **OAuth** — hand-rolled in [oauth/](src/oauth), authorization code with PKCE and dynamic client registration.

Storage is Netlify Blobs throughout: `site` (owner, settings, rate limits), `pages`, `assets`, `data`, `oauth`.

A collection is one blob holding an ordered array of items, each with an `id`. [service.ts](src/data/service.ts) owns
the item operations, [query.ts](src/data/query.ts) the search syntax.

Until setup completes, `/` renders [welcome.ts](src/welcome.ts) and every other public path redirects to it.

## Rules

- **No API tokens, ever.** The site never asks for, stores, or uses a provider API token in any form.
- **Custom domains are the user's job.** They add the domain in Netlify. The app does nothing and says nothing about it.
- **No local tooling for users.** Deploy is the button. Never add a step needing a CLI or a checkout.
- **One path normalizer, two kinds of path.** [path.ts](src/pages/path.ts) is the only place any path is
  normalized. `normalizePath` is for pages and collections; `normalizeAssetPath` is for assets and exists because
  the page rules would eat a filename: they strip `.html`/`.md` and pop a trailing `index`, so an asset at
  `/docs/index.html` would become `/docs` and `/notes.md` would become `/notes`. Never point an asset at
  `normalizePath`.
- **Every stored read goes through `hydrate`.** A blob written before a field existed still has to come back
  carrying it, and there is more than one way into storage: `listCollections` reads raw blobs, not `getCollection`.
  Adding a field to `Collection` means defaulting it in [hydrate](src/data/service.ts) and nowhere else. Skipping
  that shipped a `list_collections` that threw on every pre-existing collection while every test passed, because
  the tests only ever read blobs this code had just written.
- **Organization is a filesystem, and nothing more.** A path is a bundle holding everything at or under it;
  [bundle.ts](src/bundle.ts) is the whole rule, twelve lines, and it stores nothing. Pages, collections and assets
  are all just things at paths, with no ownership relation between them. Matching is on segment arrays, never
  string prefixes: `/bavaria` does not hold `/bavaria-lessons/lessons`, and that pair exists on the live site.
  The `startsWith` version passes most tests, so [bundles.test.ts](src/bundles.test.ts) pins the neighbour cases;
  in `delete_bundle` the same bug destroys a bundle nobody named. Resist reintroducing an owner or a "belongs to"
  field: the path already says it, and a second vocabulary for the same fact is what made this hard the first time.
- **Nothing may hold the whole site.** `/` is not a bundle: `list_bundle`, `delete_bundle` and every bundle
  transfer refuse it at either end. That is
  the whole of the rule. A page, collection or asset may still sit at `/` like any other resource — it is simply
  not reachable through a bundle, and a collection there keeps its `/data/index.json` address. What a browser gets
  at `/` is the page in the `ROOT_BUNDLE` folder ([path.ts](src/pages/path.ts)), with `/root` itself 301ing to `/`
  so that page has one URL. Nothing is migrated.
- **Bundles are organization, never a boundary.** Nothing is rejected, moved or blocked by them.
  `set_collection_refs` may cross bundles and a page may fetch any collection.
- **Copy, move and delete are one service at four levels.** [transfer.ts](src/transfer.ts) is the whole of it:
  `planTransfer` gathers, validates and prices the operation, `applyTransfer` writes with an undo per write. A
  delete is a transfer with no target, which is why all twelve tools take the same arguments and return the same
  envelope. Adding a level or a verb means teaching that one engine, never a parallel path. Reorganizing must
  never be reduced to reading records out through a client and writing them back: that loses a value to a
  mistyped character, and does it silently.
- **A transfer reads everything before it writes anything.** Sources are loaded and targets staged up front, each
  write carries its own undo, and a failure unwinds in reverse, so a half-populated target is never observable.
  Ids, array order, nested values and item revs survive exactly; a copy starts at fresh revs and a move carries
  them, and replacing a target bumps the rev past what it held so no rev a client holds is reused for different
  content.
- **A transfer never edits a page.** Pages hardcode their URLs and there is no reliable way to tell which strings
  in arbitrary HTML are one, so every move and delete reports the page lines still naming what it took away and
  touches none of them. The scan matches a collection's `/data` URL and its parent prefix, which is what finds a
  `const BASE = "/data/trip/"`, and a page path on segment boundaries so a link to `/trip` is not reported for
  `/tripwire`. A URL a page assembles from pieces cannot be found at all, which is why the reply reports lines to
  read rather than promising a clean result.
- **References follow the operation, not the collection.** A ref pointing at a collection moving in the same call
  is rewritten to its new path; one pointing outside it is left alone and then reported in `breaks`, because a
  move takes the source path away just as surely as a delete does. Cross-bundle references are legitimate, so the
  answer is to report the damage, never to refuse the move or to rewrite something the caller did not name.
- **The site icon is a path, not a setting.** An asset named `favicon.ico`, `.svg`, `.png`, `.webp` or `.jpg` in
  the `ROOT_BUNDLE` folder is the site icon, first name in that order wins, and [favicon.ts](src/favicon.ts) serves
  it at `/favicon.ico` with its own content type. Until one is uploaded the built-in default in
  [favicon-default.ts](src/favicon-default.ts) is served, so a brand new site has an icon before setup. The
  well-known URL is what carries it: a stored HTML page is verbatim and can be given no `link` tag, so the themed
  layout and the admin chrome link `/favicon.ico` and everything else falls back to it. Never add a settings field
  for this, and never wrap a page to inject an icon.
- **Blob keys carry no slashes.** `encodeKey` in [store.ts](src/store.ts) maps `/a/b` to `a~b`; Netlify rejects keys starting with a slash.
- **Markdown is themed, HTML is verbatim.** Never wrap a stored HTML page.
- **A summary is a cache, and the blob is the truth.** `writeCollectionBlob` in
  [service.ts](src/data/service.ts) and `writePageBlob` in [service.ts](src/pages/service.ts) are the only places a
  collection or page blob is written, transfer.ts included, and each writes its summary as blob metadata in the
  same call, so `list_collections` need not read every item of every collection and `list_pages` need not read
  every page body. The metadata carries a `SUMMARY_VERSION`; anything else is not trusted and not patched up, the
  blob is read and the summary derived. That is the whole safety property: every miss ends at the blob, so a
  summary can be absent or old-shaped but never wrong. Netlify caps metadata at 2 KB and rejects the write past it,
  so a summary too big to fit is skipped rather than failing a save: a title is whatever an `h1` says and `refs` is
  caller supplied, and losing a page to write a summary of it would be the wrong trade. Adding a field to a summary
  means bumping that number, and [store.test.ts](src/store.test.ts) pins that nothing else writes those blobs.
- **Caching is one module and one purge.** [cache.ts](src/cache.ts) owns every public cache header and the
  clearing of them; a handler that writes a `cache-control` string by hand has started a second policy. A public
  response is `no-cache` to browsers and durable at the edge, so a refresh always asks and always gets what a write
  just made, while an asset URL that is a content hash is immutable instead because its bytes cannot change. The
  purge fires once at the request boundary in [app.ts](src/app.ts), blind to what changed: writes reach storage two
  ways, through `savePage`/`saveCollection` and through the transfer engine writing blobs itself to keep ids and
  revs exact, and a rule that each write path must announce itself is one a write path will forget. The bounded
  `s-maxage` is the backstop, so the worst case of a purge that never lands is five minutes, not forever.
- **The themed layout reads settings and nothing else.** There is no site nav. A page that wants links to
  other pages writes them, and a client that wants a nav builds one into its pages; the layout is the site title,
  the description and the content. Drawing eight nav links cost a full read of every page blob, body included, on
  every request, and it decided for the owner what their site looked like.
- **Repeating content belongs in a collection.** A page that lists things fetches `/data/<path>.json`; it does not
  bake the list into its HTML. The MCP instructions in [handler.ts](src/mcp/handler.ts) tell clients to offer the
  owner that choice, and the page tools repeat it. Weaken that steering and Claude will paste data into pages again.
- **Reads are shaped to fit a context window.** `list_items` projects and pages, `count_items` answers questions
  about shape without returning records at all, and their descriptions name each other so a client picks the cheap
  one. A tool that returns a few hundred records of prose to answer a question about counts is a bug. That applies
  to the reply as much as the request: `reorder_items` names the ids that moved and counts the rest rather than
  echoing the collection, and every JSON reply is written compact, because indenting one page of `list_items`
  measured 30% more characters for nothing a reader of it needs.
- **Items change one at a time.** Every data tool reads or writes a single item, so editing one costs one small call.
  Never add a tool that makes a client send a whole collection back to change one field.
- **The served contract is public API.** Collection `/a/b` is served at `/data/a/b.json` as a bare array, each item
  carrying its `id`, in collection order, with nested values untouched. Pages are written against that with no MCP
  access, so it cannot drift: the tool text, the MCP instructions and the tests all state it. Changing any of it means
  changing every page anyone has published.
- **Name matching stays language-agnostic.** [match.ts](src/data/match.ts) normalizes and compares scripts without
  knowing any of them: no stopword lists, no article stripping, no per-language maps, and domain words like "brewery"
  are never treated as noise. The one lookup table, [expansions.ts](src/data/expansions.ts), is for characters that
  casefold to themselves, and it is data only. Tuning is biased against false positives: a missed match leaves a
  visible duplicate, a wrong one silently suppresses a record nobody knows is missing. The scores in
  [match.test.ts](src/data/match.test.ts) and the regression block in [tools.test.ts](src/mcp/tools.test.ts) are
  pinned to exact values on purpose; touching the scorer is expected to break them, and each break needs a decision
  rather than a re-baseline.
- **A reference constraint is the only defence against a silent typo.** `refs` on the collection envelope maps a
  field to the collection its ids come from, and [validateRefs](src/data/service.ts) runs inside `putItem` before
  anything is written. The failure it prevents breaks nothing visible: the write succeeds, the JSON validates, the
  page renders, and the record silently drops out of whatever selects on that field. Never make the check advisory,
  and never let `saveCollection` reorder around it: declaring a constraint on a collection that already violates it
  has to succeed, or no existing collection can adopt one.
- **An audit that checked nothing must not look like one that passed.** `check_refs` on a collection with no
  declared references returns `checked: 0` and a warning, never `checked: <total>` with an empty `broken`. Every
  response carries `refs_declared` so a clean result states its own scope. This is not cosmetic: a success-shaped
  answer gets skimmed, believed, and acted on, and the caller stops looking. Any check added later owes the same
  distinction between verified-and-clean and not-verified, in the response *and* in the tool description: a
  description promising that an empty result means clean teaches the misreading before the response can correct it.
  The same applies to damage a tool does on purpose: a forced delete reports the records it orphaned, because the
  caller who reached for `force` is the one least likely to audit afterwards, and the information is already in hand.
- **Revisions live outside the items.** `rev` and `revs` sit on the collection envelope, never in an item, because
  [handler.ts](src/data/handler.ts) serves `collection.items` verbatim. Updating an item needs a matching `if_rev`,
  so a client writing from a stale read is refused. [saveCollection](src/data/service.ts) assigns revs by comparing
  canonical JSON, so an unchanged item keeps its rev and a no-op write does not invalidate anyone.
- **The build stamp is baked in, not looked up.** Netlify exposes no deploy timestamp and no API call is allowed,
  so [build-info.mjs](scripts/build-info.mjs) writes [build-info.ts](src/build-info.ts) during `build:deploy`. The
  committed copy is blank on purpose; a local `npm run build` must never overwrite it.
- **Tests gate the deploy.** `npm run build` is `tsc --noEmit && vitest run`, and Netlify runs it, so a failing test
  fails the deploy. Blobs are mocked in [test/blobs.ts](src/test/blobs.ts); tests never need a network.
