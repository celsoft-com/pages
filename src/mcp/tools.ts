import { deleteAsset, listAssets, putAsset } from "../assets/service";
import { listDomains } from "../domains/service";
import { deletePage, deriveTitle, getPage, listPages, savePage } from "../pages/service";
import { isValidPath, normalizePath } from "../pages/path";
import { getSettings, SETTING, setSetting } from "../settings";
import type { Env } from "../types";

export interface ToolContext {
  env: Env;
  ownerId: string;
  siteUrl: string;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, any>, ctx: ToolContext) => Promise<string>;
}

function object(properties: Record<string, unknown>, required: string[] = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

function requirePath(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") throw new Error("path is required");
  const path = normalizePath(raw);
  if (!isValidPath(path)) {
    throw new Error(
      `path "${raw}" is not usable. Use lowercase letters, numbers, dashes and slashes, for example /about or /notes/first-post`,
    );
  }
  return path;
}

function detectFormat(content: string, declared?: string): "markdown" | "html" {
  if (declared === "markdown" || declared === "html") return declared;
  return /^\s*(<!doctype html|<html[\s>])/i.test(content) ? "html" : "markdown";
}

export const TOOLS: ToolDefinition[] = [
  {
    name: "list_pages",
    title: "List pages",
    description: "List every page published on this site, with its path, title and size.",
    inputSchema: object({}),
    handler: async (_args, ctx) => {
      const pages = await listPages(ctx.env);
      if (pages.length === 0) return "No pages published yet.";
      return pages
        .map((p) => `${p.path}  ${p.title}  (${p.content_type})  ${ctx.siteUrl}${p.path === "/" ? "" : p.path}`)
        .join("\n");
    },
  },
  {
    name: "get_page",
    title: "Read a page",
    description: "Return the stored source of one page so it can be edited.",
    inputSchema: object({ path: { type: "string", description: "Page path, for example /about" } }, ["path"]),
    handler: async (args, ctx) => {
      const path = requirePath(args.path);
      const page = await getPage(ctx.env, path);
      if (!page) throw new Error(`No page exists at ${path}`);
      return JSON.stringify(
        { path: page.path, title: page.title, format: page.content_type, content: page.body },
        null,
        2,
      );
    },
  },
  {
    name: "publish_page",
    title: "Publish a page",
    description:
      "Create a page at a path. Markdown is rendered into the site theme; HTML is served exactly as written. Fails if the path is taken unless overwrite is true.",
    inputSchema: object(
      {
        path: { type: "string", description: "Page path, for example /about or / for the home page" },
        content: { type: "string", description: "Markdown or full HTML document" },
        format: { type: "string", enum: ["markdown", "html"], description: "Defaults to auto-detect" },
        title: { type: "string", description: "Defaults to the first heading" },
        overwrite: { type: "boolean", description: "Replace an existing page at this path" },
      },
      ["path", "content"],
    ),
    handler: async (args, ctx) => {
      const path = requirePath(args.path);
      if (typeof args.content !== "string" || args.content.length === 0)
        throw new Error("content is required");

      const existing = await getPage(ctx.env, path);
      if (existing && args.overwrite !== true)
        throw new Error(`A page already exists at ${path}. Pass overwrite: true to replace it.`);

      const contentType = detectFormat(args.content, args.format);
      const page = await savePage(ctx.env, {
        path,
        ownerId: ctx.ownerId,
        contentType,
        title: typeof args.title === "string" && args.title ? args.title : deriveTitle(args.content, path),
        body: args.content,
      });
      return `Published ${page.title} at ${ctx.siteUrl}${page.path === "/" ? "" : page.path}`;
    },
  },
  {
    name: "update_page",
    title: "Update a page",
    description: "Replace the content of an existing page.",
    inputSchema: object(
      {
        path: { type: "string" },
        content: { type: "string" },
        title: { type: "string" },
      },
      ["path", "content"],
    ),
    handler: async (args, ctx) => {
      const path = requirePath(args.path);
      const existing = await getPage(ctx.env, path);
      if (!existing) throw new Error(`No page exists at ${path}. Use publish_page to create it.`);
      if (typeof args.content !== "string" || args.content.length === 0)
        throw new Error("content is required");

      const page = await savePage(ctx.env, {
        path,
        ownerId: ctx.ownerId,
        contentType: detectFormat(args.content, existing.content_type),
        title: typeof args.title === "string" && args.title ? args.title : existing.title,
        body: args.content,
      });
      return `Updated ${ctx.siteUrl}${page.path === "/" ? "" : page.path}`;
    },
  },
  {
    name: "delete_page",
    title: "Delete a page",
    description: "Remove a page permanently.",
    inputSchema: object({ path: { type: "string" } }, ["path"]),
    handler: async (args, ctx) => {
      const path = requirePath(args.path);
      const removed = await deletePage(ctx.env, path);
      if (!removed) throw new Error(`No page exists at ${path}`);
      return `Deleted ${path}`;
    },
  },
  {
    name: "upload_asset",
    title: "Upload an asset",
    description:
      "Store an image or file and return its public URL, which can then be referenced from any page.",
    inputSchema: object(
      {
        filename: { type: "string" },
        content_base64: { type: "string", description: "File contents, base64 encoded" },
        content_type: { type: "string", description: "MIME type, for example image/png" },
      },
      ["filename", "content_base64", "content_type"],
    ),
    handler: async (args, ctx) => {
      if (typeof args.content_base64 !== "string") throw new Error("content_base64 is required");
      const binary = atob(args.content_base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const asset = await putAsset(ctx.env, {
        ownerId: ctx.ownerId,
        filename: String(args.filename),
        contentType: String(args.content_type),
        bytes: bytes.buffer,
      });
      return `${ctx.siteUrl}/assets/${asset.key}`;
    },
  },
  {
    name: "list_assets",
    title: "List assets",
    description: "List uploaded images and files with their public URLs.",
    inputSchema: object({}),
    handler: async (_args, ctx) => {
      const assets = await listAssets(ctx.env);
      if (assets.length === 0) return "No assets uploaded yet.";
      return assets.map((a) => `${a.filename}  ${ctx.siteUrl}/assets/${a.key}  (${a.size} bytes)`).join("\n");
    },
  },
  {
    name: "delete_asset",
    title: "Delete an asset",
    description: "Remove an uploaded file by its key.",
    inputSchema: object({ key: { type: "string" } }, ["key"]),
    handler: async (args, ctx) => {
      const removed = await deleteAsset(ctx.env, String(args.key));
      if (!removed) throw new Error(`No asset with key ${args.key}`);
      return `Deleted asset ${args.key}`;
    },
  },
  {
    name: "get_site",
    title: "Get site info",
    description: "Return the site title, description, live URLs and custom domain status.",
    inputSchema: object({}),
    handler: async (_args, ctx) => {
      const [settings, domains, pages] = await Promise.all([
        getSettings(ctx.env),
        listDomains(ctx.env),
        listPages(ctx.env),
      ]);
      return JSON.stringify(
        {
          title: settings[SETTING.siteTitle] ?? "Pages",
          description: settings[SETTING.siteDescription] ?? null,
          url: ctx.siteUrl,
          pages: pages.length,
          domains: domains.map((d) => ({ hostname: d.hostname, status: d.status })),
        },
        null,
        2,
      );
    },
  },
  {
    name: "set_site_info",
    title: "Set site title and description",
    description: "Update the site title and description shown in the header of every themed page.",
    inputSchema: object({ title: { type: "string" }, description: { type: "string" } }),
    handler: async (args, ctx) => {
      if (typeof args.title === "string") await setSetting(ctx.env, SETTING.siteTitle, args.title);
      if (typeof args.description === "string")
        await setSetting(ctx.env, SETTING.siteDescription, args.description);
      return "Site info updated.";
    },
  },
];
