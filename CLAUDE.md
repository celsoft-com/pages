# pages

Self-deployable MCP-driven site host on Netlify.

## Local development

```
mise run dev          # netlify dev, after installing deps if they are stale
mise run test         # the suite once; args pass through, e.g. -- src/transfer.test.ts
mise run typecheck
mise run build        # typecheck + tests, what Netlify runs before it deploys
```

Tasks are executable zsh files under [mise-tasks/](mise-tasks), never an inline `[tasks]` table;
[_lib.sh](mise-tasks/_lib.sh) is sourced, not run, so it carries no `+x`. The npm scripts still
work and the tasks call them, so there is one definition of each command.

`mise run dev` offers the tailnet over https or not at all. The session cookie
([session.ts](src/auth/session.ts)) and the private-path grant cookie ([gate.ts](src/private/gate.ts))
are both `Secure`, which a browser honours by dropping them over plain http on any host but
localhost, so an http tailnet URL loops the login and opens nothing behind a share link. With
HTTPS certificates enabled on the tailnet the task runs `tailscale serve` in the foreground, so
the config goes away with the server rather than leaving the tailnet pointed at a dead port;
without them it says how to turn them on. Both facts come from one `tailscale status --json`.
Never paper over this by making the cookies conditional: they are the deployed site's cookies.

Blobs run in a local sandbox under `netlify dev`, in this checkout's own `.netlify/`, so every
worktree is its own site with its own password and nothing is shared between them. A new one is an
unset-up site, which is why `mise run dev` looks for the owner blob and prints `/admin/setup` or
`/admin/login` accordingly: a login screen on a site with no owner is the one state that looks
broken rather than new. `mise run dev:reset` deletes this worktree's local site and nothing else.

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
- **REST** at `/api/v1`, the same tool registry over plain HTTP for a service with no browser.
- **OAuth** — hand-rolled in [oauth/](src/oauth), authorization code with PKCE and dynamic client registration.

Storage is Netlify Blobs throughout: `site` (owner, settings, rate limits), `pages`, `assets`, `data`, `oauth`.

A collection is one blob holding an ordered array of items, each with an `id`. [service.ts](src/data/service.ts) owns
the item operations, [query.ts](src/data/query.ts) the search syntax.

Until setup completes, `/` renders [welcome.ts](src/welcome.ts) and every other public path redirects to it.

## Rules

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
  That includes the words: four tool descriptions went on saying a page owned what sat under it long after the
  field was gone, which is worse than a stale comment because the tool text is where a client learns the model.
  [tools.test.ts](src/mcp/tools.test.ts) now fails on ownership vocabulary anywhere but the paragraph denying it.
- **Nothing may hold the whole site.** `/` is not a bundle: `list_bundle`, `delete_bundle` and every bundle
  transfer refuse it at either end. That is
  the whole of the rule. A page, collection or asset may still sit at `/` like any other resource — it is simply
  not reachable through a bundle, and a collection there keeps its `/data/index.json` address. Nothing is migrated.
- **The home page is the contents of the site, not a page.** `/` serves a generated list of every public page,
  [contents.ts](src/pages/contents.ts), so there is nothing to write, keep current or delete: `savePage` and the
  transfer engine both refuse `ROOT_BUNDLE` as a target, and setup seeds no welcome page. It is still a path, and
  that is the point: `/root` is what `set_privacy` closes, what a share link opens and where the favicon sits,
  because `/` itself can never be a scope — a scope holds everything at or under it, and that would be the site.
  `/root` 301s to `/` so it has one URL, and the admin gives it a row on the Pages screen carrying access and
  nothing else. The list leaves out every private page whoever is asking, grant or no grant: showing one to a link
  holder would make a response that varies by cookie, and a public response is durable at the edge, so the next
  visitor gets their copy. A tool aimed at `/root` says the contents is generated rather than that no page is
  there, because a client told nothing is published will publish something.
