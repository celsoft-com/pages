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
- **Upgrades must be frictionless.** Users fork this repo and import the fork in Cloudflare, so Sync fork triggers a rebuild with no git and no CLI. Anything that breaks on that path is a bug.
- **The Deploy to Cloudflare button clones, it does not fork.** A cloned repo has no upstream, so Sync fork does not exist and GitHub cannot open a cross-repo PR. That is why the documented path is fork first, import second.
- **One path normalizer.** [path.ts](src/pages/path.ts) is the only place a page path is normalized. Everything else calls it.
- **Render cache keys carry `updated_at`**, so writes never need an explicit purge.
- **owner_id on every content row.** Single owner today; the field is the seam for multi-user later.
- **Markdown is themed, HTML is verbatim.** Never wrap a stored HTML page.
- **Resource name defaults come from the source repo name.** Verified: the Deploy to Cloudflare flow ignores the Worker name the user types and derives KV/D1/R2 defaults from the repo the button points at. Removing `name` from `wrangler.jsonc` does not change it. A second deploy into one account must rename them in the form. Do not re-investigate.
- **Never pin names, including the Worker's own.** `wrangler.jsonc` declares bindings only: no top-level `name`, no `database_name`, `bucket_name` or namespace title. Whatever the user types in the deploy form names everything. A pinned name overrides their choice and collides on the second deploy into one account.
- **Domains are CNAME-only.** Site owners never move nameservers. Cloudflare for SaaS custom hostnames on one provider zone.
