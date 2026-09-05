# pages

A website you talk to Claude to build.

Deploy it to your own Cloudflare account, connect Claude, and ask it to publish pages. Markdown gets a clean theme, HTML is served exactly as written. Your pages, files, settings and domains all live in your Cloudflare account.

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/seanodell/pages)

Name your site, then open it and pick an admin password.

That's the whole setup. The site walks you through connecting Claude, and Claude handles the rest, including custom domains.

## Upgrading

Sync your fork on GitHub. Cloudflare redeploys and the database migrates itself. Your content is untouched.

## Cost

Workers Paid, $5/month. Custom domains are free up to 100.

## Local development

```
npm install
npx wrangler dev
```

## License

MIT