- **Bundles are organization, never a boundary.** Nothing is rejected, moved or blocked by them.
  `set_collection_refs` may cross bundles and a page may fetch any collection.
- **Copy, move and delete are one service at four levels.** [transfer.ts](src/transfer.ts) is the whole of it:
  `planTransfer` gathers, validates and prices the operation, `applyTransfer` writes with an undo per write. A
  delete is a transfer with no target, which is why all twelve tools take the same arguments and return the same
  envelope. Adding a level or a verb means teaching that one engine, never a parallel path. Reorganizing must
  never be reduced to reading records out through a client and writing them back: that loses a value to a
  mistyped character, and does it silently. That includes the admin: the page editor shows a path and links to a
  move, it never offers it as a text field. Retyping it wrote a new page and deleted the old one, which stranded
  every collection under `/data<path>` and every asset under `/assets<path>`, lost the page's `createdAt`, and
  reported none of it. `/admin/pages/move` offers the whole bundle first and the page alone second, because moving
  the page alone is the choice that leaves URLs behind, and it has to say what it leaves. Both run `runTransfer`,
  so the screen and a client report the same facts: what moved, what still names the path that has gone, what
  points at nothing, and what changed hands between public and private. `restOfBundle` and `privacyChanges` live
  in [transfer.ts](src/transfer.ts) for that reason, not in the MCP layer that first needed them.
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
- **A private path is a path, and the fragment is why it works.** [set_privacy](src/private/service.ts) closes a
  path and everything at or under it through the same `contains()` rule as a bundle, so the page, the collections
  under `/data` and the assets are all gated by one scope; a share link's secret rides in the URL fragment, which
  browsers never put in a request (RFC 3986 §3.5, RFC 9110 §7.1), so it reaches no access log, no proxy and no
  `Referer`, and a link unfurler that fetches the URL gets nothing. The cost is a bootstrap problem: the token
  arrives only in the browser, so the script that reads it has to ride on a response a stranger already gets, which
  is the 404. That is why [pages/handler.ts](src/pages/handler.ts) serves one `closed()` document for a missing page
  and a private one alike, byte for byte, headers included, and why the same identity is required of the asset and
  data 404s. A private path that answered differently from a missing one would announce itself, which is the whole
  thing being bought. Never redirect with a token in a query string; the admin screen renders a new link into its
  own response for exactly that reason. Privacy does not nest, and `/` cannot be private. In the admin it is a
  column on the Pages screen, not a section of its own: it is a property of a page's path, and a page covered by
  another page's scope shows that and offers no second switch for one state. The row carries a state and one
  text action, never a control: three buttons in a narrow cell wrap into a ragged stack and read as three sizes
  of the same thing. The controls all live in the page's own editor, next to its content, because a page has
  one screen and access is a fact about that page; `accessPanel` is the single rendering of them, and the
  standalone `/admin/pages/access` exists only for a private path with no page, redirecting to the editor when
  there is one. Because the POST that mints a link has to render it rather than redirect with it, that response
  rewrites its history entry to whichever GET it came from: a POST left in history means a refresh offers to
  submit it again.
- **The app asks its own questions.** No `confirm`, no `alert`, no `prompt`, and no dialog the browser draws:
  they are unstyled, they say the origin instead of the site, they cannot be tested and on a phone they arrive
  detached from whatever was tapped. A warning is text on the screen next to the thing it is about, rendered by the
  same server that renders the rest. A confirmation is the button mutating in place: the first press turns it into
  its own confirmation, stated in full, and a second press commits, so the question is asked where the answer is
  given and nothing covers the row being acted on. A destructive action that has to explain itself puts the
  explanation in the panel, not in a popup, and the wording says what will happen rather than asking whether the
  user is sure: `Delete /trip/items and its 3 items`, never `Are you sure?`. `confirmAction` in
  [ui.ts](src/admin/ui.ts) is the single rendering of that, and it ships both states in the row, the question
  hidden, so one delegated listener swaps them where they stand and nothing is fetched or reloaded to ask a
  question the server already sent. The link that arms also carries `?confirm=<token>`, which is the state with no
  script running: a delete must never be one unasked press, so the fallback is a screen that comes back armed
  rather than a screen that just deletes. Both states are HTML, which is why
  [confirm.test.ts](src/admin/confirm.test.ts) can pin the wording, the arming and the absence of any dialog.
