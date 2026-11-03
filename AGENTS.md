# pages

<!-- @celsoft/platform:start -->
## @celsoft/platform

This app is built on @celsoft/platform. Before changing it, read the skills the installed version
ships, starting with `node_modules/@celsoft/platform/skills/celsoft-platform/SKILL.md`; every
skill is a `SKILL.md` under `node_modules/@celsoft/platform/skills/`, also copied to
`.claude/skills/`. To set the app up or deploy it for the first time, follow
`celsoft-platform-setup`. They match the installed version, so read them again after an
upgrade. This block is rewritten on install; edit outside it.
<!-- @celsoft/platform:end -->

A website its owner builds by talking to Claude, running on @celsoft/platform. The platform owns
sign-in, API tokens, the MCP server, access checks, caching, storage, the database and deploys;
this repo is the app on top: pages, collections, assets, templates and the tools that write them.

## Local development

```
mise run install      # npm dependencies, skipped when current
mise run typecheck
mise run test         # the suite once, in parallel; args pass through, e.g. -- src/transfer.test.ts
mise run build        # typecheck and tests: what every deploy runs before it ships
mise run platform -- <command>   # any @celsoft/platform command, e.g. upgrade, previews
```

Tasks are executable zsh files under [mise-tasks/](mise-tasks), never an inline `[tasks]` table;
[_lib.sh](mise-tasks/_lib.sh) is sourced, not run, so it carries no `+x`. The npm scripts still
work and the tasks call them, so there is one definition of each command.

Tests run the platform's real runtime through `testApp` from `@celsoft/platform/testing`, on a
local Postgres from the `embedded-postgres` dev dependency, with files in memory. Never build a
fake `app`.

## Deploys

[platform.yml](.github/workflows/platform.yml) runs `platform ci`, which deploys production on a
push to `main` and a preview at `pr-<n>.<hostname>` for each pull request. `platform generate` runs
the `generate` script in [package.json](package.json) first, on install, dev and every deploy, and
that script writes the app's generated files, the docs module today. Each deploy then runs the
`build` script, which typechecks and runs the suite, so a failing test deploys nothing. The hostname
and the platform features the app uses are in [platform.jsonc](platform.jsonc).

## Architecture

[worker.ts](src/worker.ts) is the whole app: `defineApp` with the endpoints, the served pages, the
schema, `invalidates: "all"` and the `site` access point.

- **Endpoints** live in [src/endpoints/](src/endpoints), one file per subsystem: pages, data,
  assets, site and transfer. Each is served at `/api/v1/<name>` and as an MCP tool at `/mcp`.
- **Served pages** are in [serve.ts](src/serve.ts):
  - `/`: the page at `/root`, or the generated contents of the site until one is published.
  - `/p/<path>`: a page. `/p/root` 301s to `/`.
  - `/data/<path>.json`: a collection as a bare array. `/data/_collections.json` is the index of
    every collection.
  - `/assets/<path>`: an uploaded file.
  - `/preview/<path>`: a page's working copy.
  - `/favicon.ico`: the site icon.
- **Static files** come from [public/](public), such as `robots.txt`, served before the Worker.
- **Storage:** every page, collection and asset is a file in `app.files`
  ([store.ts](src/store.ts) names them: `pages/<path>.json`, `data/<path>.json`,
  `assets/<key>`), and the file is the truth. Postgres ([schema.ts](src/schema.ts)) holds a summary
  row per page, collection and asset for listings, and `site_values` for the settings and the
  owner's instructions.
- **Accounts:** the platform's sign-in at `/login` and `/signup`. Sign-up is by invite, and the
  first account is the owner. Personal API tokens are made at `/tokens`, each capped at a level.

## Rules

- **One path normalizer, two kinds of path.** [path.ts](src/pages/path.ts) is the only place any path is
  normalized. `normalizePath` is for pages and collections; `normalizeAssetPath` is for assets and exists because
  the page rules would eat a filename: they strip `.html`/`.md` and pop a trailing `index`, so an asset at
  `/docs/index.html` would become `/docs` and `/notes.md` would become `/notes`. Never point an asset at
  `normalizePath`.
- **Every stored read goes through `hydrate`.** A file written before a field existed still has to come back
  carrying it. Adding a field to `Collection` means defaulting it in `hydrate` ([service.ts](src/data/service.ts))
  and nowhere else; pages have the same rule in `hydratePage` ([service.ts](src/pages/service.ts)), which is
  where `meta` is defaulted for a page stored before it existed.
