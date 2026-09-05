import { randomBytes, recoveryCode, toBase64 } from "../crypto/random";
import { stores } from "../store";
import type { Owner } from "../types";
import { hashSecret } from "./password";
import { savePage } from "../pages/service";

const KEY = "owner";

export async function getOwner(): Promise<Owner | null> {
  return (await stores.site().get(KEY, { type: "json" })) as Owner | null;
}

export async function isSetupComplete(): Promise<boolean> {
  return (await getOwner()) !== null;
}

export async function completeSetup(password: string): Promise<{ owner: Owner; recovery: string }> {
  if (await isSetupComplete()) throw new Error("setup already complete");

  const recovery = recoveryCode();
  const [pw, rc] = await Promise.all([hashSecret(password), hashSecret(recovery)]);
  const owner: Owner = {
    id: crypto.randomUUID(),
    passwordHash: pw.hash,
    passwordSalt: pw.salt,
    recoveryHash: rc.hash,
    recoverySalt: rc.salt,
    sessionKey: toBase64(randomBytes(32)),
    createdAt: Date.now(),
  };

  await stores.site().setJSON(KEY, owner, { onlyIfNew: true });
  const stored = await getOwner();
  if (!stored || stored.id !== owner.id) throw new Error("setup already complete");

  await savePage({
    path: "/",
    contentType: "markdown",
    title: "Welcome",
    body: `# Welcome

This site was just set up. Its owner writes pages here by talking to Claude.

Ask Claude to replace this page whenever you are ready.`,
  });

  return { owner: stored, recovery };
}

export async function changePassword(password: string): Promise<void> {
  const owner = await getOwner();
  if (!owner) throw new Error("not set up");
  const pw = await hashSecret(password);
  await stores.site().setJSON(KEY, { ...owner, passwordHash: pw.hash, passwordSalt: pw.salt });
}
