---
title: Connecting a client
order: 20
---

# Connecting a client

One API with two services in front of it. Both carry the same tools, take the same arguments and
return the same results; what differs is how a client signs in, how a call is wrapped, and what
comes back when one fails. Pick by what the client is: **MCP** for a chat client that can sign a
person in, **REST** for a script, a cron job or an agent with no browser.

Every call itself is documented once, both ways, in the [tool reference](/docs/tools).

## Over MCP

Connector URL: `{{mcp_url}}`

Add it in Claude as a custom connector, sign in with the site's admin password and approve.

Signing in is authorization code with PKCE and dynamic client registration, hand-rolled on this
site, so a client discovers everything it needs from two well-known documents:

```
GET {{site_url}}/.well-known/oauth-authorization-server
GET {{site_url}}/.well-known/oauth-protected-resource
```

A bearer token minted in the admin is accepted here too: the credential decides what a caller may
do, not the door it came through.

POST only, JSON-RPC 2.0, protocol version `{{protocol_version}}`. The methods are `initialize`,
`ping`, `tools/list`, `tools/call`, and the `notifications/initialized` and
`notifications/cancelled` notifications. A batch of messages in one array is answered with an array.

A tool call comes back as text: the result rendered into a sentence for a reader. A tool that
refuses answers with that same text and `isError: true`, so the JSON-RPC response is a success
either way and there is no status code to read.

## Over REST

Base URL: `{{api_url}}`

POST the arguments as a JSON object to the tool's own URL, with a bearer token minted in the admin
under Connections. The reply is the result itself as JSON, with exactly the fields in that tool's
Result table.

```
curl -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"path":"/beers","fields":{"name":"Pilsner"}}' \
  {{api_url}}/put_item
```

It is plain HTTP and JSON, so any language calls it with nothing installed, and one small client
covers every tool:

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

`GET {{api_url}}` returns the site's instructions, the access level of the token that asked, and
every tool that token may call with the JSON Schema of its arguments and of its reply. That list is
generated from the site, so it is never out of date.

## Credentials

Mint a token in the admin under Connections, and pick whether it may write or only read. A token
never expires; revoking is the control, and it lands on the holder's next call because the stored
record is read on every request.

A read-only credential is shown only the tools marked **read** at either door. The rest are hidden
from it as well as refused, so a client never builds a call it was never going to be allowed to
make.

## When a call fails

Over MCP the failure is the reply: the message as text, with `isError: true`. Over REST it is a
status and a message.

| Code | Meaning |
| ---- | ------- |
| 200 | The tool ran. The body is its result. |
| 400 | The tool refused the arguments, or the body was not a JSON object. The message says what. |
| 401 | No credential, or one that has been revoked. |
| 403 | A read-only credential asked for a tool that writes. |
| 404 | No tool of that name. |
| 405 | GET the index, POST a tool. |
| 409 | A revision conflict: the `if_rev` you passed is stale. Re-read and reapply. |
| 429 | Too many failed credentials from this address. `Retry-After` says when, and nothing says how close a guess came. |

409 exists so a service retrying on a schedule can tell a stale revision from a dead token without
reading the sentence. REST responses are never cached anywhere, because what they return varies by
credential.

## Bytes

No tool returns the contents of a file, at either door: a reply is text in the caller's context, and
a photograph spent there is one nobody can look at. Read a stored file by fetching its `/assets` URL
over HTTP, with the same bearer token if it sits under a private path. Uploads go the other way as
base64 through `upload_asset`, because one registry serves both services and JSON-RPC carries no
bytes.

## What the server tells a client

This is the instruction text sent with every MCP `initialize`, and returned by `GET {{api_url}}`. It
is the site teaching its own conventions, so a client on a newer deploy is taught the newer ones.

{{instructions}}