- **A grant is checked against the stored list on every request.** The cookie is HMAC-signed with the scope path
  inside the payload, so it cannot be replayed against another scope, and the share id is looked up in the blob
  every time, so revoking a link stops it on the holder's next request rather than whenever a cookie would have
  expired. That is what the one extra `site` read per public request buys. A private response uses
  `privateHeaders()` and so carries no CDN header and no cache tag: the purge is blind to what changed and could
  never be trusted to clear something that varies by cookie. [private.test.ts](src/private.test.ts) pins the
  granted response, not just the blocked one, because a page cached at the edge leaks to the next visitor and the
  blocked response looks correct either way.
- **Bytes leave by HTTP, never through a tool.** A tool result is text in the calling agent's
  context, so an asset's bytes can never come back that way: a three megabyte image fetched through
  a tool is spent there, a third larger for the encoding, to produce something the agent cannot look
  at. `/assets/<path>` is the only way to read one, which is why `accessToScope`
  ([gate.ts](src/private/gate.ts)) opens a private scope for a bearer credential, and for the owner's
  own session, as well as for a share cookie. Both are tried only after the share cookie fails, so an
  ordinary visitor pays nothing for either, and the credential goes through `admit` so guessing a
  token there is rate limited like every other door. The session belongs there because the admin
  lists every private page and asset and offers to open them: without it the owner is the one person
  who cannot see their own closed page, and the Assets screen's Open button answers 404, which reads
  as a lost file rather than a closed one. Nothing about
  the response to a request carrying no credential changes, which is what keeps a private path
  indistinguishable from a missing one. The registry stays metadata only: `list_assets` hands out the
  URLs, and `upload_asset` is the single capped exception, base64 in because JSON-RPC carries no
  bytes and a client with no shell has no other way to send a file. Never add a tool that returns
  bytes. The 4 MB cap is not a policy to relax: Netlify caps a function's whole request at 6 MB and
  base64 costs a third, so a raw binary endpoint would buy about 1.4x and cost the second surface
  this design exists to avoid. Chunked upload would lift it properly and brings part storage,
  assembly and cleanup with it; that trade was looked at and declined. What the tool text and the
  skill owe a client is that the ceiling is the host's, so nobody goes hunting for a bigger door.
- **The page editor's highlighting is a CDN script, and it is allowed to fail.**
  [editor.ts](src/admin/editor.ts) loads prism-code-editor from jsDelivr at an exact version on the
  edit screen only. It overlays a real `<textarea>`, so the form posts exactly as it did; replacing
  the placeholder takes the `name` with it, which is why the script puts it back. Bundling it
  instead would mean a client build step for the one screen that wants one, and the fallback costs
  nothing: with no script the field is the plain textarea the server already rendered. The colours
  are the admin's own palette, never a vendored theme, because the admin has a light and a dark
  scheme and a theme file has one.
- **Every URL the site hands out comes from one place.** [origin.ts](src/origin.ts) reads
  `x-forwarded-proto`, because anything terminating TLS in front of this forwards a plain http
  request and `request.url` then names a scheme the visitor is not on. That reached a share link,
  the OAuth metadata, the MCP connector URL and the admin's own origin as five copies of
  `${url.protocol}//${url.host}`, so a sixth would have been written the same way. The header is
  trusted, as `x-forwarded-for` already is in the rate limiter: a forged one can only make a
  generated link say http, which is where it would have been anyway.
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
- **A page is edited in place, not shipped twice.** `get_page` returns the whole source only when asked for
  nothing in particular; `find`, or `offset` and `limit`, return numbered lines, and `edit_page` replaces an exact
  snippet. Rewriting a 31 KB page through `update_page` to change one line spends that body twice, in and out, of
  a client's context. `edit_page` refuses a snippet matching nothing and refuses an ambiguous one with the count,
  because a silent partial edit of verbatim HTML is a broken page nobody looked at. It carries the collection
  steering in its description like every page tool: a cheap targeted edit is exactly what makes pasting one more
  row into a hardcoded table tempting.
