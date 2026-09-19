import { privateHeaders } from "../cache";
import { isConflict } from "../errors";
import { originOf } from "../origin";
import { INSTRUCTIONS } from "../mcp/handler";
import { allows, toolsFor, TOOLS, type ToolContext } from "../mcp/tools";
import type { Principal } from "../auth/principal";

export const API_PREFIX = "/api/v1";

// The same registry MCP serves, presented as HTTP. There is no route table here: a call names a
// tool and passes the arguments object MCP would have passed, and the reply is the handler's result
// serialized. Anything else would be a second surface to keep in step with the first.
function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    // Never cached anywhere. What this returns varies by credential, and a read under a private
    // path is exactly the thing an edge cache would hand to the next caller.
    headers: { ...privateHeaders(), "content-type": "application/json; charset=utf-8" },
  });
}

function fail(status: number, message: string): Response {
  return json({ error: { message } }, status);
}

export function apiUnauthorized(): Response {
  return new Response(JSON.stringify({ error: { message: "Unknown or revoked token." } }), {
    status: 401,
    headers: {
      ...privateHeaders(),
      "content-type": "application/json; charset=utf-8",
      "www-authenticate": 'Bearer realm="pages"',
    },
  });
}

// A call to a read tool cannot have written anything, and a service polling one every minute must
// not keep clearing the edge cache for the whole site. Only a proven read opts out: an unknown name
// and every other path still purge, so forgetting to teach this about something is slow rather than
// wrong, which is the only direction this rule is safe to bend in.
export function apiCallWrites(path: string): boolean {
  if (!path.startsWith(`${API_PREFIX}/`)) return true;
  const tool = TOOLS.find((t) => t.name === path.slice(API_PREFIX.length + 1));
  return !tool || tool.access === "write";
}

export async function handleApi(request: Request, url: URL, principal: Principal): Promise<Response> {
  const rest = url.pathname.slice(API_PREFIX.length);
  const ctx: ToolContext = { siteUrl: originOf(url) };

  // Discovery. Describes only what this credential may call, so a read-only service never builds a
  // request it was never going to be allowed to make.
  if (rest === "" || rest === "/") {
    if (request.method !== "GET" && request.method !== "HEAD")
      return fail(405, "Use GET here, and POST to a tool.");
    return json({
      instructions: INSTRUCTIONS,
      access: principal.access,
      tools: toolsFor(principal.access).map((tool) => ({
        name: tool.name,
        title: tool.title,
        access: tool.access,
        description: tool.description,
        url: `${ctx.siteUrl}${API_PREFIX}/${tool.name}`,
        input_schema: tool.inputSchema,
      })),
    });
  }

  const name = rest.startsWith("/") ? rest.slice(1) : rest;
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return fail(404, `No tool named "${name}". GET ${API_PREFIX} for the ones you can call.`);
  // Stated rather than hidden: the caller holds a credential the owner minted, and telling them the
  // tool exists but their token cannot reach it is what lets them ask for a better one.
  if (!allows(principal.access, tool)) return fail(403, `This token is read-only, and ${name} writes.`);
  if (request.method !== "POST") return fail(405, `Use POST for ${name}.`);

  let args: Record<string, unknown>;
  try {
    const body = await request.text();
    args = body.trim() === "" ? {} : JSON.parse(body);
  } catch {
    return fail(400, "Body must be a JSON object of arguments.");
  }
  if (typeof args !== "object" || args === null || Array.isArray(args))
    return fail(400, "Body must be a JSON object of arguments.");

  try {
    return json(await tool.handler(args, ctx));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A conflict is the one failure a retry loop should handle differently, so it gets its own
    // status. Everything else is the caller asking for something impossible.
    return fail(isConflict(error) ? 409 : 400, message);
  }
}
