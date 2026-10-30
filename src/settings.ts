import { eq } from "drizzle-orm";
import type { PagesApp } from "./pages-app";
import { siteValues } from "./schema";
import type { SiteSettings } from "./types";

const KEY = "settings";
export const DEFAULT_SETTINGS: SiteSettings = {
  title: "Pages",
  description: "",
  head: "",
  header: "",
  footer: "",
  theme: "default",
};

export async function getSettings(app: PagesApp): Promise<SiteSettings> {
  const [row] = await app.db.select().from(siteValues).where(eq(siteValues.key, KEY));
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<SiteSettings> | undefined) ?? {}) };
}

export async function saveSettings(app: PagesApp, update: Partial<SiteSettings>): Promise<SiteSettings> {
  const next = { ...(await getSettings(app)), ...update };
  await app.db
    .insert(siteValues)
    .values({ key: KEY, value: next })
    .onConflictDoUpdate({ target: siteValues.key, set: { value: next } });
  return next;
}