- **The file is the truth, and a summary row is a cache of it.** `writeCollectionFile` in
  [service.ts](src/data/service.ts), `writePageFile` in [service.ts](src/pages/service.ts) and the asset service
  ([service.ts](src/assets/service.ts)) are the only places those files are written, transfer.ts included, and
  each writes the summary row after the file in the same function, so `list_pages` and `list_collections` answer
  from one query without opening every file. [store.test.ts](src/store.test.ts) fails on a second writer,
  because one reads as ordinary code and fails silently, in the listing only.
- **A page has a live copy and at most one working copy.** `draft` on `Page` holds the body, title, format and
  meta being written; readers, listings, templates and the transfer scan see only the live fields, so revising a
  published page never takes it off the site. `/preview/<path>` renders the working copy, chrome and templates
  included, as a route of its own gated at `write` on the page's path ([serve.ts](src/serve.ts)) and never cached.
  It is a route and not `?preview` because a platform page handler is blind: it cannot tell the owner from a
  stranger, and the cache keys on the query string, so a query cannot choose who sees what. Anybody who may not
  write the page gets the platform's one 404 page, the same as for a path with nothing there, so a draft's
  existence never shows. With no build, the preview is the only gate a template meets before a reader, which is
  why `publish_draft` says to look at it first. A direct write to the live page leaves a working copy alone,
  since it is somebody's unpublished work.
- **Page meta is strings, beside the body.** `meta` is facts about a page that are not its content, returned in
  the summary so a listing reads no bodies. Values are strings only; `path` and `title` are refused as keys
  because the page already has them, and a key is an identifier because it is also a CSS class and a template
  name. `update_page` merges meta and a `null` removes a key, so changing one fact never sends the body.
- **Organization is a filesystem, and nothing more.** A path is a bundle holding everything at or under it;
  [bundle.ts](src/bundle.ts) is the whole rule and stores nothing. Pages, collections and assets are all just
  things at paths, with no ownership relation between them. Matching is on segment arrays, never string
  prefixes: `/photos` does not hold `/photos-archive/lessons`, and [bundle.test.ts](src/bundle.test.ts) pins the
  neighbour cases, because the `startsWith` version passes most tests and in `delete_bundle` destroys a bundle
  nobody named. Never reintroduce an owner or a "belongs to" field, and never let a tool description say a page
  owns what sits under it: the tool text is where a client learns the model. `BUNDLES` in
  [shared.ts](src/endpoints/shared.ts) is the one statement of it that every bundle-aware tool carries.
- **Nothing may hold the whole site.** `/` is not a bundle: `list_bundle`, `delete_bundle` and every bundle
  transfer refuse it at either end. A page, collection or asset may still sit at `/`; it is simply not reachable
  through a bundle, and a collection there keeps its `/data/index.json` address.
- **The home page is the page at `/root`, and the contents is its default.** `/` serves the page stored at
  `ROOT_BUNDLE` when there is one, and otherwise the generated list of every public page,
  [contents.ts](src/pages/contents.ts), so a new site needs nothing written. `/` itself is never a page path,
  since it would be a second name for the home page, so publishing there is refused and names `/root`. `/root`
  is where the favicon sits, and it 301s to `/` so the home page has one URL. A read of `/root` with nothing
  stored says `/` is serving the contents and how to replace it, because a client told only that nothing is
  there cannot tell a default from a lost page.
- **Bundles are organization, never a boundary.** Nothing is rejected, moved or blocked by them.
  `set_collection_refs` may cross bundles and a page may fetch any collection.
- **Copy, move and delete are one service at four levels.** [transfer.ts](src/transfer.ts) is the whole of it:
  `planTransfer` gathers, validates and prices the operation, `applyTransfer` writes with an undo per write, and
  `runTransfer` is the one entry. A delete is a transfer with no target, which is why all twelve tools take the
  same arguments and return the same envelope. Adding a level or a verb means teaching that one engine, never a
  parallel path. Reorganizing must never be reduced to reading records out through a client and writing them
  back: that loses a value to a mistyped character, silently. A move reports what moved, what still names the
  path that has gone (`restOfBundle` is in transfer.ts for that) and what now points at nothing.
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
- **Links are checked on demand, and the report states its scope.** `check_links`
  ([links.ts](src/pages/links.ts)) resolves every link a live page wrote out whole (markdown links, `href`,
  `src`, quoted `/data` and `/assets` literals). The platform's `app.routes.serves` answers for every route,
  screen and file it knows; the `/p`, `/preview`, `/data` and `/assets` claims match any path below them, so for
  those the checker asks whether a page, collection or asset is stored there. Never keep a list of the
  platform's routes in the app. It counts what it checked and says so when that was nothing, because a URL a
  template or script assembles cannot be seen and an empty list must not read as a clean site.