- **Reads are shaped to fit a context window.** `list_items` projects and pages, `count_items` answers questions
  about shape without returning records at all, and their descriptions name each other so a client picks the cheap
  one. A tool that returns a few hundred records of prose to answer a question about counts is a bug. That applies
  to the reply as much as the request: `reorder_items` names the ids that moved and counts the rest rather than
  echoing the collection, and every JSON reply is written compact, because indenting one page of `list_items`
  measured 30% more characters for nothing a reader of it needs.
- **Items change one at a time.** Every data tool reads or writes a single item, so editing one costs one small call.
  Never add a tool that makes a client send a whole collection back to change one field.
- **One registry, two presentations.** `TOOLS` in [tools.ts](src/mcp/tools.ts) is the only definition of any
  operation. A tool's `handler` returns a structured result and its `render` turns that result into the text MCP has
  always returned; [handler.ts](src/mcp/handler.ts) calls the renderer and [api/handler.ts](src/api/handler.ts)
  serializes the result. Neither door keeps a table of its own, so a tool cannot exist on one and not the other, and
  a REST body cannot drift from the sentence describing it because both come from one value in one file. That makes
  a handler's result shape published API: changing a field breaks every service calling it, exactly as changing the
  `/data` array would. `access` is a required field rather than something derived from the verb in the name, because
  a convention mislabels a tool silently and a missing field does not compile; `toolsFor` and `allows` are the one
  gate, in front of the registry rather than inside either door. A handler that still returns its own string never
  got split, and [tools.test.ts](src/mcp/tools.test.ts) fails on it. Never add an endpoint that does not come from
  the registry, not even one.
- **Documentation has four sources and no fifth.** `/docs` is the README, the licence, the markdown in
  [docs/](docs), and the tool registry drawn as tables. [docs/handler.ts](src/docs/handler.ts) names no tool, no
  argument and no reply, and contains no prose: a paragraph written into it would be a fifth source, in the one
  place nobody looks when the behaviour it describes changes. So the rule cuts both ways. **Code that this system
  documents has to carry its own documentation**: a tool's `description`, and a `description` on every field of
  its `inputSchema` and `outputSchema`, because those *are* the reference, drawn straight onto the page. And
  **narrative belongs in [docs/](docs) as markdown**, one file per topic, with frontmatter giving it a `title` and
  an `order` for the sidebar; [topics.ts](src/docs/topics.ts) reads both and nothing else decides either.
  [docs/tools.md](docs/tools.md) is the one topic that is not a page of its own: it introduces the generated
  reference at `/docs/tools` and takes that sidebar entry, which is how the reference gets prose without any
  being written into the handler. The set of topics is one per subsystem and is meant to stay that way: getting
  started and working with Claude for somebody who just pressed the button, connecting a client, then pages,
  collections, assets, private paths, bundles, transfers and maps, each answering to a rule in this file. A new
  subsystem earns a topic; a new feature inside one belongs in the topic that already covers it. A topic is
  reader-facing prose, so it carries no status line, no acceptance criteria and no non-goals list: the reasoning
  that explains behaviour stays, the project bookkeeping lives here instead. A link out of a topic goes to
  another topic as a file (`bundles.md`) or to `/docs/...`, never into `src/`, and
  [docs.test.ts](src/docs/docs.test.ts) fails on one that would 404 for a reader. Changing
  how something works means changing the topic in the same commit, exactly as it means changing a tool's
  description: the topic is the only place the reasoning lives, and a stale one is worse than a missing one.
  Markdown links between topics are written as files (`[bundles](bundles.md)`), because the folder is read on
  GitHub and in an editor too, and `linkToPage` turns them into pages when they are served.
