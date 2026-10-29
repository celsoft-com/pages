import { endpoint, EndpointError, type Endpoint } from "@celsoft/platform";
import { user } from "@celsoft/platform/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { isConflict } from "./errors";
import { TOOLS, type AnyTool } from "./mcp/tools";
import { platformBackend, withBackend } from "./store";

// The site's top control point: Everyone reads it and the owner manages it. Every path's point
// will hang below it.
export const SITE_POINT = "site";

export const API_PREFIX = "/api/v1";

type JsonSchema = { type?: string | string[]; properties?: Record<string, JsonSchema> };

// A read-only API token may only GET, so a read tool is a GET wherever its arguments fit in a
// query string, which is every argument that is not an object or an array.
function fitsQuery(schema: Record<string, unknown>): boolean {
  const properties = (schema as JsonSchema).properties ?? {};
  return Object.values(properties).every((property) => {
    const types = [property.type ?? "object"].flat();
    return types.every((type) => type !== "object" && type !== "array");
  });
}

export function methodFor(tool: AnyTool): "GET" | "POST" {
  return tool.access === "read" && fitsQuery(tool.inputSchema) ? "GET" : "POST";
}

// Errors keep the statuses the REST API always had: a revision conflict is 409 so a service can
// tell a stale if_rev from anything else, and every other refusal from a tool is a 400.
function failure(error: unknown): unknown {
  if (error instanceof EndpointError || error instanceof Response) return error;
  if (isConflict(error)) return new EndpointError(409, (error as Error).message);
  if (error instanceof Error) return new EndpointError(400, error.message);
  return error;
}

function toolEndpoint(tool: AnyTool) {
  return endpoint(
    {
      serve: ["api", "mcp"],
      method: methodFor(tool),
      path: `${API_PREFIX}/${tool.name}`,
      description: tool.description,
      input: z.fromJSONSchema(tool.inputSchema as z.core.JSONSchema.JSONSchema) as z.ZodObject,
      output: z.fromJSONSchema(tool.outputSchema as z.core.JSONSchema.JSONSchema),
      access: { point: () => SITE_POINT, level: tool.access },
    },
    (input, app: AppLike) =>
      withBackend(platformBackend(app), async () => {
        try {
          return await tool.handler(input as Record<string, unknown>, { siteUrl: app.env.APP_URL ?? "" });
        } catch (error) {
          throw failure(error);
        }
      }),
  );
}

type AppLike = Parameters<typeof platformBackend>[0] & {
  env: { APP_URL?: string };
  access: { create(point: string, options: object): Promise<void>; asApp(): { point(id: string): Promise<unknown> } };
  requireUser(): Promise<{ id: string }>;
};

// Points are made at run time, so the site's own point waits for its owner: the first call makes it,
// granting Everyone read, and the owner who made it manages it. Any later call finds it there.
const claimSite = endpoint(
  {
    serve: ["api", "mcp"],
    method: "POST",
    path: `${API_PREFIX}/claim_site`,
    description: "Set up a new site's access once, as its owner, so pages can be published and read.",
    input: z.object({}),
    output: z.object({ claimed: z.boolean().describe("This call set the site up; false when it already was") }),
    access: "user",
  },
  async (_input, app: AppLike & { db: Parameters<typeof platformBackend>[0]["db"] }) => {
    const existing = await app.access
      .asApp()
      .point(SITE_POINT)
      .catch(() => null);
    if (existing) return { claimed: false };
    const me = await app.requireUser();
    const [row] = await app.db.select({ role: user.role }).from(user).where(eq(user.id, me.id));
    if (row?.role !== "owner") throw new EndpointError(403, "Only the site's owner can set it up.");
    await app.access.create(SITE_POINT, { grants: [{ to: { everyone: true }, level: "read" }] });
    return { claimed: true };
  },
);

export const endpoints: Record<string, Endpoint<any, any, any>> = {
  claim_site: claimSite,
  ...Object.fromEntries(TOOLS.map((tool) => [tool.name, toolEndpoint(tool)])),
};
