import { fromBase64, toBase64 } from "../crypto/random";
import type { Owner } from "../types";
import { getOwner } from "./setup";

const COOKIE = "pages_session";
const TTL_MS = 1000 * 60 * 60 * 24 * 14;

async function signingKey(owner: Owner): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fromBase64(owner.sessionKey), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function createSessionCookie(owner: Owner): Promise<string> {
  const expires = Date.now() + TTL_MS;
  const payload = `${owner.id}.${expires}`;
  const sig = await crypto.subtle.sign("HMAC", await signingKey(owner), new TextEncoder().encode(payload));
  const value = `${payload}.${toBase64(new Uint8Array(sig))}`;
  return `${COOKIE}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.floor(
    TTL_MS / 1000,
  )}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function getSessionOwner(request: Request): Promise<Owner | null> {
  const raw = readCookie(request, COOKIE);
  if (!raw) return null;

  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [ownerId, expires, sig] = parts;
  if (Number(expires) < Date.now()) return null;

  const owner = await getOwner();
  if (!owner || owner.id !== ownerId) return null;

  const valid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(owner),
    fromBase64(sig),
    new TextEncoder().encode(`${ownerId}.${expires}`),
  );
  return valid ? owner : null;
}
