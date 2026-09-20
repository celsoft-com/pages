import { handleAdmin } from "./admin/router";
import { API_PREFIX, apiCallWrites, apiUnauthorized, handleApi } from "./api/handler";
import { admit } from "./auth/principal";
import { handleAsset } from "./assets/handler";
import { changedContent, purgeContent } from "./cache";
import { handleData } from "./data/handler";
import { DOCS_PREFIX, handleDocs } from "./docs/handler";
import { handleFavicon } from "./favicon";
import { isSetupComplete } from "./auth/setup";
import { handleMcp } from "./mcp/handler";
import { metadata, protectedResourceMetadata, register, token } from "./oauth/server";
import { handlePage } from "./pages/handler";
import { originOf, publicUrl } from "./origin";
import { handleUnlock } from "./private/unlock";
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

// Says nothing about whether any credential was close. Retry-After is the whole of the answer.
function tooManyAttempts(): Response {
  return Response.json(
    { error: { message: "Too many failed attempts. Try again later." } },
    { status: 429, headers: { "retry-after": "900", "cache-control": "private, no-store" } },
  );
}

export async function handle(request: Request): Promise<Response> {
  const url = publicUrl(request);
  const path = url.pathname;

  try {
    const response = await route(request, url);
    // The only place anything is purged: a request that could have changed content clears the
    // cache as it finishes, whichever code did the writing.
    if (changedContent(request, path, response) && apiCallWrites(path)) await purgeContent();
    return response;
  } catch (error) {
    const message = error instanceof Error ? `${error.message}\n\n${error.stack ?? ""}` : String(error);
    return new Response(`This site hit an error.\n\n${message}`, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

async function route(request: Request, url: URL): Promise<Response> {
  const origin = originOf(url);
  const path = url.pathname;

  if (path === "/.well-known/oauth-authorization-server") return metadata(origin);
  if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp")
    return protectedResourceMetadata(origin);
  if (path === "/oauth/register") return register(request);
  if (path === "/oauth/token") return token(request);

  if (path === "/mcp") {
    const seen = await admit(request);
    if (!seen.ok) return seen.limited ? tooManyAttempts() : unauthorized(origin);
    return handleMcp(request, seen.principal.access);
  }

  // Same registry, same credentials, presented as HTTP for a service with no browser to run an
  // OAuth flow in.
  if (path === API_PREFIX || path.startsWith(`${API_PREFIX}/`)) {
    const seen = await admit(request);
    if (!seen.ok) return seen.limited ? tooManyAttempts() : apiUnauthorized();
    return handleApi(request, url, seen.principal);
  }

  // Redeems a share link. The token arrives in the body, never in the URL.
  if (path === "/_unlock") return handleUnlock(request);

  // Segment boundary, not a string prefix: a page may be published at /admin-notes.
  if (path === "/admin" || path.startsWith("/admin/") || path === "/oauth/authorize")
    return handleAdmin(request, url);
  // This software's own reference, drawn from the registry serving /mcp and /api/v1, so it describes
  // the deploy it is served from. Before the setup check, because a site with no owner yet is
  // exactly where someone reads the documentation. It reserves the prefix: a page published at
  // /docs is not reachable, which is the cost of the site documenting itself.
  if (path === DOCS_PREFIX || path.startsWith(`${DOCS_PREFIX}/`)) return handleDocs(request, url, origin);

  if (path.startsWith("/assets/")) return handleAsset(request);
  if (path.startsWith("/data/")) return handleData(request);

  if (path === "/favicon.ico") return handleFavicon();

  if (path === "/robots.txt")
    return new Response("User-agent: *\nDisallow: /admin\nDisallow: /oauth\n", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });

  if (!(await isSetupComplete())) {
    if (path === "/") return welcomePage();
    return new Response(null, { status: 303, headers: { location: "/" } });
  }

  return handlePage(request);
}
