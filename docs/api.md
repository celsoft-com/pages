---
title: Connecting a client
order: 20
---

# Connecting a client

Every tool is offered two ways: as an MCP tool for a chat client that can sign a person in, and as
a REST endpoint for a script, a cron job or an agent with no browser. Both take the same arguments,
return the same result and are checked the same way; what differs is how a client signs in and how
a call is wrapped.

## Over MCP

Add `https://<your-site>/mcp` as a custom connector, sign in with your account on the site and
approve. The client discovers the rest itself: the sign-in is OAuth, and the tool list carries
each tool's description and the schema of its arguments.

## Over REST

Each tool is an endpoint at `https://<your-site>/api/v1/<tool>`, called with a token:

- **Writes** are a POST with the arguments as a JSON object.
- **Reads** are a GET with the arguments in the query string, so a token capped at `read` reaches
  them. An array or object goes in bracket notation: `?fields[]=name&fields[]=price`.

The reply is the result itself as JSON.

```
curl -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"path":"/beers","fields":{"name":"Pilsner"}}' \
  https://<your-site>/api/v1/put_item
curl -H "Authorization: Bearer $TOKEN" "https://<your-site>/api/v1/list_items?path=/beers"
```

It is plain HTTP and JSON, so any language calls it with nothing installed, and one small client
covers every write:

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
```

`GET /api/platform/openapi.json`, with the same token, is the OpenAPI document of every endpoint: its
method, path, arguments, result and the level it needs. The [tool reference](tools.md) draws the
same document as pages.

## Tokens

Make a token at `/tokens` while signed in, and give it a cap: `read`, `create`, `write`, `delete` or
`manage`. A token acts as you, never above its cap: a `read` token gets a 403 on anything but a
read. A call that names a path is checked on that path, and a cap too low for it answers 404, the
same as a path that is not there. Revoke a token on the same screen.

## When a call fails

A refused call is an HTTP status and a message saying what was wrong.

| Code | Meaning |
| ---- | ------- |
| 400 | The arguments were refused. The message says which and why. |
| 401 | No token, or one that is unknown, expired or revoked. |
| 403 | A `read` token asked for something other than a read. |
| 404 | Nothing at that path, or a path you may not reach: the two look the same. |
| 409 | A revision conflict: the `if_rev` you passed is stale. Re-read and reapply. |
| 413 | An upload larger than the ceiling, refused unread. |
| 429 | Too many requests from one caller. `retry-after` says when to try again. |

409 exists so a service retrying on a schedule can tell a stale revision from a dead token without
reading the sentence.

## Bytes

No tool returns the contents of a file: a reply is text in the caller's context, and a photograph
spent there is one nobody can look at. Read a stored file by fetching its `/assets` URL over HTTP.
Uploads go the other way through `upload_asset`: multipart form data over REST, where `curl -F
file=@photo.jpg -F path=/kitchens/photo.jpg` is the whole call, and base64 from an MCP client. See
[images and files](assets.md).

## The owner's instructions

`get_instructions` returns how the owner wants this site written, and `set_instructions` replaces
it. A client should read them before it writes anything.
