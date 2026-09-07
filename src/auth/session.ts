import { sign, verify } from "../crypto/hmac";
import type { Owner } from "../types";
import { getOwner } from "./setup";

const COOKIE = "pages_session";
const TTL_MS = 1000 * 60 * 60 * 24 * 14;

export async function createSessionCookie(owner: Owner): Promise<string> {
  const expires = Date.now() + TTL_MS;
  const payload = `${owner.id}.${expires}`;
  const value = `${payload}.${await sign(owner.sessionKey, payload)}`;
  return `${COOKIE}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.floor(
    TTL_MS / 1000,
  )}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function readCookie(request: Request, name: string): string | null {
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

  return (await verify(owner.sessionKey, `${ownerId}.${expires}`, sig)) ? owner : null;
}
