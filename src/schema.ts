import type { Env } from "./types";

type Migration = { version: number; statements: string[] };

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS owner (
        id TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        recovery_hash TEXT NOT NULL,
        recovery_salt TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS pages (
        path TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        content_type TEXT NOT NULL CHECK (content_type IN ('markdown', 'html')),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS pages_owner_idx ON pages (owner_id, path)`,
      `CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        key TEXT NOT NULL UNIQUE,
        filename TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS assets_owner_idx ON assets (owner_id, created_at)`,
      `CREATE TABLE IF NOT EXISTS domains (
        hostname TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        custom_hostname_id TEXT,
        status TEXT NOT NULL,
        ssl_status TEXT,
        verification_errors TEXT,
        dcv_record_name TEXT,
        dcv_record_value TEXT,
        created_at INTEGER NOT NULL,
        checked_at INTEGER
      )`,
    ],
  },
];

let ensured = false;

export async function ensureSchema(env: Env): Promise<void> {
  if (ensured) return;

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`,
  ).run();

  const row = await env.DB.prepare("SELECT MAX(version) AS version FROM schema_version").first<{
    version: number | null;
  }>();
  const current = row?.version ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    await env.DB.batch([
      ...migration.statements.map((sql) => env.DB.prepare(sql)),
      env.DB.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").bind(
        migration.version,
        Date.now(),
      ),
    ]);
  }

  ensured = true;
}
