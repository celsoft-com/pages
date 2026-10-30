import { endpoint } from "@celsoft/platform";
import { z } from "zod";
import { getInstructions, MAX_INSTRUCTIONS, saveInstructions } from "../instructions";
import { SITE_POINT } from "../pages-app";

const site = () => SITE_POINT;

export const siteEndpoints = {
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
        if_rev: z.number().optional().describe("The rev get_instructions returned. Required once any instructions exist."),
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
