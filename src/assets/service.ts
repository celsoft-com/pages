import { normalizeAssetPath } from "../pages/path";
import { encodeKey, stores } from "../store";
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

export async function putAsset(input: {
  filename: string;
  contentType: string;
  bytes: ArrayBuffer;
  path?: string;
}): Promise<Asset> {
  const rooted = input.path === undefined ? null : normalizeAssetPath(input.path);
  if (rooted === "/") throw new Error("path must name a file, for example /germanfunstuff/images/coburg.jpg");

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
  await stores.assets().set(key, input.bytes, { metadata: { ...asset } });
  return asset;
}

export async function getAsset(key: string): Promise<{ body: ArrayBuffer; asset: Asset } | null> {
  const result = await stores.assets().getWithMetadata(key, { type: "arrayBuffer" });
  if (!result) return null;
  return { body: result.data, asset: result.metadata as unknown as Asset };
}

// A URL under /assets/ is either a legacy hash key, stored verbatim, or a rooted path.
// Verbatim wins so that every URL handed out before paths existed keeps resolving.
export async function findAsset(raw: string): Promise<{ body: ArrayBuffer; asset: Asset } | null> {
  return (await getAsset(raw)) ?? (await getAsset(assetKeyFor(raw)));
}

export async function listAssets(): Promise<Asset[]> {
  const { blobs } = await stores.assets().list();
  const assets = await Promise.all(
    blobs.map(async (blob) => {
      const meta = await stores.assets().getMetadata(blob.key);
      return meta ? (meta.metadata as unknown as Asset) : null;
    }),
  );
  return assets
    .filter((a): a is Asset => a !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteAsset(raw: string): Promise<boolean> {
  for (const key of [raw, assetKeyFor(raw)]) {
    if (await stores.assets().getMetadata(key)) {
      await stores.assets().delete(key);
      return true;
    }
  }
  return false;
}
