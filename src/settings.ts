import type { Env } from "./types";

export async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row ? row.value : null;
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  )
    .bind(key, value)
    .run();
}

export async function getSettings(env: Env): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings").all<{
    key: string;
    value: string;
  }>();
  const out: Record<string, string> = {};
  for (const row of results) out[row.key] = row.value;
  return out;
}

export const SETTING = {
  siteTitle: "site_title",
  siteDescription: "site_description",
  sessionKey: "session_key",
  secretKey: "secret_key",
  cfApiToken: "cf_api_token",
  cfZoneId: "cf_zone_id",
  cfAccountId: "cf_account_id",
  fallbackOrigin: "fallback_origin",
} as const;
