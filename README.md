# pages

A website you talk to Claude to build.

Deploy it to your own Cloudflare account, connect Claude, and ask it to publish pages. Markdown gets a clean theme, HTML is served exactly as written. Your pages, files, settings and domains all live in your Cloudflare account.

## Deploy

1. **Fork this repo** to your own GitHub account.
2. In the Cloudflare dashboard, open **Compute → Workers**, choose **Import a repository**, and pick your fork.
3. Deploy it. Cloudflare creates the database, bucket and namespace it needs.
4. Open the Worker in the dashboard and follow its `.workers.dev` address.
5. Pick an admin password on first visit.

That's the whole setup. The site takes it from there.

## Updates

Open your fork on GitHub and click **Sync fork**. Cloudflare rebuilds and redeploys on its own, and the database migrates itself. Your pages, files and settings are untouched.

## Cost

Workers Paid, $5/month.

## License

MIT
