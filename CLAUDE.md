# pages

Self-deployable MCP-driven site host on Cloudflare Workers.

## Local development

```
npm install
npx wrangler dev
```

Local D1, R2 and KV are created automatically. `npx tsc --noEmit` typechecks.

## Architecture

Single Worker, four surfaces, all routed in [index.ts](src/index.ts):

- **Public pages** — everything not claimed by another prefix.
- **Admin UI** — `/admin/*`, server-rendered HTML, no client framework.
- **MCP** — `/mcp`, hand-rolled JSON-RPC over Streamable HTTP.
- **OAuth** — `@cloudflare/workers-oauth-provider` wraps the whole Worker; `/oauth/authorize` is rendered by the admin router.

Storage: D1 for everything structured, R2 for uploaded files, KV for OAuth records and the render cache.

## Rules

- **No local tooling for users.** Deploy is the Cloudflare button. Never add a step that requires a CLI, a checkout, or a dashboard visit that the admin UI could do through the API.
- **Schema migrates itself.** Add a migration to `MIGRATIONS` in [schema.ts](src/schema.ts). Never assume a deploy runs `wrangler d1 migrations apply`; it does not.
- **Upgrades must be frictionless.** A user syncing their fork triggers a rebuild. Anything that would break on that path is a bug.
- **One path normalizer.** [path.ts](src/pages/path.ts) is the only place a page path is normalized. Everything else calls it.
- **Render cache keys carry `updated_at`**, so writes never need an explicit purge.
- **owner_id on every content row.** Single owner today; the field is the seam for multi-user later.
- **Markdown is themed, HTML is verbatim.** Never wrap a stored HTML page.
- **Domains are CNAME-only.** Site owners never move nameservers. Cloudflare for SaaS custom hostnames on one provider zone.
