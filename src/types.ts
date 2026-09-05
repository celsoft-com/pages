import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  OAUTH_PROVIDER: OAuthHelpers;
  DB: D1Database;
  ASSETS: R2Bucket;
  OAUTH_KV: KVNamespace;
}

export interface Owner {
  id: string;
  password_hash: string;
  password_salt: string;
  recovery_hash: string;
  recovery_salt: string;
  created_at: number;
}

export type ContentType = "markdown" | "html";

export interface Page {
  path: string;
  owner_id: string;
  content_type: ContentType;
  title: string;
  body: string;
  created_at: number;
  updated_at: number;
}

export interface Asset {
  id: string;
  owner_id: string;
  key: string;
  filename: string;
  content_type: string;
  size: number;
  created_at: number;
}

export type DomainStatus = "pending" | "active" | "failed";

export interface Domain {
  hostname: string;
  owner_id: string;
  custom_hostname_id: string | null;
  status: DomainStatus;
  ssl_status: string | null;
  verification_errors: string | null;
  dcv_record_name: string | null;
  dcv_record_value: string | null;
  provider: string | null;
  created_at: number;
  checked_at: number | null;
}
