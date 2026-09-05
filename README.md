# pages

A website you talk to Claude to build.

Deploy it to your own Cloudflare account, connect Claude, and ask it to publish pages. Markdown gets a clean theme, HTML is served exactly as written. Your pages, files, settings and domains all live in your Cloudflare account.

## Deploy

**Fork this repo first.** Then in the Cloudflare dashboard open **Compute → Workers**, choose **Import a repository**, and pick your fork.

Deploy it, then open the Worker in the dashboard and follow its `.workers.dev` address. Pick an admin password on first visit. That's the whole setup.

### Just trying it out

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/seanodell/pages)

One click, no fork. The catch: this clones the repo rather than forking it, so there is no **Sync fork** button later and updates need a terminal. Fine for a look, not for a site you keep.

## Updates

Open your fork on GitHub and click **Sync fork**. Cloudflare rebuilds and redeploys on its own, and the database migrates itself. Your pages, files and settings are untouched.

## Cost

Workers Paid, $5/month.

## License

MIT
