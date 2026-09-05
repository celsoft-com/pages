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

function missingBindings(env: Env): string[] {
  const required: [string, unknown][] = [
    ["DB (D1 database)", env.DB],
    ["ASSETS (R2 bucket)", env.ASSETS],
    ["OAUTH_KV (KV namespace)", env.OAUTH_KV],
  ];
  return required.filter(([, value]) => !value).map(([name]) => name);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const missing = missingBindings(env);
    if (missing.length > 0) {
      return new Response(
        `This site is missing storage it needs:\n\n${missing
          .map((name) => `  - ${name}`)
          .join("\n")}\n\nRe-run the deploy and let Cloudflare create every resource it asks about.`,
        { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }

    try {
      return await provider.fetch(request, env, ctx);
    } catch (error) {
      const message = error instanceof Error ? `${error.message}\n\n${error.stack ?? ""}` : String(error);
      return new Response(`This site hit an error.\n\n${message}`, {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await ensureSchema(env);
    await refreshPendingDomains(env);
    await provider.purgeExpiredData(env);
  },
};
