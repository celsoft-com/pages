# pages

Self-deployable MCP-driven site host on Netlify.

## Local development

```
npm install
netlify dev
```

`npx tsc --noEmit` typechecks. Blobs run locally through `netlify dev`.

## Architecture

One function serves everything, routed in [app.ts](src/app.ts):

- **Public pages** — anything not claimed by another prefix.
- **Admin UI** — `/admin/*`, server-rendered HTML, no client framework.
- **MCP** — `/mcp`, JSON-RPC over Streamable HTTP.
- **OAuth** — hand-rolled in [oauth/](src/oauth), authorization code with PKCE and dynamic client registration.

Storage is Netlify Blobs throughout: `site` (owner, settings, rate limits), `pages`, `assets`, `oauth`.

## Rules

- **No API tokens, ever.** The site never asks for, stores, or uses a provider API token in any form.
- **Custom domains are the user's job.** They add the domain in Netlify. The app does nothing and says nothing about it.
- **No local tooling for users.** Deploy is the button. Never add a step needing a CLI or a checkout.
- **One path normalizer.** [path.ts](src/pages/path.ts) is the only place a page path is normalized.
- **Blob keys carry no slashes.** `encodeKey` in [store.ts](src/store.ts) maps `/a/b` to `a~b`; Netlify rejects keys starting with a slash.
- **Markdown is themed, HTML is verbatim.** Never wrap a stored HTML page.
