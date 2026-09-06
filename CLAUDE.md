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
- **Assets** — `/assets/*`, uploaded files served from blobs.
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
- **One path normalizer.** [path.ts](src/pages/path.ts) is the only place a page path is normalized.
- **Blob keys carry no slashes.** `encodeKey` in [store.ts](src/store.ts) maps `/a/b` to `a~b`; Netlify rejects keys starting with a slash.
- **Markdown is themed, HTML is verbatim.** Never wrap a stored HTML page.
- **Repeating content belongs in a collection.** A page that lists things fetches `/data/<path>.json`; it does not
  bake the list into its HTML. The MCP instructions in [handler.ts](src/mcp/handler.ts) tell clients to offer the
  owner that choice, and the page tools repeat it. Weaken that steering and Claude will paste data into pages again.
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
- **Revisions live outside the items.** `rev` and `revs` sit on the collection envelope, never in an item, because
  [handler.ts](src/data/handler.ts) serves `collection.items` verbatim. Updating an item needs a matching `if_rev`,
  so a client writing from a stale read is refused. [saveCollection](src/data/service.ts) assigns revs by comparing
  canonical JSON, so an unchanged item keeps its rev and a no-op write does not invalidate anyone.
- **The build stamp is baked in, not looked up.** Netlify exposes no deploy timestamp and no API call is allowed,
  so [build-info.mjs](scripts/build-info.mjs) writes [build-info.ts](src/build-info.ts) during `build:deploy`. The
  committed copy is blank on purpose; a local `npm run build` must never overwrite it.
- **Tests gate the deploy.** `npm run build` is `tsc --noEmit && vitest run`, and Netlify runs it, so a failing test
  fails the deploy. Blobs are mocked in [test/blobs.ts](src/test/blobs.ts); tests never need a network.
