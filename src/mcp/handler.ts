import { TOOLS, type ToolContext } from "./tools";

const PROTOCOL_VERSION = "2025-06-18";

export const INSTRUCTIONS = [
  "Publish and edit pages on this site. Markdown is rendered into the site theme; full HTML documents are served exactly as written.",
  "",
  "Repeating content belongs in a data collection rather than hard-coded into a page: products, posts, events, team members, menu items, FAQs, anything the owner will add to or edit later.",
  "Write a collection one item at a time with put_item, change one field with put_item, drop one with delete_item, change the order with reorder_items, and find items with search_items.",
  "When records in one collection carry a value that must match an id in another, such as a category, section, status or owner, declare it with set_collection_refs as soon as you create the collection. A typo in such a field is silent on every axis: the write succeeds, the JSON is valid, the page renders, and the record just stops appearing wherever that value selects it. Declaring the reference turns that into a rejected write with the closest id suggested. For records written before the constraint, check_refs finds the damage.",
  "To answer what a collection is missing rather than what it holds, use count_items, not list_items. Absence is not searchable: gaps only appear once records are grouped and counted, and on a few hundred records counting returns a small table where listing returns tens of kilobytes of prose you will not use. Count before proposing additions, so suggestions land on the actual holes.",
  "When a collection is partitioned by a field such as section, city or day, pass that field to match_names as a filter so a candidate is only compared inside its own partition. The same name recurs legitimately once per partition, and comparing across them reports those as duplicates.",
  "Before adding items to a collection that already holds some, call match_names with the candidate names first. Sources write the same entity differently and exact comparison misses that, so this is what stops the same thing being added twice. Judge the matches it returns rather than trusting them: update the item it found, or create a new one when the match is genuinely a different thing.",
  "",
  "Pages, collections and assets group by path. A bundle is a path plus everything at or under it, so the page /germanfunstuff owns the collection /germanfunstuff/items and the asset /germanfunstuff/images/coburg.jpg. Give a new collection or asset a path under the page that uses it and it groups itself; list_bundle then returns everything one page is made of, and list_ungrouped shows what is under no page at all. Matching is on whole path segments, so a page at /bavaria does not own /bavaria-lessons/lessons, and a page at / owns nothing.",
  "Grouping is organizational and never a boundary. Nothing is rejected, moved or blocked because of it, a page may fetch any collection on the site regardless of bundle, and set_collection_refs may point across bundles. Ungrouped is a description, not a problem to fix unless the owner asks.",
  "delete_page removes one page and leaves everything under it alone. delete_bundle is the one tool that removes more than one thing: call it without confirm first, read the inventory it returns, and only then confirm.",
  "",
  "How a collection is served:",
  "- Address: prefix the collection path with /data and add .json. The collection /products is served at /data/products.json; /shop/items at /data/shop/items.json.",
  "- Paths are lowercased and a .json you pass in is ignored, so /Products, products and /products.json all mean the collection /products. Use the url echoed back by put_item, list_items, list_collections and search_items rather than assembling it yourself.",
  "- Body: a bare JSON array of the items. There is no wrapper object. Tool replies wrap items in an envelope with a total and a url, but the served url does not, so render the array directly.",
  "- Every served item includes its id alongside the fields you wrote.",
  "- Order is guaranteed: the array comes back in the collection order set by reorder_items and by put_item's index, so a page can render it as it arrives and needs no sort field.",
  "- Nested objects and arrays of objects are stored and served unchanged. Merging is shallow though: a nested value you pass to put_item replaces the stored one outright, so send the whole nested value rather than a piece of it.",
  "- GET /data/_collections.json for the index of every collection: an array of {path, url, count, rev, owner, updatedAt} sorted by path. That is how a page discovers what exists over plain HTTP, with no access to these tools. /_collections is reserved and cannot be used as a collection path.",
  "- Every item also has a rev, a number kept outside the stored JSON so it never appears in what the url serves. get_item, list_items and search_items give you the rev; pass it back as if_rev when you write. Updating an existing item requires it, so a write from a stale read is refused rather than overwriting a newer one. Re-read and reapply your change when that happens.",
  "- It is public, unauthenticated and cached for 60 seconds. Never put anything private in a collection, and expect an edit to take up to a minute to appear on a page.",
  "",
  "So a page that renders /products looks like this:",
  "  <ul id=\"products\"></ul>",
  "  <script>",
  "    fetch('/data/products.json')",
  "      .then(function (r) { return r.json(); })",
  "      .then(function (items) {",
  "        document.getElementById('products').innerHTML =",
  "          items.map(function (item) { return '<li>' + item.title + '</li>'; }).join('');",
  "      });",
  "  </script>",
  "",
  "Publish that page once, then keep editing items. The page never needs rewriting.",
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
