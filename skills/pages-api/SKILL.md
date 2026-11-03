---
name: pages-api
description: "Publish and edit pages, data collections and assets on a self-hosted pages site over its REST API. Use whenever the work is content on such a site: writing or editing a page, adding or changing records in a collection, uploading an image, reorganizing paths, or making something private. Also use when setting up or diagnosing access to one."
verified: 2026-11-03
---

# Working with a pages site

A pages site is one person's website, running on @celsoft/platform. It serves pages, JSON data
collections and uploaded assets, and it takes instructions two ways: an MCP connector for a chat
client, and this REST API for anything else.

**Never assume the address.** Every install is a different site at a different URL. The site and
token come from configuration, and the scripts here resolve them.

**A call is the publish.** The site keeps its content in storage and serves it live, so a call
here takes effect on the next request. Do not commit anything, do not push, do not open a pull
request, do not run a deploy, and do not go looking for a build to wait on. None of those are how
content reaches this site, and putting somebody's page into a git repository because it looked
like a static site generator is a mess to undo. The site's code is deployed from a repository;
what you write through this API is not.

## Learning what the site can do

**Fetch it, never carry it.** The site is the authority on what it can do, and a site on an older
deploy has a different list. Run this once per session before the first call:

```
scripts/pages-call
```

That prints the site's OpenAPI document, from `GET /api/platform/openapi.json`: every tool with its
method, its path at `/api/v1/<tool>`, a description, the schema of its arguments and of its reply,
and under `x-platform-access` the level it needs. The descriptions are the manual. Read the ones
for the tools you are about to use before proposing or writing anything: they say when repeating
content belongs in a data collection rather than typed into a page, how to edit a page in place
instead of rewriting it, how paths organize pages, collections and assets into folders, why moves
run on the server, and what is public. The site also draws the same document as pages at
`$SITE/docs/tools`, which needs no token: point a person there when they ask what the site can do.

**Then call `get_instructions`.** Those are the owner's rules for this one site, kept by the owner
and by agents alike. Follow them ahead of your own defaults, and when the owner tells you how they
want something done here, record it with `set_instructions`.

None of that is repeated here, so a site running a newer deploy teaches its newer conventions with
nothing to update on your side.

## The API is HTTP, and the scripts are a convenience

A write is a POST of a JSON object with a bearer token; a read is a GET with its arguments in the
query string, an array as `name[]=a&name[]=b` and an object as `name[key]=value`. Every reply is
JSON. Any language does that with no dependencies, and reaching for a real HTTP client is usually
the better move:

```python
import json, urllib.request

def call(tool, **args):
    req = urllib.request.Request(
        f"{SITE}/api/v1/{tool}",
        data=json.dumps(args).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)

call("publish_page", path="/notes", content="# Notes")
```

**Prefer this for anything bulky.** The document says which tools are GETs; send those as a GET.

**Uploading is the one call that is not JSON.** `upload_asset` takes the file as multipart form
data, with `path` beside it, so curl sends it with nothing to encode. The header comes in on stdin
so the token never reaches argv:

```
printf 'Authorization: Bearer %s\n' "$PAGES_API_TOKEN" |
  curl -sS -H @- -F file=@shot.png -F path=/notes/shot.png "$PAGES_SITE_URL/api/v1/upload_asset"
```

Read the error status, not just the body: 409 means a revision moved and the write was refused,
which a retry loop must handle by re-reading rather than resending.

## Downloading an asset

**There is no tool that returns an asset's bytes, and one would be a mistake.** Every reply from
this API is JSON that lands in the calling agent's context, so fetching a three megabyte image
through a tool would spend the whole file there, plus a third again for the encoding, to produce
something the agent cannot look at anyway. The way to read an asset is to fetch its own URL and
write the response straight to a file. That is the only way, and it is not a workaround:

```python
import urllib.request

req = urllib.request.Request(f"{SITE}/assets/trip/map.png",
                             headers={"Authorization": f"Bearer {TOKEN}"})
with urllib.request.urlopen(req) as r, open("map.png", "wb") as out:
    out.write(r.read())
```

Or, from a shell, `curl -o map.png` with the same header. The bytes go from the site to the disk
without passing through the conversation, which is the whole point.

