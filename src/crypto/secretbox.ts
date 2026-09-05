import { fromBase64, randomBytes, toBase64 } from "./random";
import { getSetting, SETTING } from "../settings";
import type { Env } from "../types";

async function key(env: Env): Promise<CryptoKey> {
  const raw = await getSetting(env, SETTING.secretKey);
  if (!raw) throw new Error("secret key missing");
  return crypto.subtle.importKey("raw", fromBase64(raw), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function seal(env: Env, plaintext: string): Promise<string> {
  const iv = randomBytes(12);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(env),
    new TextEncoder().encode(plaintext),
  );
  return `${toBase64(iv)}.${toBase64(new Uint8Array(cipher))}`;
}

export async function open(env: Env, sealed: string): Promise<string> {
  const [iv, cipher] = sealed.split(".");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv) },
    await key(env),
    fromBase64(cipher),
  );
  return new TextDecoder().decode(plain);
}
