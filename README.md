# pages

A website you talk to Claude to build.

Deploy it to your own Netlify account, connect Claude, and ask it to publish pages. Markdown gets a clean theme, HTML is served exactly as written.

Lists of things (products, posts, events) can live in a data collection instead of being typed into a page. Claude edits one item at a time, the page fetches the whole collection as JSON, and nothing has to be rewritten to change a price.

## Deploy

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/celsoft-com/pages)

Open your site and pick an admin password. That's the whole setup.

### Deploying from a fork

The button copies this repo into your account with no link back, so later improvements never reach you. If you want them, fork the repo first and point Netlify at your fork instead (**Add new project → Import an existing project**).

GitHub's **Sync fork** button then pulls in upstream changes, and Netlify redeploys on push. Still no checkout, no CLI.

## Connect Claude

Open **Connections** in your site, copy the URL, and add it as a custom connector in Claude. Sign in with your admin password and approve.

Then ask Claude to publish a page.

## License

MIT
