import { randomBytes, recoveryCode, toBase64 } from "../crypto/random";
import { SETTING, setSetting } from "../settings";
import type { Env, Owner } from "../types";
import { hashSecret } from "./password";

export async function getOwner(env: Env): Promise<Owner | null> {
  return env.DB.prepare("SELECT * FROM owner LIMIT 1").first<Owner>();
}

export async function isSetupComplete(env: Env): Promise<boolean> {
  return (await getOwner(env)) !== null;
}

export async function completeSetup(
  env: Env,
  password: string,
): Promise<{ ownerId: string; recovery: string }> {
  if (await isSetupComplete(env)) throw new Error("setup already complete");

  const ownerId = crypto.randomUUID();
  const recovery = recoveryCode();
  const [pw, rc] = await Promise.all([hashSecret(password), hashSecret(recovery)]);

  const inserted = await env.DB.prepare(
    `INSERT INTO owner (id, password_hash, password_salt, recovery_hash, recovery_salt, created_at)
     SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM owner)`,
  )
    .bind(ownerId, pw.hash, pw.salt, rc.hash, rc.salt, Date.now())
    .run();

  if ((inserted.meta.changes ?? 0) === 0) throw new Error("setup already complete");

  await setSetting(env, SETTING.sessionKey, toBase64(randomBytes(32)));
  await setSetting(env, SETTING.secretKey, toBase64(randomBytes(32)));
  await setSetting(env, SETTING.siteTitle, "Pages");

  return { ownerId, recovery };
}

export async function changePassword(env: Env, ownerId: string, password: string): Promise<void> {
  const pw = await hashSecret(password);
  await env.DB.prepare("UPDATE owner SET password_hash = ?, password_salt = ? WHERE id = ?")
    .bind(pw.hash, pw.salt, ownerId)
    .run();
}
