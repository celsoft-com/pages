import { fromBase64, randomBytes, toBase64 } from "../crypto/random";

const ITERATIONS = 100000;

export async function hashSecret(secret: string, saltB64?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltB64 ? fromBase64(saltB64) : randomBytes(16);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
    key,
    256,
  );
  return { hash: toBase64(new Uint8Array(bits)), salt: toBase64(salt) };
}

export async function verifySecret(secret: string, hash: string, salt: string): Promise<boolean> {
  const candidate = await hashSecret(secret, salt);
  if (candidate.hash.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= candidate.hash.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}
