import { handleAdmin } from "./admin/router";
import { handleAsset } from "./assets/handler";
import { handleData } from "./data/handler";
import { isSetupComplete } from "./auth/setup";
import { handleMcp } from "./mcp/handler";
import { authenticate, metadata, protectedResourceMetadata, register, token } from "./oauth/server";
import { handlePage } from "./pages/handler";
import { welcomePage } from "./welcome";

function unauthorized(origin: string): Response {
  return Response.json(
    { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } },
    {
      status: 401,
      headers: {
        "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
      },
    },
  );
}

export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const path = url.pathname;

  try {
    if (path === "/.well-known/oauth-authorization-server") return metadata(origin);
    if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp")
      return protectedResourceMetadata(origin);
    if (path === "/oauth/register") return register(request);
    if (path === "/oauth/token") return token(request);

    if (path === "/mcp") {
      const ownerId = await authenticate(request);
      if (!ownerId) return unauthorized(origin);
      return handleMcp(request);
    }

    if (path.startsWith("/admin") || path === "/oauth/authorize") return handleAdmin(request, url);
    if (path.startsWith("/assets/")) return handleAsset(request);
    if (path.startsWith("/data/")) return handleData(request);

    if (path === "/robots.txt")
      return new Response("User-agent: *\nDisallow: /admin\nDisallow: /oauth\n", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });

    if (!(await isSetupComplete())) {
      if (path === "/") return welcomePage();
      return new Response(null, { status: 303, headers: { location: "/" } });
    }

    return handlePage(request);
  } catch (error) {
    const message = error instanceof Error ? `${error.message}\n\n${error.stack ?? ""}` : String(error);
    return new Response(`This site hit an error.\n\n${message}`, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
