---
title: Tool reference
order: 25
---

# Tool reference

One API, two services in front of it. Every tool here is the same tool whichever way it is called:
the same name, the same arguments, the same result. Nothing is offered over one and withheld from
the other, and the entry below is written once for both. The tabs on each call show the only part
that differs, which is the envelope it travels in.

**MCP** is JSON-RPC over Streamable HTTP, for a chat client that can sign a person in. The reply is
text: the result rendered into a sentence for a reader. A tool that refuses answers with that same
text and `isError: true`, so a failure arrives as a successful JSON-RPC response and there is no
status code to read.

**REST** is one POST per call, for a script, a cron job or an agent with no browser. The reply is
the result itself, as JSON, with exactly the fields in its Result table. A failure is an HTTP status
and a message.

Signing in, tokens, status codes and the rest of what separates the two are in
[connecting a client](api.md).

The credential decides what may be called, not the door it came through. A read-only token is shown
only the tools marked **read**; the rest are hidden from it as well as refused, so a client never
builds a call it was never going to be allowed to make.

The example on each call carries its required arguments only, with a placeholder for each value.
**Arguments** lists everything it takes, required and optional. **Result** is what comes back: a
field marked *always* is one a caller can count on, and *sometimes* means it depends, which the
note on that row explains.
