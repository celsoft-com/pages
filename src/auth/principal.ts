import { readToken } from "../oauth/store";
import { checkRateLimit, clientBucket, recordFailure } from "./ratelimit";
import { getOwner } from "./setup";
import { readApiToken } from "./tokens";
import type { Access } from "../types";

// Who is calling, resolved from one Authorization header by one function, whichever door the
// request arrived at. That is why an OAuth access token reaches the REST surface and a minted token
// reaches /mcp: there is one resolver, not a rule per surface. The access level rides on the
// credential, so a read-only token behaves the same at either door.
export interface Principal {
  ownerId: string;
  access: Access;
  source: "oauth" | "token";
}

export function bearerOf(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) return null;
  const value = header.slice(7).trim();
  return value === "" ? null : value;
}

// Looked up in storage on every request rather than trusted from a signature, so revoking either
// kind of credential takes effect on the holder's next call. That is the same trade the share-link
// grant makes, and the reason it is worth one read.
export async function resolve(request: Request): Promise<Principal | null> {
  const bearer = bearerOf(request);
  if (!bearer) return null;

  const grant = await readToken(bearer);
  if (grant) return grant.kind === "access" ? { ownerId: grant.ownerId, access: "write", source: "oauth" } : null;

  const token = await readApiToken(bearer);
  if (!token) return null;

  // Before setup there is nobody to act as, and a token cannot exist without an owner having minted it.
  const owner = await getOwner();
  return owner ? { ownerId: owner.id, access: token.access, source: "token" } : null;
}

export type Admission =
  | { ok: true; principal: Principal }
  | { ok: false; limited: boolean };

// A bearer credential is guessable in a way an interactive login is not: there is nobody to slow
// down, so an attacker can spend the whole window. This is the same counter the admin login uses,
// under its own key so a cron job with a stale token cannot lock its owner out of their own admin.
//
// The check reads one blob before the credential lookup, which is the point: a limited address is
// refused without the site doing the work. A successful call writes nothing, so a service polling
// every minute pays one read and the window expires on its own.
export async function admit(request: Request): Promise<Admission> {
  const bucket = `api:${clientBucket(request)}`;
  if (!(await checkRateLimit(bucket))) return { ok: false, limited: true };

  const principal = await resolve(request);
  if (principal) return { ok: true, principal };

  await recordFailure(bucket);
  return { ok: false, limited: false };
}
