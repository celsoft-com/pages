---
title: Tool reference
order: 25
---

# Tool reference

Every tool is the same tool whichever way it is called: the same name, the same arguments, the same
result. Nothing is offered over MCP and withheld from REST, or the other way round. Over REST each is
an endpoint at `/api/v1/<tool>`, a GET for a read and a POST for a write; over MCP it is a tool of the
same name.

Each tool documents itself: its description, and a description on every argument and every field of
its result. The reference below is drawn from those, so it describes the deploy serving it. A client
reads the same thing as an OpenAPI document at `/api/platform/openapi.json`, with a token or signed
in, and an MCP client reads it from the tool list when it connects.

The tag beside each tool is the level it needs on the path it names, or on the site: `read`,
`create`, `write`, `delete` or `manage`. A token's cap must reach it, and on a
[private path](privacy.md) only the owner has it.

Signing in, tokens and status codes are in [connecting a client](api.md).
