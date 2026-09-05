import { TOOLS, type ToolContext } from "./tools";

const PROTOCOL_VERSION = "2025-06-18";

export const INSTRUCTIONS = [
  "Publish and edit pages on this site. Markdown is rendered into the site theme; full HTML documents are served exactly as written.",
  "",
  "Repeating content belongs in a data collection rather than hard-coded into a page: products, posts, events, team members, menu items, FAQs, anything the owner will add to or edit later.",
  "A collection is a JSON array served whole at /data/<path>.json. Write it one item at a time with put_item, change one field with put_item, drop one with delete_item, change the order with reorder_items, and find items with search_items.",
  "Then publish an HTML page that fetches that URL and renders the items, so later edits are one small call instead of a rewrite of the whole page.",
  "",
  "Before publishing a page whose content repeats, offer the owner the choice and say which you recommend: content baked into the page, or a collection the page renders. Baking it in is fine for a one-off; a collection is right for anything that will change.",
].join("\n");

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, any>;
}

function result(id: string | number | null | undefined, value: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result: value };
}

function failure(id: string | number | null | undefined, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function dispatch(message: JsonRpcRequest, ctx: ToolContext): Promise<unknown | null> {
  switch (message.method) {
    case "initialize":
      return result(message.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "pages", version: "0.1.0" },
        instructions: INSTRUCTIONS,
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    case "ping":
      return result(message.id, {});

    case "tools/list":
      return result(message.id, {
        tools: TOOLS.map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });

    case "tools/call": {
      const name = message.params?.name;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return failure(message.id, -32602, `Unknown tool: ${name}`);
      try {
        const text = await tool.handler(message.params?.arguments ?? {}, ctx);
        return result(message.id, { content: [{ type: "text", text }], isError: false });
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        return result(message.id, { content: [{ type: "text", text }], isError: true });
      }
    }

    default:
      return failure(message.id, -32601, `Method not found: ${message.method}`);
  }
}

export async function handleMcp(request: Request): Promise<Response> {
  if (request.method === "GET" || request.method === "DELETE") {
    return new Response(null, { status: 405, headers: { allow: "POST" } });
  }
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let payload: JsonRpcRequest | JsonRpcRequest[];
  try {
    payload = await request.json();
  } catch {
    return Response.json(failure(null, -32700, "Parse error"), { status: 400 });
  }

  const url = new URL(request.url);
  const ctx: ToolContext = { siteUrl: `${url.protocol}//${url.host}` };

  const messages = Array.isArray(payload) ? payload : [payload];
  const responses: unknown[] = [];
  for (const message of messages) {
    const response = await dispatch(message, ctx);
    if (response !== null) responses.push(response);
  }

  if (responses.length === 0) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(payload) ? responses : responses[0], {
    headers: { "mcp-protocol-version": PROTOCOL_VERSION },
  });
}
