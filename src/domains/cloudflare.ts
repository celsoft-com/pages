const API = "https://api.cloudflare.com/client/v4";

export interface CfResult<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  result: T;
}

export interface CustomHostname {
  id: string;
  hostname: string;
  status: string;
  verification_errors?: string[];
  ownership_verification?: { type: string; name: string; value: string };
  ssl: {
    status: string;
    validation_errors?: { message: string }[];
    validation_records?: { txt_name?: string; txt_value?: string; status?: string }[];
  };
}

export interface Zone {
  id: string;
  name: string;
  status: string;
}

async function call<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = (await response.json()) as CfResult<T>;
  if (!body.success) {
    const message = body.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") || response.statusText;
    throw new Error(`Cloudflare API ${path} failed: ${message}`);
  }
  return body.result;
}

export function listZones(token: string): Promise<Zone[]> {
  return call<Zone[]>(token, "/zones?per_page=50");
}

export function createCustomHostname(
  token: string,
  zoneId: string,
  hostname: string,
): Promise<CustomHostname> {
  return call<CustomHostname>(token, `/zones/${zoneId}/custom_hostnames`, {
    method: "POST",
    body: JSON.stringify({
      hostname,
      ssl: { method: "txt", type: "dv", settings: { min_tls_version: "1.2" } },
    }),
  });
}

export function getCustomHostname(
  token: string,
  zoneId: string,
  id: string,
): Promise<CustomHostname> {
  return call<CustomHostname>(token, `/zones/${zoneId}/custom_hostnames/${id}`);
}

export function deleteCustomHostname(token: string, zoneId: string, id: string): Promise<unknown> {
  return call(token, `/zones/${zoneId}/custom_hostnames/${id}`, { method: "DELETE" });
}

export async function ensureFallbackRecord(
  token: string,
  zoneId: string,
  hostname: string,
): Promise<void> {
  const existing = await call<{ id: string }[]>(
    token,
    `/zones/${zoneId}/dns_records?name=${encodeURIComponent(hostname)}`,
  );
  if (existing.length > 0) return;
  await call(token, `/zones/${zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify({
      type: "A",
      name: hostname,
      content: "192.0.2.1",
      proxied: true,
      comment: "pages fallback origin",
    }),
  });
}

export function setFallbackOrigin(token: string, zoneId: string, origin: string): Promise<unknown> {
  return call(token, `/zones/${zoneId}/custom_hostnames/fallback_origin`, {
    method: "PUT",
    body: JSON.stringify({ origin }),
  });
}

export async function ensureWorkerRoute(
  token: string,
  zoneId: string,
  pattern: string,
  script: string,
): Promise<void> {
  const routes = await call<{ id: string; pattern: string }[]>(token, `/zones/${zoneId}/workers/routes`);
  if (routes.some((route) => route.pattern === pattern)) return;
  await call(token, `/zones/${zoneId}/workers/routes`, {
    method: "POST",
    body: JSON.stringify({ pattern, script }),
  });
}
