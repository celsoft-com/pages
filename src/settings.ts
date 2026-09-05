import { stores } from "./store";
import type { SiteSettings } from "./types";

const KEY = "settings";
const DEFAULTS: SiteSettings = { title: "Pages", description: "" };

export async function getSettings(): Promise<SiteSettings> {
  const stored = await stores.site().get(KEY, { type: "json" });
  return { ...DEFAULTS, ...((stored as Partial<SiteSettings> | null) ?? {}) };
}

export async function saveSettings(update: Partial<SiteSettings>): Promise<SiteSettings> {
  const next = { ...(await getSettings()), ...update };
  await stores.site().setJSON(KEY, next);
  return next;
}
