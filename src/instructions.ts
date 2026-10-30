import { EndpointError } from "@celsoft/platform";
import { eq } from "drizzle-orm";
import type { PagesApp } from "./pages-app";
import { siteValues } from "./schema";

const KEY = "instructions";

// Every session that follows the pointer reads the whole text into its context, so a ceiling that
// keeps it a page of rules rather than a document is part of what makes reading it first cheap.
export const MAX_INSTRUCTIONS = 16000;

export interface Instructions {
  text: string;
  rev: number;
  updatedAt: string | null;
}

export async function getInstructions(app: PagesApp): Promise<Instructions> {
  const [row] = await app.db.select().from(siteValues).where(eq(siteValues.key, KEY));
  const stored = row?.value as Partial<Instructions> | undefined;
  return { text: stored?.text ?? "", rev: stored?.rev ?? 0, updatedAt: stored?.updatedAt ?? null };
}

// The owner edits these in the admin and a client edits them through a tool, so either may be
// writing over what the other just saved. A rev makes the second writer re-read rather than
// silently erase a rule somebody else added a minute ago.
export async function saveInstructions(app: PagesApp, text: string, ifRev: number | undefined): Promise<Instructions> {
  const trimmed = text.trim();
  if (trimmed.length > MAX_INSTRUCTIONS)
    throw new EndpointError(
      400,
      `Instructions are ${trimmed.length} characters and the limit is ${MAX_INSTRUCTIONS}. Every session reads ` +
        `them whole, so tighten them rather than add to them.`,
    );
  const current = await getInstructions(app);
  if (current.rev > 0 && ifRev === undefined)
    throw new EndpointError(
      409,
      `Instructions already exist at rev ${current.rev}. Read them with get_instructions and pass if_rev: ` +
        `${current.rev}, so a rule added since you last read them is not lost.`,
    );
  if (ifRev !== undefined && ifRev !== current.rev)
    throw new EndpointError(
      409,
      `Instructions are at rev ${current.rev}, not ${ifRev}: they changed since you read them. Read them ` +
        `again, reapply your change and pass the new rev.`,
    );
  if (trimmed === current.text) return current;
  const next = { text: trimmed, rev: current.rev + 1, updatedAt: new Date().toISOString() };
  await app.db
    .insert(siteValues)
    .values({ key: KEY, value: next })
    .onConflictDoUpdate({ target: siteValues.key, set: { value: next } });
  return next;
}
