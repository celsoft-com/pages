# pages

A website you build by talking to Claude.

Connect Claude to your site and ask it to publish pages. Markdown gets a clean theme, HTML is served exactly as written.

Lists of things (products, posts, events) can live in a data collection instead of being typed into a page. Claude edits one item at a time, the page fetches the whole collection as JSON, and nothing has to be rewritten to change a price.

## Not a static site generator

Publishing writes a record, and the next visitor sees it. There is no rebuild and no deploy when
you change a word.

Your content never enters this repository. A deploy happens when the site's *code* changes.
Writing a page is not a code change and does not need one.

## How it runs

pages is an app on [@celsoft/platform](https://www.npmjs.com/package/@celsoft/platform), which
provides sign-in, API tokens, the MCP server, storage, the database and deploys. To run your own
copy, set it up with the platform's `celsoft-platform-setup` skill, which ships in the package.
The site's address is the `hostname` in [platform.jsonc](platform.jsonc).

Every push to `main` deploys the site, and every pull request gets a preview of its own at
`pr-<number>.<hostname>`. Tests run first, and a failing test stops the deploy.

## Sign in

Open `/signup` on your site. The first account becomes the owner. After that, sign-up is by
invitation: invite people at `/invites`.

## The admin

Open `/admin` on your site to see and change everything without Claude: pages and their drafts,
data collections, files, private paths and their share links, the instructions Claude follows, and
the site's title and theme.

## Connect Claude

Add `https://<your-site>/mcp` as a custom connector in Claude, sign in, and approve. Then ask
Claude to publish a page.

## Connect a script, a cron job, or an agent

Anything without a browser uses the REST API. Make a token at `/tokens`, and choose how much it
may do: `read` only, up to `manage`.

There is a skill that teaches any agent how to use it. Install it once:

```
npx skills add celsoft-com/pages --skill '*' -g -y
```

The flags matter: without them it opens an interactive picker. Then tell your agent your site's
address and give it the token, and it works out the rest from the site itself. It reaches Claude
Code, Cursor, Codex and anything else that reads the [Agent Skills](https://github.com/anthropics/skills)
format.

Each tool is an endpoint at `/api/v1/<tool>`. Writes take a JSON body; reads are GET with the
input in the query string:

```
curl -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"path":"/beers","fields":{"name":"Pilsner"}}' \
  https://your-site.example/api/v1/put_item
curl -H "Authorization: Bearer $TOKEN" "https://your-site.example/api/v1/list_items?path=/beers"
```

It is plain HTTP and JSON, so any language talks to it with nothing installed:

```python
import json, urllib.request

req = urllib.request.Request(
    f"{SITE}/api/v1/put_item",
    data=json.dumps({"path": "/beers", "fields": {"name": "Pilsner"}}).encode(),
    headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
)
print(json.load(urllib.request.urlopen(req)))
```

## Private pages

Ask Claude to make a path private and it closes to everyone but you, along with everything under
it. Ask for a share link for each person you want to let in, and revoke one when you are done. See
[private paths](docs/privacy.md).

## Documentation

Every deploy serves its own documentation at `/docs`: this README, the topics in [docs/](docs), and
a reference to every tool drawn from the code it is running.

## Development

See [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE.md)
