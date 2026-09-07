import { fromBase64, toBase64 } from "./random";

async function keyFor(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fromBase64(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function sign(secret: string, payload: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await keyFor(secret), new TextEncoder().encode(payload));
  return toBase64(new Uint8Array(sig));
}

// A tampered cookie is a wrong answer, not an error: fromBase64 throws on anything that is not
// base64, and a 500 on a hand-edited cookie would be a way to tell a real signature from junk.
export async function verify(secret: string, payload: string, signature: string): Promise<boolean> {
  try {
    return await crypto.subtle.verify(
      "HMAC",
      await keyFor(secret),
      fromBase64(signature),
      new TextEncoder().encode(payload),
    );
  } catch {
    return false;
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
