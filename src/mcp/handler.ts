import { originOf, publicUrl } from "../origin";
import type { Access } from "../types";
import { allows, toolsFor, TOOLS, type ToolContext } from "./tools";

const PROTOCOL_VERSION = "2025-06-18";

export const INSTRUCTIONS = [
  "Publish and edit pages on this site. Markdown is rendered into the site theme; full HTML documents are served exactly as written.",
  "",
  "How this site works, because it is not what a static site does. One function serves every page, collection and asset straight out of storage. Nothing here is built, generated or compiled, and no file is written into a repository. A write lands in storage and the next request serves it, so a change is live at once and there is nothing to wait for and nothing to trigger.",
  "So: publishing never runs a build, never makes a deploy, never needs a commit, a push or a pull request, and never touches the site's source code. If you are reaching for git, a CI job or a deploy command to get content onto this site, you have the wrong tool: use these tools and it is already done. The site's own code deploys that way, but its content never does.",
  "The one delay is caching. A public response is cleared from the CDN as the write finishes, so a reader sees the change straight away. The cache also expires on its own within five minutes, which only matters if a purge is ever missed.",
  "To change part of a page, read only that part with get_page, passing find or offset and limit, and change it with edit_page, which replaces an exact snippet and refuses one that matches more than once. Rewriting a whole page with update_page to change one line sends the document twice, once in and once back out, and that is what edit_page is for.",
  "",
  "Repeating content belongs in a data collection rather than hard-coded into a page: products, posts, events, team members, menu items, FAQs, anything the owner will add to or edit later.",
  "Write a collection one item at a time with put_item, change one field with put_item, drop one with delete_item, change the order with reorder_items, and find items with search_items.",
  "When records in one collection carry a value that must match an id in another, such as a category, section, status or owner, declare it with set_collection_refs as soon as you create the collection. A typo in such a field is silent on every axis: the write succeeds, the JSON is valid, the page renders, and the record just stops appearing wherever that value selects it. Declaring the reference turns that into a rejected write with the closest id suggested. For records written before the constraint, check_refs finds the damage.",
  "To answer what a collection is missing rather than what it holds, use count_items, not list_items. Absence is not searchable: gaps only appear once records are grouped and counted, and on a few hundred records counting returns a small table where listing returns tens of kilobytes of prose you will not use. Count before proposing additions, so suggestions land on the actual holes.",
  "When a collection is partitioned by a field such as section, city or day, pass that field to match_names as a filter so a candidate is only compared inside its own partition. The same name recurs legitimately once per partition, and comparing across them reports those as duplicates.",
  "Before adding items to a collection that already holds some, call match_names with the candidate names first. Sources write the same entity differently and exact comparison misses that, so this is what stops the same thing being added twice. Judge the matches it returns rather than trusting them: update the item it found, or create a new one when the match is genuinely a different thing.",
  "",
  "Everything here is organized by path, exactly like folders. A path is a bundle and holds everything at or under it: /trip holds /trip/items, /trip/images/coburg.jpg and /trip/day1/items alike, and /trip/day1 holds that last one too. Give a new collection or asset a path under the page that uses it and it files itself; list_bundle then returns everything one page is made of.",
  "Pages, collections and assets are all just resources at paths. None owns or belongs to another. There is no owner, no owning page, and nothing is ever unfiled or ungrouped, because a resource's own path already says which bundles hold it. Publishing a page at /trip does not change anything already under /trip, and deleting it does not either.",
  "Matching is on whole path segments, so /bavaria does not hold /bavaria-lessons/lessons. One exception to the rule: / is not a bundle, since it would hold the entire site, so list_bundle and delete_bundle refuse it. A resource may still sit at /.",
  "What a browser gets at / is the site contents: a list of every public page, generated on every request. It is not a page, so there is nothing to publish, edit or delete there, and it needs no maintaining. Publish a page anywhere else and it appears in the list; make one private and it drops out of the list along with everything else it closes.",
  "This is organization only, never a boundary. Nothing is rejected, moved or blocked by it, any page may fetch any collection, and set_collection_refs may point across bundles.",
  "Copy, move and delete work the same way at every level: copy_page, move_page and delete_page, then the same three for _collection, _asset and _bundle. They take from and to, or path for a delete, and return one common reply. They run on the server, so reorganizing never means reading records out and writing them back. That round trip is slow, and it loses a value to a mistyped character sooner or later.",
  "Pick the level by what should travel. move_collection renames one collection and leaves the page that fetches it where it is. move_page renames one page and leaves the rest of its bundle alone. move_bundle takes a path and everything under it together, which is what renaming a whole section usually means.",
  "A bundle verb is the only one that touches more than one thing, so it does nothing until you pass confirm: true. Call it once to read the inventory, then again to apply. delete_page still removes exactly one page and names the rest of the bundle.",
  "No copy, move or delete ever edits page content. A page hardcodes the URLs it fetches, so after a move the reply lists every page line still naming a path that has gone, and fixing those lines is your job. When a page cannot be broken even briefly, copy instead, repoint the page, check it renders, then delete the source.",
  "",
  "How a collection is served:",
  "- Address: prefix the collection path with /data and add .json. The collection /products is served at /data/products.json; /shop/items at /data/shop/items.json.",
  "- Paths are lowercased and a .json you pass in is ignored, so /Products, products and /products.json all mean the collection /products. Use the url echoed back by put_item, list_items, list_collections and search_items rather than assembling it yourself.",
  "- Body: a bare JSON array of the items. There is no wrapper object. Tool replies wrap items in an envelope with a total and a url, but the served url does not, so render the array directly.",
  "- Every served item includes its id alongside the fields you wrote.",
  "- Order is guaranteed: the array comes back in the collection order set by reorder_items and by put_item's index, so a page can render it as it arrives and needs no sort field.",
  "- Nested objects and arrays of objects are stored and served unchanged. Merging is shallow though: a nested value you pass to put_item replaces the stored one outright, so send the whole nested value rather than a piece of it.",
  "- GET /data/_collections.json for the index of every collection: an array of {path, url, count, rev, updatedAt} sorted by path. That is how a page discovers what exists over plain HTTP, with no access to these tools. /_collections is reserved and cannot be used as a collection path.",
  "- Every item also has a rev, a number kept outside the stored JSON so it never appears in what the url serves. get_item, list_items and search_items give you the rev; pass it back as if_rev when you write. Updating an existing item requires it, so a write from a stale read is refused rather than overwriting a newer one. Re-read and reapply your change when that happens.",
  "- It is unauthenticated, and cached at the CDN until a write clears it, which a write does as it finishes. A collection under a private path is served only to a browser holding a share link, and is left out of /data/_collections.json entirely. A collection anywhere else is public to anyone who guesses its path, so put nothing private in one.",
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
  "",
  "A path can be closed to the public. set_privacy makes a path private and it covers everything at or under it, the same folder rule as a bundle: the pages, the collections served under /data, and the assets. To anyone without a link every one of those answers exactly as if nothing were published there, so a private path never reveals that it exists, and nothing private is ever cached where the next visitor could be handed it.",
  "share_path returns the link that opens it. The secret rides in the URL fragment, after the #, which browsers never send to a server: it reaches no access log, no proxy log and no Referer header, and a chat or mail app previewing the link cannot open it. Pass the link on exactly as returned, because a link with the fragment trimmed opens nothing, and it is shown once since only its hash is stored.",
  "Mint one link per recipient and label it with who it is for, so revoke_share can kill one person's access and leave everybody else working. Revoking takes effect on that holder's next request. Say plainly what this is: anyone holding the link is in, so it is only as private as the channel the owner sends it through, and it needs a browser with JavaScript on. It is right for a draft, a family album or a client preview; it is not a login, and it is not the place for anything whose exposure would actually hurt.",
  "Before publishing a page whose content repeats, offer the owner the choice and say which you recommend: content baked into the page, or a collection the page renders. Baking it in is fine for a one-off; a collection is right for anything that will change.",
  "",
  "A map is a page, and the data behind it is ordinary site data. Put the stops in a collection, one item per stop with numeric lat and lon fields, so the owner can edit them afterwards. Put the route geometry in an asset by calling route, which writes the GeoJSON itself and hands back a summary rather than the line.",
  "Route and geocode while you are building the page, never when a visitor opens it. A route between fixed stops cannot change, so recomputing it per visit spends someone else's service to get the same answer, and it puts a third party in front of every reader.",
  "geocode returns candidates and you choose between them; it does not choose for you. Ask for the specific place rather than the town when it matters, since a town is an area and a station is a point. Store what you pick as separate lat and lon numbers, never a two-element array: GeoJSON writes them [lon, lat] and most map libraries take [lat, lon], so a transposed pair is valid, renders, and is wrong.",
  "The page then fetches /data/<path>.json for the stops and the asset url for the line, and draws both with a map library loaded from a CDN. Leaflet is small and takes raster tiles; MapLibre GL is bigger, takes vector tiles and can be restyled in the browser. The stored line is plain GeoJSON and is tied to neither, so that choice belongs to the page and can be changed later without touching the data.",
  "Cycling and walking routes carry elevation as a third number in each coordinate and report ascent in the reply, which is usually what a bike page wants to show.",
  "Put the attribution string from the reply on any page built from this data. It is a licence condition, not a courtesy. Nothing about appearance belongs in the stored GeoJSON: colour and width are the page's business, and a stored line outlives every design it is drawn in.",
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

async function dispatch(message: JsonRpcRequest, ctx: ToolContext, access: Access): Promise<unknown | null> {
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
        tools: toolsFor(access).map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });

    case "tools/call": {
      const name = message.params?.name;
      const tool = TOOLS.find((t) => t.name === name);
      // A hidden tool is refused the same way an absent one is, so a read-only credential is told
      // nothing about what a read-write one could have called.
      if (!tool || !allows(access, tool)) return failure(message.id, -32602, `Unknown tool: ${name}`);
      try {
        const text = tool.render(await tool.handler(message.params?.arguments ?? {}, ctx));
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

export async function handleMcp(request: Request, access: Access): Promise<Response> {
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

  const url = publicUrl(request);
  const ctx: ToolContext = { siteUrl: originOf(url) };

  const messages = Array.isArray(payload) ? payload : [payload];
  const responses: unknown[] = [];
  for (const message of messages) {
    const response = await dispatch(message, ctx, access);
    if (response !== null) responses.push(response);
  }

  if (responses.length === 0) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(payload) ? responses : responses[0], {
    headers: { "mcp-protocol-version": PROTOCOL_VERSION },
  });
}
