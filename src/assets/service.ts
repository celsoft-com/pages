import { EndpointError } from "@celsoft/platform";
import { eq, or } from "drizzle-orm";
import { normalizeAssetPath } from "../pages/path";
import type { PagesApp } from "../pages-app";
import { assets } from "../schema";
import { assetFile, encodeKey } from "../store";
import type { Asset } from "../types";

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

export function assetKeyFor(path: string): string {
  return encodeKey(normalizeAssetPath(path));
}

export function assetUrlFor(asset: Asset): string {
  return `/assets/${asset.path ? asset.path.replace(/^\//, "") : asset.key}`;
}

// The only way an asset is written, transfer.ts included: the bytes first, then the row a listing
// reads, so a listing never names bytes that were not stored.
export async function writeAsset(app: PagesApp, asset: Asset, body: ArrayBuffer | ReadableStream): Promise<void> {
  await app.files.put(assetFile(asset.key), body, asset.contentType);
  await app.db
    .insert(assets)
    .values({ key: asset.key, path: asset.path ?? null, asset })
    .onConflictDoUpdate({ target: assets.key, set: { path: asset.path ?? null, asset } });
}

export async function removeAsset(app: PagesApp, key: string): Promise<void> {
  await app.files.delete(assetFile(key));
  await app.db.delete(assets).where(eq(assets.key, key));
}

export async function putAsset(
  app: PagesApp,
  input: {
    filename: string;
    contentType: string;
    bytes: ArrayBuffer;
    path?: string;
  },
): Promise<Asset> {
  const rooted = input.path === undefined ? null : normalizeAssetPath(input.path);
  if (rooted === "/") throw new EndpointError(400, "path must name a file, for example /gallery/images/photo.jpg");

  const key = rooted
    ? assetKeyFor(rooted)
    : `${await hashKey(input.bytes)}${extensionFor(input.filename, input.contentType)}`;

  const asset: Asset = {
    key,
    ...(rooted ? { path: rooted } : {}),
    filename: input.filename,
    contentType: input.contentType,
    size: input.bytes.byteLength,
    createdAt: Date.now(),
  };
  await writeAsset(app, asset, input.bytes);
  return asset;
}

export async function getAsset(app: PagesApp, key: string): Promise<Asset | null> {
  const [row] = await app.db.select({ asset: assets.asset }).from(assets).where(eq(assets.key, key));
  return row?.asset ?? null;
}

// The stored bytes as a stream, read once, for a write that copies them elsewhere.
export async function assetBody(app: PagesApp, key: string): Promise<ReadableStream | null> {
  return (await app.files.get(assetFile(key)))?.body ?? null;
}

// A URL under /assets/ is either a legacy hash key, stored verbatim, or a rooted path.
// Verbatim wins so that every URL handed out before paths existed keeps resolving.
export async function findAsset(app: PagesApp, raw: string): Promise<Asset | null> {
  const rows = await app.db
    .select({ asset: assets.asset })
    .from(assets)
    .where(or(eq(assets.key, raw), eq(assets.key, assetKeyFor(raw))));
  return rows.find((row) => row.asset.key === raw)?.asset ?? rows[0]?.asset ?? null;
}

export async function listAssets(app: PagesApp): Promise<Asset[]> {
  const rows = await app.db.select({ asset: assets.asset }).from(assets);
  return rows.map((row) => row.asset).sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteAsset(app: PagesApp, raw: string): Promise<boolean> {
  const asset = await findAsset(app, raw);
  if (!asset) return false;
  await removeAsset(app, asset.key);
  return true;
}
