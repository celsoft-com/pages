import { open } from "../crypto/secretbox";
import { getSetting, SETTING, setSetting } from "../settings";
import type { Domain, Env } from "../types";
import {
  createCustomHostname,
  deleteCustomHostname,
  ensureFallbackRecord,
  ensureWorkerRoute,
  getCustomHostname,
  setFallbackOrigin,
  type CustomHostname,
} from "./cloudflare";
import type { DnsRecord } from "./instructions";

export interface DomainConfig {
  token: string;
  zoneId: string;
  fallbackOrigin: string;
}

export async function getDomainConfig(env: Env): Promise<DomainConfig | null> {
  const [sealed, zoneId, fallbackOrigin] = await Promise.all([
    getSetting(env, SETTING.cfApiToken),
    getSetting(env, SETTING.cfZoneId),
    getSetting(env, SETTING.fallbackOrigin),
  ]);
  if (!sealed || !zoneId || !fallbackOrigin) return null;
  return { token: await open(env, sealed), zoneId, fallbackOrigin };
}

export async function configureProviderZone(
  env: Env,
  input: { token: string; zoneId: string; zoneName: string; scriptName: string },
): Promise<string> {
  const origin = `pages-origin.${input.zoneName}`;
  await ensureFallbackRecord(input.token, input.zoneId, origin);
  await setFallbackOrigin(input.token, input.zoneId, origin);
  await ensureWorkerRoute(input.token, input.zoneId, `${origin}/*`, input.scriptName);
  await setSetting(env, SETTING.fallbackOrigin, origin);
  return origin;
}

function recordsFor(hostname: string, config: DomainConfig, ch: CustomHostname): DnsRecord[] {
  const records: DnsRecord[] = [
    {
      type: "CNAME",
      name: hostname,
      value: config.fallbackOrigin,
      purpose: "Sends visitors to your site",
    },
  ];
  const dcv = ch.ssl?.validation_records?.find((r) => r.txt_name && r.txt_value);
  if (dcv?.txt_name && dcv.txt_value) {
    records.push({
      type: "TXT",
      name: dcv.txt_name,
      value: dcv.txt_value,
      purpose: "Proves you own the domain so the certificate can be issued",
    });
  }
  return records;
}

function applyState(ch: CustomHostname): Partial<Domain> {
  const dcv = ch.ssl?.validation_records?.find((r) => r.txt_name && r.txt_value);
  const errors = [
    ...(ch.verification_errors ?? []),
    ...(ch.ssl?.validation_errors ?? []).map((e) => e.message),
  ];
  const active = ch.status === "active" && ch.ssl?.status === "active";
  return {
    custom_hostname_id: ch.id,
    status: active ? "active" : errors.length > 0 ? "failed" : "pending",
    ssl_status: ch.ssl?.status ?? null,
    verification_errors: errors.length ? errors.join("; ") : null,
    dcv_record_name: dcv?.txt_name ?? null,
    dcv_record_value: dcv?.txt_value ?? null,
  };
}

export async function listDomains(env: Env): Promise<Domain[]> {
  const { results } = await env.DB.prepare("SELECT * FROM domains ORDER BY created_at").all<Domain>();
  return results;
}

export async function addDomain(
  env: Env,
  ownerId: string,
  hostname: string,
  provider = "generic",
): Promise<{ domain: Domain; records: DnsRecord[] }> {
  const config = await getDomainConfig(env);
  if (!config) throw new Error("Custom domains are not configured yet. Finish domain setup first.");

  const normalized = hostname.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const ch = await createCustomHostname(config.token, config.zoneId, normalized);
  const state = applyState(ch);

  await env.DB.prepare(
    `INSERT INTO domains (hostname, owner_id, custom_hostname_id, status, ssl_status, verification_errors,
       dcv_record_name, dcv_record_value, provider, created_at, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(hostname) DO UPDATE SET
       custom_hostname_id = excluded.custom_hostname_id,
       status = excluded.status,
       ssl_status = excluded.ssl_status,
       verification_errors = excluded.verification_errors,
       dcv_record_name = excluded.dcv_record_name,
       dcv_record_value = excluded.dcv_record_value,
       provider = excluded.provider,
       checked_at = excluded.checked_at`,
  )
    .bind(
      normalized,
      ownerId,
      state.custom_hostname_id ?? null,
      state.status ?? "pending",
      state.ssl_status ?? null,
      state.verification_errors ?? null,
      state.dcv_record_name ?? null,
      state.dcv_record_value ?? null,
      provider,
      Date.now(),
      Date.now(),
    )
    .run();

  const domain = await env.DB.prepare("SELECT * FROM domains WHERE hostname = ?")
    .bind(normalized)
    .first<Domain>();
  if (!domain) throw new Error(`domain write failed for ${normalized}`);

  return { domain, records: recordsFor(normalized, config, ch) };
}

export async function refreshDomain(env: Env, domain: Domain): Promise<Domain> {
  const config = await getDomainConfig(env);
  if (!config || !domain.custom_hostname_id) return domain;

  const ch = await getCustomHostname(config.token, config.zoneId, domain.custom_hostname_id);
  const state = applyState(ch);
  await env.DB.prepare(
    `UPDATE domains SET status = ?, ssl_status = ?, verification_errors = ?,
       dcv_record_name = ?, dcv_record_value = ?, checked_at = ? WHERE hostname = ?`,
  )
    .bind(
      state.status ?? "pending",
      state.ssl_status ?? null,
      state.verification_errors ?? null,
      state.dcv_record_name ?? null,
      state.dcv_record_value ?? null,
      Date.now(),
      domain.hostname,
    )
    .run();

  return { ...domain, ...state } as Domain;
}

export async function refreshPendingDomains(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM domains WHERE status != 'active'",
  ).all<Domain>();
  for (const domain of results) {
    try {
      await refreshDomain(env, domain);
    } catch {
      // a transient Cloudflare error should not stop the rest of the sweep
    }
  }
}

export async function removeDomain(env: Env, hostname: string): Promise<void> {
  const domain = await env.DB.prepare("SELECT * FROM domains WHERE hostname = ?")
    .bind(hostname)
    .first<Domain>();
  if (!domain) return;

  const config = await getDomainConfig(env);
  if (config && domain.custom_hostname_id) {
    try {
      await deleteCustomHostname(config.token, config.zoneId, domain.custom_hostname_id);
    } catch {
      // removing the local record is still correct if Cloudflare already dropped it
    }
  }
  await env.DB.prepare("DELETE FROM domains WHERE hostname = ?").bind(hostname).run();
}

export async function domainRecords(env: Env, domain: Domain): Promise<DnsRecord[]> {
  const config = await getDomainConfig(env);
  if (!config) return [];
  const records: DnsRecord[] = [
    {
      type: "CNAME",
      name: domain.hostname,
      value: config.fallbackOrigin,
      purpose: "Sends visitors to your site",
    },
  ];
  if (domain.dcv_record_name && domain.dcv_record_value) {
    records.push({
      type: "TXT",
      name: domain.dcv_record_name,
      value: domain.dcv_record_value,
      purpose: "Proves you own the domain so the certificate can be issued",
    });
  }
  return records;
}
