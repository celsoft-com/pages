import { randomToken, toBase64 } from "../crypto/random";
import {
  getClient,
  issueToken,
  readToken,
  saveClient,
  saveCode,
  saveGrant,
  takeCode,
  type Client,
} from "./store";

const ACCESS_TTL_MS = 1000 * 60 * 60;
const CODE_TTL_MS = 1000 * 60 * 5;

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "access-control-allow-origin": "*" },
  });
}

function oauthError(error: string, description: string, status = 400): Response {
  return json({ error, error_description: description }, status);
}

export function metadata(origin: string): Response {
  return json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["pages"],
  });
}

export function protectedResourceMetadata(origin: string): Response {
  return json({
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: ["pages"],
  });
}

export async function register(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return oauthError("invalid_client_metadata", "Body must be JSON");
  }

  const redirectUris = Array.isArray(body.redirect_uris) ? (body.redirect_uris as string[]) : [];
  if (redirectUris.length === 0)
    return oauthError("invalid_redirect_uri", "At least one redirect_uri is required");

  const client: Client = {
    clientId: randomToken(24),
    clientName: typeof body.client_name === "string" ? body.client_name : "Unnamed client",
    redirectUris,
    createdAt: Date.now(),
  };
  await saveClient(client);

  return json(
    {
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    201,
  );
}

export interface AuthRequest {
  client: Client;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
}

export async function parseAuthorize(url: URL): Promise<AuthRequest | Response> {
  const clientId = url.searchParams.get("client_id");
  const redirectUri = url.searchParams.get("redirect_uri");
  const challenge = url.searchParams.get("code_challenge");
  const method = url.searchParams.get("code_challenge_method");

  if (url.searchParams.get("response_type") !== "code")
    return oauthError("unsupported_response_type", "Only response_type=code is supported");
  if (!clientId) return oauthError("invalid_request", "client_id is required");
  if (!challenge || method !== "S256")
    return oauthError("invalid_request", "PKCE with code_challenge_method=S256 is required");

  const client = await getClient(clientId);
  if (!client) return oauthError("invalid_client", "Unknown client_id");

  const uri = redirectUri ?? client.redirectUris[0];
  if (!client.redirectUris.includes(uri))
    return oauthError("invalid_request", "redirect_uri does not match this client");

  return { client, redirectUri: uri, state: url.searchParams.get("state"), codeChallenge: challenge };
}

export async function completeAuthorize(auth: AuthRequest, ownerId: string): Promise<string> {
  const grantId = randomToken(16);
  await saveGrant({
    id: grantId,
    clientId: auth.client.clientId,
    clientName: auth.client.clientName,
    ownerId,
    createdAt: Date.now(),
  });

  const code = randomToken(32);
  await saveCode({
    code,
    clientId: auth.client.clientId,
    redirectUri: auth.redirectUri,
    codeChallenge: auth.codeChallenge,
    ownerId,
    expiresAt: Date.now() + CODE_TTL_MS,
  });

  const target = new URL(auth.redirectUri);
  target.searchParams.set("code", `${grantId}.${code}`);
  if (auth.state) target.searchParams.set("state", auth.state);
  return target.toString();
}

async function verifyChallenge(verifier: string, challenge: string): Promise<boolean> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const encoded = toBase64(new Uint8Array(digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return encoded === challenge;
}

export async function token(request: Request): Promise<Response> {
  const form = new URLSearchParams(await request.text());
  const grantType = form.get("grant_type");

  if (grantType === "refresh_token") {
    const refresh = form.get("refresh_token") ?? "";
    const record = await readToken(refresh);
    if (!record || record.kind !== "refresh")
      return oauthError("invalid_grant", "Refresh token is not valid");

    const access = await issueToken({
      grantId: record.grantId,
      clientId: record.clientId,
      ownerId: record.ownerId,
      kind: "access",
      expiresAt: Date.now() + ACCESS_TTL_MS,
    });
    return json({
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_MS / 1000,
      refresh_token: refresh,
    });
  }

  if (grantType !== "authorization_code")
    return oauthError("unsupported_grant_type", "Only authorization_code and refresh_token are supported");

  const combined = form.get("code") ?? "";
  const separator = combined.indexOf(".");
  if (separator < 0) return oauthError("invalid_grant", "Malformed code");
  const grantId = combined.slice(0, separator);
  const stored = await takeCode(combined.slice(separator + 1));

  if (!stored) return oauthError("invalid_grant", "Code is expired or already used");
  if (stored.clientId !== form.get("client_id"))
    return oauthError("invalid_grant", "Code was issued to a different client");
  if (!(await verifyChallenge(form.get("code_verifier") ?? "", stored.codeChallenge)))
    return oauthError("invalid_grant", "PKCE verification failed");

  const shared = { grantId, clientId: stored.clientId, ownerId: stored.ownerId };
  const [access, refresh] = await Promise.all([
    issueToken({ ...shared, kind: "access", expiresAt: Date.now() + ACCESS_TTL_MS }),
    issueToken({ ...shared, kind: "refresh", expiresAt: null }),
  ]);

  return json({
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_MS / 1000,
    refresh_token: refresh,
    scope: "pages",
  });
}

export async function authenticate(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) return null;
  const record = await readToken(header.slice(7).trim());
  return record && record.kind === "access" ? record.ownerId : null;
}
