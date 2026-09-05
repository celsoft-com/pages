import { randomToken, toBase64 } from "../crypto/random";
import { stores } from "../store";

export interface Client {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  createdAt: number;
}

export interface AuthCode {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  ownerId: string;
  expiresAt: number;
}

export interface Grant {
  id: string;
  clientId: string;
  clientName: string;
  ownerId: string;
  createdAt: number;
}

export interface TokenRecord {
  grantId: string;
  clientId: string;
  ownerId: string;
  kind: "access" | "refresh";
  expiresAt: number | null;
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toBase64(new Uint8Array(bytes)).replace(/[+/=]/g, "");
}

export async function saveClient(client: Client): Promise<void> {
  await stores.oauth().setJSON(`client/${client.clientId}`, client);
}

export async function getClient(clientId: string): Promise<Client | null> {
  return (await stores.oauth().get(`client/${clientId}`, { type: "json" })) as Client | null;
}

export async function saveCode(code: AuthCode): Promise<void> {
  await stores.oauth().setJSON(`code/${await digest(code.code)}`, code);
}

export async function takeCode(code: string): Promise<AuthCode | null> {
  const key = `code/${await digest(code)}`;
  const stored = (await stores.oauth().get(key, { type: "json" })) as AuthCode | null;
  if (stored) await stores.oauth().delete(key);
  if (!stored || stored.expiresAt < Date.now()) return null;
  return stored;
}

export async function saveGrant(grant: Grant): Promise<void> {
  await stores.oauth().setJSON(`grant/${grant.id}`, grant);
}

export async function listGrants(): Promise<Grant[]> {
  const { blobs } = await stores.oauth().list({ prefix: "grant/" });
  const grants = await Promise.all(
    blobs.map((blob) => stores.oauth().get(blob.key, { type: "json" }) as Promise<Grant | null>),
  );
  return grants.filter((g): g is Grant => g !== null).sort((a, b) => b.createdAt - a.createdAt);
}

export async function revokeGrant(grantId: string): Promise<void> {
  await stores.oauth().delete(`grant/${grantId}`);
}

export async function issueToken(record: TokenRecord): Promise<string> {
  const token = `${record.kind === "access" ? "at" : "rt"}_${randomToken(32)}`;
  await stores.oauth().setJSON(`token/${await digest(token)}`, record);
  return token;
}

export async function readToken(token: string): Promise<TokenRecord | null> {
  const stored = (await stores.oauth().get(`token/${await digest(token)}`, { type: "json" })) as TokenRecord | null;
  if (!stored) return null;
  if (stored.expiresAt !== null && stored.expiresAt < Date.now()) return null;
  if (!(await stores.oauth().getMetadata(`grant/${stored.grantId}`))) return null;
  return stored;
}
