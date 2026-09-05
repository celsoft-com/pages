import { stores } from "../store";
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

export async function putAsset(input: {
  filename: string;
  contentType: string;
  bytes: ArrayBuffer;
}): Promise<Asset> {
  const hash = await hashKey(input.bytes);
  const key = `${hash}${extensionFor(input.filename, input.contentType)}`;
  const asset: Asset = {
    key,
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

export async function deleteAsset(key: string): Promise<boolean> {
  const existing = await stores.assets().getMetadata(key);
  if (!existing) return false;
  await stores.assets().delete(key);
  return true;
}