- **One tool, one entry, and the transport is a tab.** MCP and the REST API are two services in front of one
  API, so the reference documents a tool once: the description, the arguments and the result are the same value
  whichever door the call came through, and the only thing that differs is the envelope.
  [example.ts](src/docs/example.ts) builds both envelopes from the tool's own input schema, required arguments
  only, so a new argument appears in both at once and neither example is written down anywhere. The tabs are
  radio inputs and work with no script; the script in [layout.ts](src/docs/layout.ts) only keeps every set on a
  page in step, so choosing REST once does not have to be chosen fourteen times on the way down. If a tool ever
  is offered at one door and not the other, that belongs in the registry and in the tab, never in a second page
  documenting one service's tools apart from the other's. The same goes for connecting:
  [docs/api.md](docs/api.md) is one topic covering both doors, because signing in over each is a difference
  between two services of one API, not two APIs to describe in turn.
- **A topic may take a value from the code, never a sentence.** `fills` in [topics.ts](src/docs/topics.ts) is the
  whole list: the site's own URLs, the MCP protocol version, and the `INSTRUCTIONS` string. A placeholder outside
  that table fails [docs.test.ts](src/docs/docs.test.ts) rather than printing `{{whatever}}` on a page, and the
  same test fails on any `{{` surviving into the HTML. That table is how prose states a fact the code decides
  without restating it: never write the connector URL, the protocol version or a copy of the instructions into
  markdown.
- **`outputSchema` is required for the same reason `access` is.** A handler's result is the REST body byte for
  byte, so its shape is published API, and it is now published documentation as well.
  [results.test.ts](src/mcp/results.test.ts) holds every reply against the declaration through
  [shapes.ts](src/test/shapes.ts) and fails on a key returned and not declared, a declared key not returned, or one
  of the wrong type. `group` is required for the same reason again: the reference's navigation comes from the
  registry, so no screen keeps a list of tools.
- **The markdown is carried into the bundle, not read from disk.** esbuild bundles source, not the files beside
  it, so [docs-content.mjs](scripts/docs-content.mjs) copies README.md, LICENSE.md and every `docs/*.md` into
  [content.ts](src/docs/content.ts). It runs in `build:deploy` ahead of the tests, so a deploy ships the markdown
  it was built from and there is no step to remember; the copy is committed too, because `mise run dev` and the
  suite read it rather than running a build, and [content.test.ts](src/docs/content.test.ts) fails when it is
  stale. `mise run docs` refreshes it. `/docs` is a reserved prefix matched on a segment boundary, and it is
  served before the setup check, because a site with no owner yet is exactly where somebody reads the
  documentation.
- **A service gets a token, never the OAuth flow.** A cron job has no browser to render a consent screen in and no
  redirect URI to receive a code at, so the owner mints a bearer token in the admin and pastes it in
  ([tokens.ts](src/auth/tokens.ts)). One resolver reads every credential off one header
  ([principal.ts](src/auth/principal.ts)), which is why an OAuth token reaches `/api/v1` and a minted token reaches
  `/mcp`: the access level rides on the credential, not on the door. The stored record is read on every request, so
  revoking lands on the holder's next call rather than whenever a token would have expired, and that is what the one
  extra read buys. Tokens never expire; revocation is the control. The plaintext exists only in the response that
  mints it, which renders it rather than redirecting with it and rewrites its own history entry, for the same reason
  a share link does. A read-only token is not shown the write tools at either door, because a client that cannot see
  one never builds a call it was never going to be allowed to make.