**Get the URL from the site, never build one.** `list_assets` returns every asset with its URL,
and `upload_asset` returns the URL of what it just stored. A file may be stored under a content
hash instead of a path, in which case there is no path to assemble a URL from.

**The token matters only for a private path.** A public asset needs no credential at all. One
under a path the owner has closed answers 404 to everybody without one, byte for byte the same
404 as a file that was never uploaded, so an agent that omits the header cannot tell the two
apart and will report the asset missing.

**Uploading is the mirror image.** Send the file from disk as above. Never read a binary file into
the conversation to encode it by hand: the file is the point at which the bytes stop being something
anyone has to look at.

**A file too big is a dead end, not a different door.** The size ceiling is the host's, so there
is no bulk endpoint hiding somewhere, no way to send a file in pieces and nothing to be gained by
trying another client. A photograph over the limit has to be resized or recompressed before it goes
up. Say that to the owner rather than retrying, and never quietly upload a cropped or degraded
version of what they gave you.

## Making a call from a shell

The bundled scripts need Python 3 and nothing else. They exist so a token never reaches argv, a
page body never reaches shell quoting, and a GET's arguments are encoded the way the site reads
them. Arguments go in as a JSON file, the result comes back as JSON on stdout, and whether the call
is a GET or a POST comes from the site's own document:

```
scripts/pages-call get_page /tmp/args.json
```

A tool that takes no arguments needs no file:

```
scripts/pages-call list_pages
```

Write the JSON with the file-writing tool rather than building it in the shell. A page body is
full of quotes, backticks and newlines, and every one of them is a way for a here-doc to mangle
the content silently. Passing `-` in place of the filename reads stdin instead, which is worth
using only for something genuinely short.

There is deliberately no way to pass arguments on the command line: a page would end up in the
process list and in shell history.

## What a failure means

The exit code says which, so branch on it rather than on the message:

| Code | Meaning | Do |
| --- | --- | --- |
| 0 | worked | carry on |
| 2 | no site configured | set it up, see below |
| 3 | token unknown, expired or revoked | run `scripts/pages-doctor`, then ask the owner for a new token |
| 4 | the token is capped at read and the call writes | tell the owner; they can make a token with a higher cap |
| 5 | no such tool, or a path this token cannot reach | re-read the API document; a private path or a low cap looks the same as nothing there |
| 6 | a revision conflict | re-read the item, reapply the change, write again. Never retry the same body |
| 64 | the arguments file is missing | check the path you wrote it to |
| 1 | anything else | the message names the problem, usually a bad argument |

A `6` is the one worth handling properly. Writing an item takes the `rev` you read as `if_rev`,
so a write built on a stale read is refused rather than silently overwriting someone else's edit.
Re-read, reapply, resend. Do not strip `if_rev` to force it through, and do not pass `overwrite`
unless the owner has said to discard what is there.

## Setting up access

Needed once per machine, and again whenever a token is revoked or expires.

1. **Ask the owner for their site's address.** It is whatever they open in a browser.
2. **Tell them where the token is.** Signed in to their site, they open `/tokens`, name a token,
   give it a cap (`read` for looking, `write` or above for changing things, `manage` for privacy
   and site settings) and create it. It is shown once.
3. **Have them run it themselves:**

   ```
   scripts/pages-login https://their-site.example
   ```

   At a terminal it asks for the token and does not echo it. Piping one in works too, for CI.
   Either way the token never becomes a command argument, because that would put it in shell
   history and in the process list. Never put a token in a command, and never echo one back, not
   even partially.

`PAGES_SITE_URL` and `PAGES_API_TOKEN` in the environment override the saved config, which is
what CI and a staging site should use.

## When something is wrong

Do not check anything before an ordinary call. Run the call; if it fails, then diagnose:

```
scripts/pages-doctor
```

It changes nothing, never prints the token, and reports one fact per line: which config it found,
the site, whether the credential reaches the API document, and how many tools it lists. `READY: no`
comes with a `FIX:` line.

## What this cannot do

- **It is not the owner's account.** Passwords, invitations, tokens and the MCP connector are the
  owner's, in their browser.
- **A token acts as its owner, never above its cap,** so a refused call may mean the token rather
  than the site.
