import { EndpointError, endpoint } from "@celsoft/platform";
import { z } from "zod";
import { checkLinks } from "../pages/links";
import {
  deriveTitle,
  discardDraft,
  editPage,
  getPage,
  listPages,
  mergeMeta,
  noPageAt,
  previewOf,
  publishDraft,
  saveDraft,
  savePage,
  slicePage,
  validateMeta,
  workingCopy,
} from "../pages/service";
import type { PagesApp } from "../pages-app";
import { atPath, BUNDLES, requirePath, site, urlFor } from "./shared";

const PATH = z.string().describe("Page path, for example /about");
const FORMAT = z.enum(["markdown", "html"]);
const PAGE_META = z
  .record(z.string(), z.string())
  .describe("Facts about the page beside its body, all strings. Empty when none are set.");

const PAGE = {
  path: z.string(),
  url: z.string().describe("Where a browser reads it"),
  title: z.string(),
  format: FORMAT.describe("markdown or html"),
  meta: PAGE_META,
};

function detectFormat(content: string, declared?: string): "markdown" | "html" {
  if (declared === "markdown" || declared === "html") return declared;
  return /^\s*(<!doctype html|<html[\s>])/i.test(content) ? "html" : "markdown";
}

// The working copy is served under /preview, gated to whoever may write the page.
function previewUrlFor(app: PagesApp, path: string): string {
  return `${app.env.APP_URL}/preview${path}`;
}

