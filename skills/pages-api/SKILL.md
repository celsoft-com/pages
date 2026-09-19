---
name: pages-api
description: "Publish and edit pages, data collections and assets on a self-hosted pages site over its REST API. Use whenever the work is content on such a site: writing or editing a page, adding or changing records in a collection, uploading an image, reorganizing paths, or making something private. Also use when setting up or diagnosing access to one."
verified: 2026-09-18
---

# Working with a pages site

A pages site is one person's website, deployed to their own Netlify account. It serves pages,
JSON data collections and uploaded assets, and it takes instructions two ways: an MCP connector
for a chat client, and this REST API for anything else.

**Never assume the address.** Every install is a different site at a different URL. The site and
token come from configuration, and the scripts here resolve them.

## Getting the tool list

**Fetch it, never carry it.** The site is the authority on what it can do, and a site on an older
deploy has a different list. Run this once per session before the first call:

```
scripts/pages-call
```

That returns every tool the token may use, each with a JSON Schema for its arguments, and an
`instructions` field.

**Read `instructions` in full before proposing or writing anything.** It is not a preamble. It is
the site's own account of how it wants to be used: when repeating content belongs in a data
collection rather than typed into a page, how to edit a page in place instead of rewriting it, how
paths organize pages, collections and assets into folders, why moves run on the server, and what
is public. Working without it produces changes that look right and are wrong in ways the owner
finds later.

That text is deliberately not repeated here. It is one string on the site, served to this API and
to the MCP connector alike, so a site running a newer deploy teaches you its newer conventions
with nothing to update on your side. A copy in this file would be a second, older answer.

## Making a call

Arguments go in as a JSON file, the result comes back as JSON on stdout:

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
