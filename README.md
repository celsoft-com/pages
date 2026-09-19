# pages

A website you talk to Claude to build.

Deploy it to your own Netlify account, connect Claude, and ask it to publish pages. Markdown gets a clean theme, HTML is served exactly as written.

Lists of things (products, posts, events) can live in a data collection instead of being typed into a page. Claude edits one item at a time, the page fetches the whole collection as JSON, and nothing has to be rewritten to change a price.

## Not a static site generator

This deploys once and then stops being a build. One function serves every page, collection and
asset out of storage, so publishing writes a record and the next visitor sees it. There is no
rebuild, no deploy, and no build minutes burned when you change a word.

Your content never enters this repository. A deploy happens when the site's *code* changes, which
is when you take an upstream update. Writing a page is not a code change and does not need one.

## Deploy

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/celsoft-com/pages)

Open your site and pick an admin password. That's the whole setup.

### Deploying from a fork

The button copies this repo into your account with no link back, so later improvements never reach you. If you want them, fork the repo first and point Netlify at your fork instead (**Add new project → Import an existing project**).

GitHub's **Sync fork** button then pulls in upstream changes, and Netlify redeploys on push. Still no checkout, no CLI.

## Connect Claude

Open **Connections** in your site, copy the URL, and add it as a custom connector in Claude. Sign in with your admin password and approve.

Then ask Claude to publish a page.

## Connect a script, a cron job, or an agent

Anything without a browser talks to the site over its REST API instead. Open **Connections**,
create an API token under **API tokens**, and pick whether it may write or only read.

There is a skill that teaches any agent how to use it. Install it once:

```
npx skills add celsoft-com/pages --skill '*' -g -y
```

The flags matter: without them it opens an interactive picker. Add `-a '*'` if it asks which agent
to install to.

Then tell your agent your site's address and give it the token, and it will work out the rest
from the site itself. It reaches Claude Code, Cursor, Codex and anything else that reads the
[Agent Skills](https://github.com/anthropics/skills) format.

Calling it directly is two lines:

```
curl -H "Authorization: Bearer $TOKEN" https://your-site.example/api/v1
curl -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"path":"/beers","fields":{"name":"Pilsner"}}' \
  https://your-site.example/api/v1/put_item
```

`GET /api/v1` lists every tool the token may call, with its JSON Schema. That list is generated
from the site, so it is never out of date.

## License

MIT