- **The site icon is a path, not a setting.** An asset named `favicon.ico`, `.svg`, `.png`, `.webp` or `.jpg` in
  the `/root` folder is the site icon, first name in that order wins, and [favicon.ts](src/favicon.ts) serves it
  at `/favicon.ico` with its own content type, through a page claiming that path in [serve.ts](src/serve.ts),
  gated and cached like the home page. Until one is uploaded the built-in default in
  [favicon-default.ts](src/favicon-default.ts) is served. The well-known URL is what carries it: a stored HTML page
  is verbatim and can be given no `link` tag. Never add a settings field for this, and never wrap a page to inject
  an icon.
- **A path is gated by the nearest private path at or above it.** The site has one control point, `site`, where
  the owner manages and everyone reads. A private path is the only path with a point of its own, `path:<path>`,
  and `pointsFor` in [pages-app.ts](src/pages-app.ts) names a path's point, the point of every folder above it
  and then the site; the platform checks the first that exists, so `/trip/day1`, `/data/trip/stops.json` and
  `/assets/trip/map.jpg` are all gated by `path:/trip` once `/trip` is private, and by the site until then. Every
  served route and every tool that names a path is gated that way, a transfer on both its source and its target,
  so a tool refuses exactly what a reader would be refused. Never give a public path a point: a point per stored
  path and folder would have to be created, moved and removed by every write and transfer.
- **A private path is a point, and the points are the record.** [privacy.ts](src/privacy.ts) closes a path by
  creating `path:<path>` with the site as parent, no inheritance and a `manage` grant to `{ owner: true }`, and
  reopens it by removing the point, which ends its links with it. Pages keeps no table of private paths:
  `app.access.points({ prefix: "path:" })` is the list, so it cannot drift from what the gate enforces. Privacy
  does not nest either way, because nested scopes would leave a visitor needing two links for one page or one
  link silently opening a narrower scope someone closed on purpose: an ancestor is found in the path's point
  chain and a descendant with `points({ prefix: "path:<path>/" })`. `/` is refused; `/root` closes the home page.
  To a stranger a closed path answers with the platform's one 404 page, the same as a missing one, so a private
  path never shows that it exists. The tools need `manage`, so they are the owner's.
- **A share link is the platform's, labelled per recipient.** `share_path` mints a `read` link on the path's
  point with `app.access.link`, labelled with who it is for and unique per path, so `revoke_share` can end one
  recipient's access without touching anyone else's. The address is `/p<path>#link=<token>`: the secret rides in
  the fragment, which browsers never send, so it reaches no access log, no proxy and no `Referer`, and the
  platform's 404 page swaps it for a cookie. The token is shown once, since only its hash is stored, and when a
  link was last used is not kept. A listing served to every visitor, the contents at `/`,
  `/data/_collections.json`, and a template's `site.pages` and `collections`, shows only what a stranger may
  read: `publicOnly` in [privacy.ts](src/privacy.ts) passes each path's point chain to
  `app.access.asEveryone().filter`, which checks the first existing point of each, in one query. It is one copy
  for every visitor, so it varies by nobody's cookie; a link holder reaches their page by the link, and a page
  inside a private path sees no more through its templates than a public one does. A transfer that carries a resource across the edge of a private path reports
  it in `privacy_changes`, because the dangerous direction, private to public, is otherwise silent.
- **Bytes leave by HTTP, never through a tool.** A tool result is text in the calling agent's context, so an
  asset's bytes never come back that way: `/assets/<path>` is the only way to read one, and `list_assets` hands
  out the URLs. `upload_asset` is the one tool taking bytes in, through the platform's `upload()` input field:
  multipart form data over the API, base64 from an MCP client, and the size checked by the platform before the
  handler runs, so both doors arrive as the same `File`. Never add a tool that returns bytes, and never build an
  upload route by hand or take base64 in a JSON field.
