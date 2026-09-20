---
name: pages-api
description: "Publish and edit pages, data collections and assets on a self-hosted pages site over its REST API. Use whenever the work is content on such a site: writing or editing a page, adding or changing records in a collection, uploading an image, reorganizing paths, or making something private. Also use when setting up or diagnosing access to one."
verified: 2026-09-18
---

# Working with a pages site

A pages site is one person's website, running on their own Netlify account. It serves pages, JSON
data collections and uploaded assets, and it takes instructions two ways: an MCP connector for a
chat client, and this REST API for anything else.

**Never assume the address.** Every install is a different site at a different URL. The site and
token come from configuration, and the scripts here resolve them.

**A call is the publish.** The site keeps its content in storage and serves it live, so a call
here takes effect on the next request. Do not commit anything, do not push, do not open a pull
request, do not run a deploy, and do not go looking for a build to wait on. None of those are how
content reaches this site, and putting somebody's page into a git repository because it looked
like a static site generator is a mess to undo. The site's code is deployed from a repository;
what you write through this API is not.

## Getting the tool list

**Fetch it, never carry it.** The site is the authority on what it can do, and a site on an older
deploy has a different list. Run this once per session before the first call:

```
scripts/pages-call
```

That returns every tool the token may use, each with a JSON Schema for its arguments, and an
`instructions` field. The same site also draws that registry as a page at `$SITE/docs`, which adds
the shape of each reply and needs no token: read it when a person asks what the site can do.

**Read `instructions` in full before proposing or writing anything.** It is not a preamble. It is
the site's own account of how it wants to be used: when repeating content belongs in a data
collection rather than typed into a page, how to edit a page in place instead of rewriting it, how
paths organize pages, collections and assets into folders, why moves run on the server, and what
is public. Working without it produces changes that look right and are wrong in ways the owner
finds later.

That text is deliberately not repeated here. It is one string on the site, served to this API and
to the MCP connector alike, so a site running a newer deploy teaches you its newer conventions
with nothing to update on your side. A copy in this file would be a second, older answer.

## The API is HTTP, and the scripts are a convenience

Every call is one POST of a JSON object with a bearer token, and every reply is JSON. Any language
does that with no dependencies, and reaching for a real HTTP client is usually the better move:

```python
import base64, json, urllib.request

def call(tool, **args):
    req = urllib.request.Request(
        f"{SITE}/api/v1/{tool}",
        data=json.dumps(args).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)

call("publish_page", path="/notes", content="# Notes")
call("upload_asset", path="/notes/shot.png", filename="shot.png",
     content_type="image/png",
     content_base64=base64.b64encode(open("shot.png", "rb").read()).decode())
```

**Prefer this for anything binary or bulky.** `upload_asset` takes the file base64 encoded in the
field `content_base64`, which is one line in any language and genuinely awkward in a shell, where
it means encoding to a temporary file and splicing it into JSON without a newline getting in. The
field is base64 because one registry serves both this API and an MCP connector, and JSON-RPC has
no way to carry bytes; a raw binary endpoint would be a second surface to keep in step with the
first. Files are capped, and the discovery entry for `upload_asset` states the ceiling.

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
and `upload_asset` returns the URL of what it just stored. A path may be stored under a content
hash instead, in which case there is no path to assemble a URL from.

**The token matters only for a private path.** A public asset needs no credential at all. One
under a path the owner has closed answers 404 to everybody without one, byte for byte the same
404 as a file that was never uploaded, so an agent that omits the header cannot tell the two
apart and will report the asset missing.

**Uploading is the mirror image.** Build the base64 in a program and write the JSON to a file,
then send that file. Never read a binary file into the conversation to encode it by hand, and
never paste base64 into an argument: the file is the point at which the bytes stop being
something anyone has to look at.

**A file too big is a dead end, not a different door.** The cap the discovery entry states comes
from the host's limit on a single request, so there is no bulk endpoint hiding somewhere, no way
to send a file in pieces and nothing to be gained by trying another client. A photograph over the
limit has to be resized or recompressed before it goes up. Say that to the owner rather than
retrying, and never quietly upload a cropped or degraded version of what they gave you.

## Making a call from a shell

The bundled scripts exist so a token never reaches argv and a page body never reaches shell
quoting. Arguments go in as a JSON file, the result comes back as JSON on stdout:

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
| 3 | token unknown or revoked | run `scripts/pages-doctor`, then ask the owner for a new token |
| 4 | token is read-only | tell the owner; a read-only token cannot write and is not shown the tools that would |
| 5 | no such tool | re-fetch the tool list; this site's version may not have it |
| 6 | a revision conflict | re-read the item, reapply the change, write again. Never retry the same body |
| 64 | the arguments file is missing | check the path you wrote it to |
| 1 | anything else | the message names the problem, usually a bad argument |

A `6` is the one worth handling properly. Writing an item takes the `rev` you read as `if_rev`,
so a write built on a stale read is refused rather than silently overwriting someone else's edit.
Re-read, reapply, resend. Do not strip `if_rev` to force it through, and do not pass `overwrite`
unless the owner has said to discard what is there.

## Setting up access

Needed once per machine, and again whenever a token is revoked.

1. **Ask the owner for their site's address.** It is whatever they open in a browser.
2. **Tell them where the token is.** In the site, open **Connections**, find **API tokens**, name
   a token, choose read-only or read and write, and press Create. It is shown once.
3. **Have them run it themselves.** The Connections screen shows this command with their address
   already in it, so there is nothing for either of you to type:

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
the site, whether the credential works, what it may do, and how many tools it can reach. `READY:
no` comes with a `FIX:` line.

## What this cannot do

- **It is not the admin.** Passwords, recovery codes and the OAuth connector are the owner's, in
  their browser.
- **A read-only token is not shown write tools at all**, so a missing tool may mean the token
  rather than the site.
- **Custom domains are the owner's job**, in Netlify. Nothing here touches them.
