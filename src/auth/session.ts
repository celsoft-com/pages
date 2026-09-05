import { fromBase64, toBase64 } from "../crypto/random";
import { getSetting, SETTING } from "../settings";
import type { Env } from "../types";

const COOKIE = "pages_session";
const TTL_MS = 1000 * 60 * 60 * 24 * 14;

async function signingKey(env: Env): Promise<CryptoKey> {
  const raw = await getSetting(env, SETTING.sessionKey);
  if (!raw) throw new Error("session key missing");
  return crypto.subtle.importKey("raw", fromBase64(raw), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function createSessionCookie(env: Env, ownerId: string): Promise<string> {
  const expires = Date.now() + TTL_MS;
  const payload = `${ownerId}.${expires}`;
  const key = await signingKey(env);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
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

export async function getSessionOwner(request: Request, env: Env): Promise<string | null> {
  const raw = readCookie(request, COOKIE);
  if (!raw) return null;

  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [ownerId, expires, sig] = parts;
  if (Number(expires) < Date.now()) return null;

  const key = await signingKey(env);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    fromBase64(sig),
    new TextEncoder().encode(`${ownerId}.${expires}`),
  );
  return valid ? ownerId : null;
}
