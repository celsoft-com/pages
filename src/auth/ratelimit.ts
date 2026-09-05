import type { Env } from "../types";

const WINDOW_SECONDS = 900;
const MAX_ATTEMPTS = 8;

export async function checkRateLimit(env: Env, bucket: string): Promise<boolean> {
  const key = `ratelimit:${bucket}`;
  const current = Number((await env.OAUTH_KV.get(key)) ?? "0");
  return current < MAX_ATTEMPTS;
}

export async function recordFailure(env: Env, bucket: string): Promise<void> {
  const key = `ratelimit:${bucket}`;
  const current = Number((await env.OAUTH_KV.get(key)) ?? "0");
  await env.OAUTH_KV.put(key, String(current + 1), { expirationTtl: WINDOW_SECONDS });
}

export async function clearFailures(env: Env, bucket: string): Promise<void> {
  await env.OAUTH_KV.delete(`ratelimit:${bucket}`);
}

export function clientBucket(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}
