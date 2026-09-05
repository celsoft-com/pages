import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { handleAdmin } from "./admin/router";
import { handleAsset } from "./assets/handler";
import { isSetupComplete } from "./auth/setup";
import { refreshPendingDomains } from "./domains/service";
import { handleMcp } from "./mcp/handler";
import { handlePage } from "./pages/handler";
import { ensureSchema } from "./schema";
import type { Env } from "./types";

const siteHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    await ensureSchema(env);
    const url = new URL(request.url);

    if (url.pathname.startsWith("/admin") || url.pathname === "/oauth/authorize") {
      return handleAdmin(request, env, url);
    }

    if (url.pathname.startsWith("/assets/")) {
      return handleAsset(request, env);
    }

    if (!(await isSetupComplete(env))) {
      return new Response(null, { status: 303, headers: { location: "/admin/setup" } });
    }

    return handlePage(request, env);
  },
};

const mcpHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const props = (ctx as unknown as { props?: { ownerId?: string } }).props;
    if (!props?.ownerId) {
      return Response.json(
        { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } },
        { status: 401 },
      );
    }
    return handleMcp(request, env, props.ownerId);
  },
};

const provider = new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler: mcpHandler,
  defaultHandler: siteHandler,
  authorizeEndpoint: "/oauth/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  scopesSupported: ["pages:write"],
});

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return provider.fetch(request, env, ctx);
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await ensureSchema(env);
    await refreshPendingDomains(env);
    await provider.purgeExpiredData(env);
  },
};
