import type { Asset, Env } from "../types";

function extensionFor(filename: string, contentType: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot > 0) return filename.slice(dot).toLowerCase();
  const guess: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "text/css": ".css",
    "application/pdf": ".pdf",
  };
  return guess[contentType] ?? "";
}

async function hashKey(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function putAsset(
  env: Env,
  input: { ownerId: string; filename: string; contentType: string; bytes: ArrayBuffer },
): Promise<Asset> {
  const hash = await hashKey(input.bytes);
  const key = `${hash}${extensionFor(input.filename, input.contentType)}`;

  await env.ASSETS.put(key, input.bytes, {
    httpMetadata: { contentType: input.contentType, cacheControl: "public, max-age=31536000, immutable" },
  });

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO assets (id, owner_id, key, filename, content_type, size, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET filename = excluded.filename`,
  )
    .bind(hash, input.ownerId, key, input.filename, input.contentType, input.bytes.byteLength, now)
    .run();

  const asset = await env.DB.prepare("SELECT * FROM assets WHERE key = ?").bind(key).first<Asset>();
  if (!asset) throw new Error(`asset write failed for ${key}`);
  return asset;
}

export async function listAssets(env: Env): Promise<Asset[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM assets ORDER BY created_at DESC LIMIT 200",
  ).all<Asset>();
  return results;
}

export async function deleteAsset(env: Env, key: string): Promise<boolean> {
  await env.ASSETS.delete(key);
  const result = await env.DB.prepare("DELETE FROM assets WHERE key = ?").bind(key).run();
  return (result.meta.changes ?? 0) > 0;
}

export function assetUrl(key: string): string {
  return `/assets/${key}`;
}