export const pageEndpoints = {
  list_pages: endpoint(
    {
      serve: ["api", "mcp"],
      method: "GET",
      path: "/api/v1/list_pages",
      description: "List every page published on this site. " + BUNDLES,
      access: { point: site, level: "read" },
      input: z.object({}),
      output: z.object({
        pages: z.array(
          z.object({
            path: z.string(),
            title: z.string(),
            format: FORMAT.describe("markdown or html"),
            meta: PAGE_META,
            has_draft: z.boolean().describe("An unpublished working copy exists. Readers still see the live page."),
            url: z.string().describe("Where a browser reads it"),
          }),
        ),
      }),
    },
    async (_input, app) => ({
      pages: (await listPages(app)).map((p) => ({
        path: p.path,
        title: p.title,
        format: p.contentType,
        meta: p.meta,
        has_draft: p.hasDraft,
        url: urlFor(app, p.path),
      })),
    }),
  ),

  get_page: endpoint(
    {
      serve: ["api", "mcp"],
      method: "GET",
      path: "/api/v1/get_page",
      description:
        "Return the stored source of one page so it can be edited. Pass find, or offset and limit, to read only the " +
        "part you are working on: the reply is then numbered lines rather than the whole document, which is what " +
        "edit_page wants and costs a fraction of reading a long page to change one line of it. " +
        "Pass draft true to read the working copy instead of the live page. " +
        BUNDLES,
      access: { point: atPath(), level: "read" },
      input: z.object({
        path: PATH,
        draft: z
          .boolean()
          .optional()
          .describe("Read the unpublished working copy rather than what readers see. Refused when there is none."),
        find: z.string().optional().describe("Return only lines containing this text, ignoring case"),
        offset: z.number().optional().describe("First line to return, 1 based. Ignored when find is given."),
        limit: z.number().optional().describe("Maximum lines to return. Defaults to 200, which is also the cap."),
      }),
      output: z.union([
        z
          .object({
            path: z.string(),
            title: z.string(),
            format: FORMAT.describe("markdown or html"),
            meta: PAGE_META,
            has_draft: z.boolean().describe("An unpublished working copy exists"),
            content: z.string().describe("The stored source, byte for byte"),
          })
          .describe("The whole page, when nothing narrowed the read"),
        z
          .object({
            path: z.string(),
            title: z.string(),
            format: FORMAT.describe("markdown or html"),
            meta: PAGE_META,
            has_draft: z.boolean().describe("An unpublished working copy exists"),
            total: z.number().describe("Lines in the whole page"),
            more: z.number().describe("Matching lines beyond the ones returned"),
            lines: z.array(z.object({ line: z.number().describe("1 based"), text: z.string() })),
          })
          .describe("Numbered lines, when find, offset or limit was passed"),
      ]),
    },
    async ({ path: raw, draft, find, offset, limit }, app) => {
      const path = requirePath(raw);
      const stored = await getPage(app, path);
      if (!stored) throw new EndpointError(400, noPageAt(path));
      if (draft && !stored.draft)
        throw new EndpointError(400, `${path} has no working copy. Read it without draft to get the live page.`);
      const page = draft ? previewOf(stored) : stored;
      const head = {
        path: page.path,
        title: page.title,
        format: page.contentType,
        meta: page.meta,
        has_draft: stored.draft !== null,
      };
      if (find === undefined && offset === undefined && limit === undefined) return { ...head, content: page.body };
      const slice = slicePage(page, { find, offset, limit });
      return { ...head, total: slice.total, more: slice.more, lines: slice.lines };
    },
  ),

  edit_page: endpoint(
    {
      serve: ["api", "mcp"],
      method: "POST",
      path: "/api/v1/edit_page",
      description:
        "Replace an exact string in a published page and leave every other byte of it alone. Read the part you are " +
        "changing with get_page first, passing find or offset and limit, and copy the snippet from what it returns. " +
        "The edit is refused if the snippet matches nothing, and refused with a count if it matches more than once, " +
        "so pass enough surrounding text to name one spot, or all true to change every occurrence. " +
        "Pass draft true to edit the working copy instead, starting one from the live page if there is none, so a " +
        "published page can be revised without readers seeing the change until publish_draft. " +
        "If you are editing the page to change items in a list, move that list into a data collection instead and " +
        "let the page fetch it. " +
        BUNDLES,
      access: { point: atPath(), level: "write" },
      input: z.object({
        path: PATH,
        find: z.string().describe("Exact text to replace, copied from get_page"),
        replace: z.string().describe("Text to put in its place. Empty string deletes the match."),
        all: z.boolean().optional().describe("Replace every occurrence instead of refusing an ambiguous match"),
        draft: z
          .boolean()
          .optional()
          .describe("Edit the working copy, which readers do not see, instead of the live page"),
      }),
      output: z.object({
        path: z.string(),
        url: z.string(),
        replaced: z.number().describe("Occurrences replaced"),
        lines: z.array(z.number()).describe("Line numbers that changed"),
        preview_url: z
          .string()
          .optional()
          .describe(
            "Where the working copy is rendered, for anyone who may write the page. Present only for a draft edit.",
          ),
      }),
    },
    async ({ path: raw, find, replace, all, draft }, app) => {
      const { page, replaced, lines } = await editPage(app, {
        path: requirePath(raw),
        find,
        replace,
        all: all === true,
        draft: draft === true,
      });
      return {
        path: page.path,
        url: urlFor(app, page.path),
        replaced,
        lines,
        ...(draft ? { preview_url: previewUrlFor(app, page.path) } : {}),
      };
    },
  ),

  publish_page: endpoint(
    {
      serve: ["api", "mcp"],
      method: "POST",
      path: "/api/v1/publish_page",
      description:
        "Create a page at a path. Markdown is rendered into the site theme; HTML is served exactly as written. Fails if the path is taken unless overwrite is true. " +
        "If the page lists repeating things, offer the owner a data collection first: keep the items in one with put_item and have the page fetch /data/<path>.json, so editing one of them later does not mean rewriting the page. " +
        BUNDLES,
      access: { point: atPath(), level: "write" },
      input: z.object({
        path: z
          .string()
          .describe(
            "Page path, for example /about. A page at /root is the home page, served at /; until one exists / " +
              "serves the generated contents, a list of every public page. / itself is not a page path.",
          ),
        content: z.string().describe("Markdown or a full HTML document"),
        format: FORMAT.optional().describe("Defaults to auto-detect"),
        title: z.string().optional().describe("Defaults to the first heading"),
        meta: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            "Facts about the page that are not its body, such as a date or a kind, as string values. Stored beside " +
              "the body rather than inside it, and returned by list_pages without reading any page. Keys start with a " +
              "letter; path and title are refused because the page already has them.",
          ),
        overwrite: z.boolean().optional().describe("Replace an existing page at this path, meta included"),
      }),
      output: z.object(PAGE),
    },
    async ({ path: raw, content, format, title, meta, overwrite }, app) => {
      const path = requirePath(raw);
      if (content.length === 0) throw new EndpointError(400, "content is required");
      if ((await getPage(app, path)) && overwrite !== true)
        throw new EndpointError(400, `A page already exists at ${path}. Pass overwrite: true to replace it.`);
      const page = await savePage(app, {
        path,
        contentType: detectFormat(content, format),
        title: title || deriveTitle(content, path),
        body: content,
        meta: meta === undefined ? {} : validateMeta(meta),
      });
      return {
        path: page.path,
        url: urlFor(app, page.path),
        title: page.title,
        format: page.contentType,
        meta: page.meta,
      };
    },
  ),

  update_page: endpoint(
    {
      serve: ["api", "mcp"],
      method: "POST",
      path: "/api/v1/update_page",
      description:
        "Replace the content of an existing page, or change its title or meta without sending the body at all. " +
        "Pass draft true to write the working copy instead: readers keep seeing the live page, whoever may write it sees the " +
        "change at preview_url, and publish_draft makes it live. Revise a published page that way whenever a " +
        "half-finished change must not be seen. " +
        "If you are rewriting the page only to change items in a list, move that list into a data collection instead and let the page fetch it. " +
        BUNDLES,
      access: { point: atPath(), level: "write" },
      input: z.object({
        path: PATH,
        content: z.string().optional().describe("The new body. Leave it out to keep the body as it is."),
        title: z.string().optional().describe("Leave it out to keep the title"),
        meta: z
          .record(z.string(), z.string().nullable())
          .optional()
          .describe(
            "Keys to set, merged into what the page already has. A key set to null is removed; a key left out " +
              "is kept, so changing one fact costs one key.",
          ),
        draft: z
          .boolean()
          .optional()
          .describe(
            "Write the working copy, starting one from the live page if there is none, and leave the live page alone",
          ),
      }),
      output: z.object({
        ...PAGE,
        title: z.string().describe("As written, in the working copy for a draft update"),
        preview_url: z
          .string()
          .optional()
          .describe(
            "Where the working copy is rendered, for anyone who may write the page. Present only for a draft update.",
          ),
      }),
    },
    async ({ path: raw, content, title, meta, draft }, app) => {
      const path = requirePath(raw);
      const existing = await getPage(app, path);
      if (!existing) throw new EndpointError(400, `${noPageAt(path)}. Use publish_page to create it.`);
      if (content === undefined && title === undefined && meta === undefined)
        throw new EndpointError(400, "Pass content, title or meta: there is nothing to update");
      if (content === "") throw new EndpointError(400, "content must not be empty");

      const base = draft ? workingCopy(existing) : existing;
      const body = content ?? base.body;
      const fields = {
        contentType: content === undefined ? base.contentType : detectFormat(body, base.contentType),
        title: title || base.title,
        body,
        meta: meta === undefined ? base.meta : mergeMeta(base.meta, meta),
      };
      if (draft) {
        const copy = workingCopy(await saveDraft(app, path, fields));
        return {
          path,
          url: urlFor(app, path),
          title: copy.title,
          format: copy.contentType,
          meta: copy.meta,
          preview_url: previewUrlFor(app, path),
        };
      }
      const page = await savePage(app, { path, ...fields });
      return {
        path: page.path,
        url: urlFor(app, page.path),
        title: page.title,
        format: page.contentType,
        meta: page.meta,
      };
    },
  ),

  publish_draft: endpoint(
    {
      serve: ["api", "mcp"],
      method: "POST",
      path: "/api/v1/publish_draft",
      description:
        "Make a page's working copy live: its body, title, format and meta replace what readers see, and the working " +
        "copy is cleared. Look at preview_url first: with no build, the preview is the only place a broken template or " +
        "a bad fence is seen before a reader sees it. " +
        BUNDLES,
      access: { point: atPath(), level: "write" },
      input: z.object({ path: PATH }),
      output: z.object(PAGE),
    },
    async ({ path }, app) => {
      const page = await publishDraft(app, requirePath(path));
      return {
        path: page.path,
        url: urlFor(app, page.path),
        title: page.title,
        format: page.contentType,
        meta: page.meta,
      };
    },
  ),

  discard_draft: endpoint(
    {
      serve: ["api", "mcp"],
      method: "POST",
      path: "/api/v1/discard_draft",
      description: "Throw away a page's working copy and keep the live page exactly as it is. " + BUNDLES,
      access: { point: atPath(), level: "write" },
      input: z.object({ path: PATH }),
      output: z.object({
        path: z.string(),
        discarded: z.boolean().describe("false when there was no working copy to throw away"),
      }),
    },
    async ({ path: raw }, app) => {
      const path = requirePath(raw);
      return { path, discarded: await discardDraft(app, path) };
    },
  ),

  check_links: endpoint(
    {
      serve: ["api", "mcp"],
      method: "GET",
      path: "/api/v1/check_links",
      description:
        "Find links in page bodies that point at nothing on this site: a page under /p, an asset under /assets, a " +
        "collection under /data, or any other path the site does not answer. It reads what a page wrote out whole, " +
        "markdown links, href and src attributes starting with /, and quoted /data and /assets URLs, in live pages " +
        "only, stored templates included. A URL a template, a script or a fetch assembles from pieces is not seen, " +
        "so an empty result means none of the links it found are broken, not that the site has none; the reply says " +
        "how many it checked. Run it after any move or delete: nothing else checks links, and a broken one shows " +
        "nowhere until somebody clicks it.",
      access: { point: site, level: "read" },
      input: z.object({}),
      output: z.union([
        z
          .object({
            pages: z.number().describe("Pages read"),
            links: z.number().describe("0"),
            broken: z.array(z.unknown()).describe("Empty, and it means nothing was looked at"),
            warning: z.string().describe("Says so, so an empty broken list is not read as a clean bill of health"),
          })
          .describe("No links were found, so nothing was checked"),
        z
          .object({
            pages: z.number().describe("Pages read"),
            links: z.number().describe("Links checked"),
            broken: z.array(
              z.object({
                path: z.string().describe("The page holding the link"),
                line: z.number().describe("1 based"),
                link: z.string().describe("The link as written"),
              }),
            ),
          })
          .describe("Links were found, so something was checked"),
      ]),
    },
    async (_input, app) => {
      const report = await checkLinks(app);
      if (report.links > 0) return report;
      return {
        ...report,
        warning:
          "No links written out whole were found in any page, so nothing was checked. Links a template or a script " +
          "assembles are not seen.",
      };
    },
  ),
};