- **A result shape is pinned, because rendering hides a broken one.** Every other suite asserts the sentence a
  tool renders, and a renderer will happily build the right words out of the wrong object, so those tests pass
  while the REST body changes underneath. [results.test.ts](src/mcp/results.test.ts) asserts the exact key set of
  all 37 results, both branches of the ones that have two, and that a tool with no entry there fails the suite.
  Renaming a published field is then one failing test instead of a silent break in somebody's cron job.
- **A bearer credential is rate limited; an interactive login is not the only guessable thing.** `admit` in
  [principal.ts](src/auth/principal.ts) fronts both doors: it reads the bucket before the credential lookup, so a
  limited address is refused without the site doing the work, and records a failure only when one is rejected, so
  a service polling every minute never accumulates. It uses the counter the admin login uses under an `api:` key of
  its own, because a cron with a stale token must not lock its owner out of their own admin. A limited caller gets
  429 and `Retry-After` and is told nothing about how close it got, including when its token was in fact valid.
- **The API says what kind of failure it was.** A thrown tool error is 400, a missing or revoked credential 401, a
  read-only credential attempting a write 403, an unknown tool 404, and a revision conflict 409. That last one is why
  `ConflictError` exists ([errors.ts](src/errors.ts)): a service retrying on a schedule has to tell a stale `if_rev`
  from a dead token without reading the sentence, and the message is unchanged either way so MCP cannot tell the
  difference. API responses use `privateHeaders()` and are never stored at the edge, because what they return varies
  by credential. A call to a read tool does not fire the purge (`apiCallWrites`), since a service polling one every
  minute would otherwise keep the whole site's cache cold; only a proven read opts out, so forgetting to teach that
  about something is slow rather than wrong.
- **The skill points at the site, it does not copy it.** [skills/pages-api](skills/pages-api) is an Agent Skills
  collection shipped from this repo, installed with `npx skills add celsoft-com/pages --skill '*' -g -y` and named in the README
  and on the Connections screen. It exists because every install is a different site at a different URL, so an agent
  needs to be told how to find the address and the token, not what the tools are. It carries no tool list, no schema
  and no copy of the instructions: `INSTRUCTIONS` is one string in [handler.ts](src/mcp/handler.ts) that MCP and the
  API both serve, and the skill sends the agent to fetch it, so a site on a newer deploy teaches its own conventions
  with nothing to update on anyone's laptop. That is the whole point, and it is pinned:
  [skill.test.ts](src/skill.test.ts) fails if any twelve-word run of the instructions reappears in the skill, or if
  the skill names a tool that no longer exists. A summary sentence is fine; a paragraph lifted across is the bug.
  Its scripts keep the token out of argv by passing it through a curl config file, take arguments as a file rather
  than a command line so page content never reaches the process list, and never block on stdin: an agent's stdin is
  an open pipe nobody closes, so `pages-call` reads it only when passed `-` and `pages-login` reads it with a timeout.
- **Content is stored, never built, and the instructions have to say so.** One function serves every page,
  collection and asset out of blobs, so a write is live on the next request: no build runs, no deploy happens, and
  nothing about publishing touches git or this repo. That is not what a Netlify repo looks like from outside, and a
  client that assumes a static site generator reaches for a commit and a push to publish, which would put somebody's
  page into the site's source code. So `INSTRUCTIONS` states it in the site's own voice, names the tools a client
  must not reach for, and [handler.test.ts](src/mcp/handler.test.ts) pins those sentences. The README says the same
  thing before the deploy button, because the button is where the wrong model comes from.
- **A number in prose drifts away from the header that means it.** The instructions told clients a collection was
  cached for sixty seconds while `MAX_AGE` in [cache.ts](src/cache.ts) said five minutes, and the purge on every
  write meant neither figure described what a reader actually saw. `MAX_AGE` is exported so a test can hold the
  stated window and the header together; state the behaviour first (a write clears the CDN as it finishes) and the
  backstop second, and never quote a duration that nothing pins.
