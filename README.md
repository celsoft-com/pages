# pages

A site host you run yourself, published to by Claude.

Deploy it to your own Cloudflare account, connect it to Claude as an MCP connector, and ask Claude to write and publish pages. Markdown gets a clean theme; HTML is served exactly as written. Everything lives in your Cloudflare account: pages, files, settings, domains.

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/seanodell/pages)

The button forks this repo into your GitHub account, creates the database, bucket and KV namespaces, and deploys the Worker. No local setup, no CLI, no config to edit.

Then:

1. Open your new site. It asks you to set an admin password and shows a recovery code once. Save it.
2. Go to **Connections** and copy the MCP URL.
3. In Claude, add it as a custom connector. Sign in with your admin password and approve.
4. Ask Claude to publish a page.

## Custom domains

Your site works immediately on its `workers.dev` address. To use your own domain:

1. In **Domains**, paste a Cloudflare API token scoped to one domain in your account. That domain is the home base this service runs on, and it is the only domain that ever needs to be on Cloudflare.
2. Add any hostname you want to publish at, such as `blog.example.com`.
3. Add the two records shown at whatever DNS provider you already use. Nothing moves, nothing transfers.
4. The certificate issues on its own, usually within a few minutes.

Bare domains such as `example.com` work only if your DNS provider supports CNAME flattening or ALIAS records. Subdomains always work.

The API token needs: `Zone : SSL and Certificates : Edit`, `Zone : DNS : Edit`, `Zone : Workers Routes : Edit`, `Zone : Zone : Read`.

## Upgrading

Sync your fork with this repo on GitHub. Cloudflare rebuilds and redeploys automatically, and the database migrates itself on the next request. Your pages, files and settings are untouched.

## What Claude can do

`list_pages`, `get_page`, `publish_page`, `update_page`, `delete_page`, `upload_asset`, `list_assets`, `delete_asset`, `get_site`, `set_site_info`.

## Cost

Requires the Workers Paid plan ($5/month) for R2 file storage. Custom domains are free up to 100, then $0.10 each per month.

## Local development

```
npm install
npx wrangler dev
```

## License

MIT