- **Every URL the site hands out comes from `APP_URL`.** `urlFor` and `dataUrl` in
  [shared.ts](src/endpoints/shared.ts) build them from `app.env.APP_URL`, the address of whichever deploy is
  running, preview or production, since an endpoint never sees the request. Never build one from a request URL.
- **Markdown is themed, HTML is verbatim.** Never wrap a stored HTML page.
- **Caching is one setting and one purge.** Every served route is kept at the edge for `CACHE` in
  [serve.ts](src/serve.ts), and `invalidates: "all"` in [worker.ts](src/worker.ts) empties every kept page once
  any write endpoint succeeds, over the API and MCP alike. It is blind to what changed because a template reads
  across the site, so no write can name every page it touched, and a rule that each write must announce itself is
  one a write will forget. A GET endpoint empties nothing. The preview route is never kept. Never call
  `app.cache` from an endpoint, and never write a `cache-control` header by hand: the platform owns both.
- **Templates are Liquid, and they run on the server.** [template.ts](src/render/template.ts) is the whole engine:
  a ```` ```pages ```` fence in a markdown page, and the header and footer templates, render through `liquidjs`
  with `page`, `site.pages` and `collections[...]` in scope, each read lazily and once per render. Liquid was
  chosen over Handlebars because a template has to query the site and iterate, which Liquid's filters and tags do
  and Handlebars could only reach through helpers we would own. Output is escaped by default, because a `<` in a
  collection field would otherwise be markup. A fence renders into a comment marked leaves alone and is put back
  after, because marked would otherwise read rendered HTML as code or paragraphs. A failing template renders its
  error in place and costs its own block. HTML pages never run templates: verbatim is verbatim.
- **Code is highlighted on the server, and colours are variables.** [highlight.ts](src/render/highlight.ts) is
  Shiki's sync core with the JavaScript regex engine, wired as marked's `code` renderer, over a fixed list of
  common grammars. Server-side because the alternative is a flash of plain code and JavaScript as a requirement
  for reading. The `css-variables` theme means no palette enters the app: `TOKEN_STYLES` sets the variables for
  the built-in theme, and a `theme: none` site sets its own. A language outside the list returns `false` so
  marked renders it as before, which keeps a mermaid or sandbox fence that a page's own script mounts
  byte-identical; a highlighted block keeps its `language-` class for the same reason.
- **The themed layout reads settings and nothing else.** There is no site nav. A page that wants links to other
  pages writes them, and an owner who wants a nav puts one in the chrome; the layout is the site title, the
  description, the chrome and the content. Chrome is `head`, the owner's HTML placed verbatim, `header` and
  `footer`, which are paths of stored templates, and `theme: none` to drop the built-in styles and wrapper. A
  template is an ordinary page, so there is one template mechanism and chrome is only which template wraps every
  page; a name is refused unless a page is stored there, and one whose page has gone renders the built-in piece
  rather than breaking the site. [chrome.ts](src/render/chrome.ts) reads and renders it. It never reaches an HTML
  page.
- **Repeating content belongs in a collection.** A page that lists things fetches `/data/<path>.json`; it does not
  bake the list into its HTML. The page tools' descriptions tell clients to offer the owner that choice. Weaken
  that steering and Claude will paste data into pages again.
- **A page is edited in place, not shipped twice.** `get_page` returns the whole source only when asked for
  nothing in particular; `find`, or `offset` and `limit`, return numbered lines, and `edit_page` replaces an exact
  snippet. `edit_page` refuses a snippet matching nothing and refuses an ambiguous one with the count, because a
  silent partial edit of verbatim HTML is a broken page nobody looked at.
- **Reads are shaped to fit a context window.** `list_items` projects and pages, `count_items` answers questions
  about shape without returning records at all, and their descriptions name each other so a client picks the cheap
  one. A tool that returns a few hundred records of prose to answer a question about counts is a bug. That applies
  to the reply too: `reorder_items` names the ids that moved and counts the rest rather than echoing the
  collection.
- **Items change one at a time.** Every data tool reads or writes a single item, so editing one costs one small call.
  Never add a tool that makes a client send a whole collection back to change one field.
- **An endpoint is defined once, and its schemas are the reference.** Every operation is one `endpoint()` in
  [src/endpoints/](src/endpoints), served at both doors, so a tool cannot exist on one and not the other. Its
  `description`, its `access`, and a `.describe()` on every field of its `input` and `output` are required in
  practice: they are what a client reads, and the output shape is published API, since the REST body is the
  result itself. Changing a result field breaks every service calling it. Never add a route that does not come
  from an endpoint.
- **The owner's instructions are the site's memory.** How one owner wants their site written lives in
  `site_values` ([instructions.ts](src/instructions.ts)) and reaches a client through `get_instructions`. A client
  writes them with `set_instructions`, carrying a rev, so a stale write is refused with a 409 rather than
  erasing a rule somebody added a minute ago. They shape content, never the platform. The 16,000 character
  ceiling is there because every session reads all of it.
- **One short text points every client at them.** `MCP_INSTRUCTIONS` in
  [mcp-instructions.ts](src/mcp-instructions.ts) is what a client is told on connecting, through
  `defineApp`'s `mcp.instructions`. It is the same on every site, so the owner's own rules never go in it. A
  connector may cut long instructions short, so the pointer to `get_instructions` comes first and the rest
  says only what no single tool's description can: that this is not a static site, that repeating content
  belongs in a collection, and how paths and privacy work. [mcp-instructions.test.ts](src/mcp-instructions.test.ts)
  pins the pointer near the top and fails on a tool name that no longer exists.
- **Content is stored, never built.** A write is live on the next request: no build runs, no deploy happens, and
  nothing about publishing touches git or this repo. A client that assumes a static site generator reaches for a
  commit and a push to publish, which would put somebody's page into the site's source code, so the tool text and
  the README say otherwise.
- **The served contract is public API.** Collection `/a/b` is served at `/data/a/b.json` as a bare array, each item
  carrying its `id`, in collection order, with nested values untouched. Pages are written against that with no API
  access, so it cannot drift. Changing any of it means changing every page anyone has published.
- **Name matching stays language-agnostic.** [match.ts](src/data/match.ts) normalizes and compares scripts without
  knowing any of them: no stopword lists, no article stripping, no per-language maps, and domain words like
  "brewery" are never treated as noise. The one lookup table, [expansions.ts](src/data/expansions.ts), is for
  characters that casefold to themselves, and it is data only. Tuning is biased against false positives: a missed
  match leaves a visible duplicate, a wrong one silently suppresses a record nobody knows is missing. The scores in
  [match.test.ts](src/data/match.test.ts) are pinned to exact values on purpose; touching the scorer is expected to
  break them, and each break needs a decision rather than a re-baseline.
- **A reference constraint is the only defence against a silent typo.** `refs` on the collection maps a field to
  the collection its ids come from, and `validateRefs` ([service.ts](src/data/service.ts)) runs inside `put_item`
  before anything is written. The failure it prevents breaks nothing visible: the write succeeds, the page
  renders, and the record silently drops out of whatever selects on that field. Never make the check advisory.
  Declaring a constraint on a collection that already violates it has to succeed, or no existing collection can
  adopt one.
- **An audit that checked nothing must not look like one that passed.** `check_refs` on a collection with no
  declared references returns `checked: 0` and a warning, never `checked: <total>` with an empty `broken`, and
  every response carries `refs_declared` so a clean result states its own scope. Any check added later owes the
  same distinction between verified-and-clean and not-verified, in the response and in the tool description. A
  forced delete reports the records it orphaned, because the caller who reached for `force` is the one least
  likely to audit afterwards.
- **Revisions live outside the items.** `rev` and `revs` sit on the collection, never in an item, because
  `/data` serves `items` verbatim. Updating an item needs a matching `if_rev`, so a client writing from a stale
  read is refused with a 409. `saveCollection` ([service.ts](src/data/service.ts)) assigns revs by comparing
  canonical JSON, so an unchanged item keeps its rev and a no-op write does not invalidate anyone.
- **Geo runs at authoring time and stores its answer.** [geo/](src/geo) holds the site's only outbound calls:
  geocoding a name into candidates, and routing that writes a GeoJSON line to an asset. Both run while a page is
  being written and never when one is read; the site may do authoring-time work whose output it stores, and may
  never fetch at request time. Result shapes are the intersection of what every provider can produce: no vendor
  id, no vendor score scale, SI units, and `null` rather than zero where a provider reports nothing. Geocoding
  returns candidates, never one answer. A route is written to an asset and the reply is a summary. A bike route's
  `prefer` is refused for walking or driving, never ignored, and its `ways` breakdown never becomes a single
  safety number. Cycling and walking never go to the public OSRM server, which is car-only whatever profile it is
  asked for.
- **The openrouteservice key is optional, and read from `app.env`.** [endpoints/geo.ts](src/endpoints/geo.ts)
  serves `geocode` and `route`; `orsKey` in [service.ts](src/geo/service.ts) passes `ORS_API_KEY` to the
  providers when the deploy has one, and without it the public services answer, which is the richer path for
  cycling. Never read it from `process.env`. Tests give it with `testApp(app, { env: { ORS_API_KEY: "test" } })`
  and stub `fetch` with [http.ts](src/test/http.ts), so the suite never reaches the network.
- **The build stamp is read, never written.** `{{ build }}` comes from [build.ts](src/build.ts), which reads
  the `DEPLOY_TARGET`, `DEPLOY_AT`, `DEPLOY_COMMIT` and `DEPLOY_BRANCH` the platform gives the Worker, so it
  always describes the deploy actually serving the page. Never stamp a file at build time for it. Under
  `testApp` only `DEPLOY_TARGET` is set, to `test`.
- **Documentation is markdown in [docs/](docs), one topic per subsystem.** A topic is reader-facing prose with
  frontmatter giving it a `title` and an `order`; it carries no status line and no project bookkeeping, which
  lives here instead. Links between topics are written as files (`[bundles](bundles.md)`), never into `src/`.
  Changing how something works means changing its topic in the same commit, and the endpoint descriptions are
  the tool reference, so no topic restates them.
- **`/docs` serves the markdown the deploy was built with, and nothing else.** The README, the licence and the
  topics are the only sources: [pages.ts](src/docs/pages.ts) renders them in the docs' own chrome
  ([layout.ts](src/docs/layout.ts)) and contains no prose, because a paragraph written there would be a source
  nobody thinks to update. The Worker has no repository to read, so
  [docs-content.mjs](scripts/docs-content.mjs) writes them into `src/docs/content.ts`, which is gitignored and
  never committed: the `generate` script writes it, which the platform runs on every install, dev and
  deploy, and `typecheck` and `test` run it again first, because the tests hold the module to the markdown
  on disk and a topic edited since the last install would otherwise fail them. `linkToPage` in
  [topics.ts](src/docs/topics.ts) turns a link to a topic file into its page and any other relative link into
  one to the repository, and [docs.test.ts](src/docs/docs.test.ts) fails on a docs link that would 404.
- **The skill points at the site, it does not copy it.** [skills/pages-api](skills/pages-api) is an Agent Skills
  collection shipped from this repo, installed with `npx skills add celsoft-com/pages --skill '*' -g -y`. Every
  install is a different site at a different URL, so the skill teaches an agent how to find the address and the
  token, not what the tools are: [pages-call](skills/pages-api/scripts/pages-call) learns the tools, and whether
  each is a GET or a POST, from the site's own `/api/platform/openapi.json`. It carries no tool list, no schema
  and no copy of the connect-time instructions, and [skill.test.ts](src/skill.test.ts) fails if it names a tool
  or argument that does not exist or repeats a twelve-word run of `MCP_INSTRUCTIONS`. Its scripts need only
  Python 3, keep the token out of argv, take arguments as a file rather than a command line so page content never
  reaches the process list, and never block on stdin.
- **The tool reference is the endpoints, drawn.** `/docs/tools` renders the platform's
  `openApiDocument(endpoints, ...)` as tables in [reference.ts](src/docs/reference.ts): each tool's description,
  its arguments and its result, every word from the endpoint's own `description` and `.describe()` calls. The
  groups are the files that define the endpoints, through `ENDPOINT_GROUPS` in
  [endpoints/index.ts](src/endpoints/index.ts), so nothing keeps a list of tools. [docs/tools.md](docs/tools.md)
  is the reference's introduction rather than a page of its own.

## Not available yet

These wait on @celsoft/platform. Build none of them, and no stand-in for any of them, until the
platform offers what each needs.

- **An admin screen.** The owner works through Claude, the API and the platform's own screens.