- **The API is HTTP, and the skill's scripts are a convenience.** `POST /api/v1/<tool>` with a JSON object and a
  bearer token is the whole interface, so any language calls it with nothing installed. The bundled scripts exist
  for two shell-specific problems, a token reaching argv and a page body reaching shell quoting, and documenting
  only them taught clients that the API *is* a shell tool: the first reader concluded that uploading a file meant
  base64 through a here-doc and balked, which is a fair reading of a page that showed nothing else.
  [SKILL.md](skills/pages-api/SKILL.md) leads with the HTTP shape and a dependency-free client, and says to prefer
  it for anything binary or bulky. `upload_asset` carries bytes as base64 because one registry serves this API and
  a JSON-RPC connector both, and JSON-RPC cannot carry bytes; a raw binary endpoint would be the second surface the
  whole design exists to avoid, so the answer is to show the one line that encodes a file, not to add an endpoint.
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
- **Geo runs at authoring time and stores its answer.** [geo/](src/geo) holds the site's only outbound calls:
  `geocode` turns a name into candidates, `route` writes a GeoJSON line to an asset. Both run while a page is being
  written and never when one is read. That is the whole line, and it is what keeps this from becoming an integration
  platform: the site may do authoring-time work whose output it stores, and may never fetch at request time. A
  coordinate passes that test; a weather feed fails it, and putting one behind a tool would place a provider in front
  of every visitor and make a response that cannot be cached at the edge. Result shapes are the intersection of what
  every provider can produce, never the union: no vendor id, no vendor score scale, no label composed for display, no
  styling, SI units, and `null` rather than zero where a provider reports nothing, because no answer and no climb are
  different facts. A vendor id in a published result marries the API to that vendor for the life of the API.
  `geocode` returns candidates and never one answer: a geocoder is a guess, the caller is the only thing that can
  judge it, and a wrong Springfield is silent on every axis. `route` never returns the line, because 3330 points out
  and back spends the whole thing twice; the asset is written here and the reply is a summary. Simplification is off
  by default and takes metres, since how much detail a line needs is a question about the zoom it is drawn at and that
  belongs to the page; surviving points come back exactly as the router sent them, elevation included. Cycling and
  walking never go to the public OSRM server: it is a car-only deployment that accepts any profile and answers
  identically either way, so a walking route from it is a motorway that says nothing about being one.
- **A bike route is chosen and then checked, and neither is a score.** `prefer` is `safety`, `balanced` or `speed`,
  cycling only, named for the trade rather than for any provider's profiles. It is a real one: on one 67 km ride
  safety spent 1.6 km extra to cut main-road riding from 4.5 km to 2.7 km, and speed put 48 km of the same ride on
  primary and secondary roads. Asking for one on a walking or driving route is refused, never ignored, because a
  caller who asked for a safer line and silently got the ordinary one believes something untrue about their route.
  Checking is `ways`: metres by surface and by highway type, metres on a signed cycle route, and warnings for
  explicit prohibitions only — `bicycle=no` is a fact somebody wrote down, "busy road" is an opinion. `analyzed_m`
  is the `check_refs` rule again: it is how much of the route carried tags at all, it is 0 when the router reports
  none, and untagged ground is counted under its own name, because a summary that examined nothing must not read
  like one that passed. OSM coverage is near total in Bavaria and thin elsewhere. Never add a single safety number:
  safe depends on the rider, it could not survive a provider change, and the moment one exists nobody reads the
  breakdown. The per-way `segments` table lives in the asset keyed to coordinate indices and is remapped when the
  line is simplified, since thinning it must never leave the table pointing at the wrong places while still
  looking valid.
- **Tests gate the deploy.** `npm run build` is `tsc --noEmit && vitest run`, and Netlify runs it, so a failing test
  fails the deploy. Blobs are mocked in [test/blobs.ts](src/test/blobs.ts); tests never need a network.
