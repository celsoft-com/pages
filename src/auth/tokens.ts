import { randomToken, toBase64 } from "../crypto/random";
import { stores } from "../store";
import type { Access } from "../types";

// A credential for something with no browser: no consent screen to render, no redirect URI to
// receive a code at, nothing to refresh on a timer. The owner pastes one string into a service and
// it works until they revoke it.

export interface ApiToken {
  id: string;
  label: string;
  access: Access;
  createdAt: number;
}

const PREFIX = "apitoken/";

// Distinct from the at_ and rt_ the OAuth store issues, because one resolver reads all three off
// the same Authorization header and a collision there would authenticate the wrong thing.
const TOKEN_PREFIX = "pat_";

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toBase64(new Uint8Array(bytes)).replace(/[+/=]/g, "");
}

// Keyed by the hash of the secret, so listing for the admin never needs the plaintext and a lookup
// is one get. The plaintext exists only in what this returns.
export async function mintToken(label: string, access: Access): Promise<{ secret: string; token: ApiToken }> {
  const secret = `${TOKEN_PREFIX}${randomToken(32)}`;
  const token: ApiToken = { id: randomToken(8), label, access, createdAt: Date.now() };
  await stores.oauth().setJSON(`${PREFIX}${await digest(secret)}`, token);
  return { secret, token };
}

export async function readApiToken(secret: string): Promise<ApiToken | null> {
  if (!secret.startsWith(TOKEN_PREFIX)) return null;
  return (await stores.oauth().get(`${PREFIX}${await digest(secret)}`, { type: "json" })) as ApiToken | null;
}

export async function listTokens(): Promise<ApiToken[]> {
  const { blobs } = await stores.oauth().list({ prefix: PREFIX });
  const tokens = await Promise.all(
    blobs.map((blob) => stores.oauth().get(blob.key, { type: "json" }) as Promise<ApiToken | null>),
  );
  return tokens.filter((t): t is ApiToken => t !== null).sort((a, b) => b.createdAt - a.createdAt);
}

// By id rather than by secret, because the admin never holds the secret. The scan is over a handful
// of keys and only runs when the owner presses revoke.
export async function revokeToken(id: string): Promise<boolean> {
  const { blobs } = await stores.oauth().list({ prefix: PREFIX });
  for (const blob of blobs) {
    const token = (await stores.oauth().get(blob.key, { type: "json" })) as ApiToken | null;
    if (token?.id === id) {
      await stores.oauth().delete(blob.key);
      return true;
    }
  }
  return false;
}
