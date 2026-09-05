import { stores } from "../store";

const WINDOW_MS = 1000 * 60 * 15;
const MAX_ATTEMPTS = 8;

interface Bucket {
  count: number;
  resetAt: number;
}

export async function checkRateLimit(bucket: string): Promise<boolean> {
  const stored = (await stores.site().get(`ratelimit/${bucket}`, { type: "json" })) as Bucket | null;
  if (!stored || stored.resetAt < Date.now()) return true;
  return stored.count < MAX_ATTEMPTS;
}

export async function recordFailure(bucket: string): Promise<void> {
  const key = `ratelimit/${bucket}`;
  const stored = (await stores.site().get(key, { type: "json" })) as Bucket | null;
  const fresh = !stored || stored.resetAt < Date.now();
  await stores.site().setJSON(key, {
    count: fresh ? 1 : stored.count + 1,
    resetAt: fresh ? Date.now() + WINDOW_MS : stored.resetAt,
  });
}

export async function clearFailures(bucket: string): Promise<void> {
  await stores.site().delete(`ratelimit/${bucket}`);
}

export function clientBucket(request: Request): string {
  const ip =
    request.headers.get("x-nf-client-connection-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown";
  return encodeURIComponent(ip);
}
