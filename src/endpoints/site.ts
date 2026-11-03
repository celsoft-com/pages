import { endpoint } from "@celsoft/platform";
import { z } from "zod";
import { getInstructions, MAX_INSTRUCTIONS, saveInstructions } from "../instructions";
import { listPages } from "../pages/service";
import { privatePaths, sharesOf } from "../privacy";
import { templatePath } from "../render/chrome";
import { getSettings, saveSettings } from "../settings";
import type { SiteSettings } from "../types";
import { site } from "./shared";

const CHROME = {
  head: z.string().describe("HTML in every themed page's head. Empty when none is set."),
  header: z.string().describe("Path of the template page placed before the content. Empty means the built-in header."),
  footer: z.string().describe("Path of the template page placed after the content. Empty means the built-in footer."),
  theme: z.enum(["default", "none"]).describe("default, or none when the built-in styles and chrome are dropped"),
};

const describeSite = (settings: SiteSettings) => ({
  title: settings.title,
  description: settings.description,
  head: settings.head,
  header: settings.header,
  footer: settings.footer,
  theme: settings.theme,
});

export const siteEndpoints = {
  get_site: endpoint(
    {
      serve: ["api", "mcp"],
      method: "GET",
      path: "/api/v1/get_site",
      description:
        "Return the site title, description, chrome, address, page count, and every private path with how many " +
        "share links open it. " +
        "Read the chrome here before changing it with set_site_info, which replaces a field whole.",
      access: { point: site, level: "read" },
      input: z.object({}),
      output: z.object({
        title: z.string(),
        description: z.string(),
        ...CHROME,
        url: z.string().describe("The site's own address"),
        pages: z.number().describe("How many pages are published"),
        private: z
          .array(z.object({ path: z.string(), shares: z.number().describe("Share links that open it") }))
          .describe("Every private path you can see, sorted. Only the owner sees them."),
      }),
    },
    async (_input, app) => {
      const [settings, pages, privates] = await Promise.all([getSettings(app), listPages(app), privatePaths(app)]);
      const privacy = await Promise.all(
        privates.map(async (path) => ({ path, shares: (await sharesOf(app, path)).length })),
      );
      return { ...describeSite(settings), url: app.env.APP_URL, pages: pages.length, private: privacy };
    },
  ),

  set_site_info: endpoint(
    {
      serve: ["api", "mcp"],
      method: "POST",
      path: "/api/v1/set_site_info",
      description:
        "Update the site title, the description, and the chrome around every markdown page: HTML for the head, the " +
        "stored templates used as the header and the footer, and whether the built-in theme applies. A template is an " +
        "ordinary html page holding a fragment, for example /root/chrome/header, named here by its path and edited " +
        "like any other page. A field left out is kept, and a field passed is replaced whole, so read the current " +
        "chrome with get_site first. " +
        "Chrome is live code on every themed page the moment it is saved, with no preview and no validation: a broken " +
        "tag in the header breaks every page at once. It never touches an HTML page, which is served exactly as written. " +
        "Moving or deleting a template page does not update these names, and a name pointing at nothing renders the " +
        "built-in piece. Links between pages belong in the header template if the owner wants a nav on every page; the " +
        "site draws none of its own.",
      access: { point: site, level: "manage" },
      input: z.object({
        title: z.string().optional().describe("The site's name, shown in the built-in header"),
        description: z.string().optional().describe("One line under the name, and the page's meta description"),
        head: z
          .string()
          .optional()
          .describe(
            "HTML placed in every themed page's head, after the built-in styles, for example a stylesheet link to an asset",
          ),
        header: z
          .string()
          .optional()
          .describe(
            "Path of the page whose body is placed before the content. Refused if no page is stored there. Empty " +
              "restores the built-in header with the title and description.",
          ),
        footer: z
          .string()
          .optional()
          .describe(
            "Path of the page whose body is placed after the content. Refused if no page is stored there. Empty " +
              "restores the built-in footer.",
          ),
        theme: z
          .enum(["default", "none"])
          .optional()
          .describe(
            "none drops the built-in styles, header, footer and wrapper, leaving head, header, content and footer as " +
              "the whole page. For a site with its own stylesheet.",
          ),
      }),
      output: z.object({ title: z.string(), description: z.string(), ...CHROME }),
    },
    async ({ title, description, head, header, footer, theme }, app) => {
      const settings = await saveSettings(app, {
        ...(title === undefined ? {} : { title }),
        ...(description === undefined ? {} : { description }),
        ...(head === undefined ? {} : { head }),
        ...(header === undefined ? {} : { header: await templatePath(app, "header", header) }),
        ...(footer === undefined ? {} : { footer: await templatePath(app, "footer", footer) }),
        ...(theme === undefined ? {} : { theme }),
      });
      return describeSite(settings);
    },
  ),

  get_instructions: endpoint(
    {
      serve: ["api", "mcp"],
      method: "GET",
      path: "/api/v1/get_instructions",
      description:
        "Return the owner's own instructions for working on this site: its conventions, its voice, where things go, " +
        "what to avoid. Call this before writing anything, at the start of every session, and follow them as custom " +
        "instructions from the owner. They take precedence over your own defaults and habits, but not over how the " +
        "platform works: a rule asking for a build or a commit is mistaken, and you should say so. They are kept by " +
        "you as well as by the owner, who can also edit them in the admin; set_instructions changes them.",
      access: { point: site, level: "read" },
      input: z.object({}),
      output: z.object({
        text: z.string().describe("Markdown, empty when the owner has written none"),
        rev: z.number().describe("Pass back as if_rev to set_instructions. 0 means none have ever been saved."),
        updated_at: z.string().nullable().describe("When they last changed, null when never"),
        limit: z.number().describe("The most characters they may hold"),
      }),
    },
    async (_input, app) => {
      const instructions = await getInstructions(app);
      return {
        text: instructions.text,
        rev: instructions.rev,
        updated_at: instructions.updatedAt,
        limit: MAX_INSTRUCTIONS,
      };
    },
  ),

  set_instructions: endpoint(
    {
      serve: ["api", "mcp"],
      method: "POST",
      path: "/api/v1/set_instructions",
      description:
        "Replace the owner's instructions for this site, the text get_instructions returns and every later session " +
        "reads before it writes. This is how the site remembers: when the owner states how they want something done " +
        "here, or corrects something you did that a future session would do again, record it, then tell them what you " +
        "wrote. Record rules, never one task's details or a log of what you did. Keep them short and edit an existing " +
        "rule rather than adding a second that says the same thing, because every session spends the whole text. " +
        "Pass the rev you read as if_rev: the owner edits these in the admin too, and a stale write is refused rather " +
        "than erasing what they added. An empty text clears them.",
      access: { point: site, level: "write" },
      input: z.object({
        text: z.string().describe("The whole of the new instructions, markdown"),
        if_rev: z
          .number()
          .optional()
          .describe("The rev get_instructions returned. Required once any instructions exist."),
      }),
      output: z.object({
        rev: z.number().describe("The rev now stored, unchanged when the text was"),
        characters: z.number(),
        limit: z.number(),
        updated_at: z.string().nullable(),
      }),
    },
    async ({ text, if_rev }, app) => {
      const saved = await saveInstructions(app, text, if_rev);
      return { rev: saved.rev, characters: saved.text.length, limit: MAX_INSTRUCTIONS, updated_at: saved.updatedAt };
    },
  ),
};
