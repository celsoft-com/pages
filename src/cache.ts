import { purgeCache } from "@netlify/functions";

// Every public response's caching lives here, and so does the purge. One definition, so the header
// a handler sends and the thing the purge clears cannot drift apart.
const TAG = "content";

const MAX_AGE = 300;

// A path an owner can overwrite: cached at the edge, never in a browser, cleared on any write.
export function contentHeaders(): Record<string, string> {
  return {
    "cache-control": "no-cache",
    "netlify-cdn-cache-control": `public, s-maxage=${MAX_AGE}, stale-while-revalidate=60, durable`,
    "netlify-cache-tag": TAG,
  };
}

// A content-addressed URL: the bytes behind it can never change, so nothing has to expire it.
export function immutableHeaders(): Record<string, string> {
  return {
    "cache-control": "public, max-age=31536000, immutable",
    "netlify-cdn-cache-control": "public, max-age=31536000, durable, immutable",
  };
}

// Reads, and the OAuth dance, which changes nothing a browser can see.
const READ_ONLY = [
  "/oauth/register",
  "/oauth/token",
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-protected-resource",
];

// Deliberately blind to what changed. A write goes through savePage, or through the transfer engine
// writing blobs itself, and asking either of them to report a change is a rule one of them will
// forget: the request is the one thing both pass through.
export function changedContent(request: Request, path: string, response: Response): boolean {
  if (request.method === "GET" || request.method === "HEAD") return false;
  if (response.status >= 400) return false;
  return !READ_ONLY.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

// Off outside the Netlify runtime, where there is no cache to clear and no credentials to do it with.
export async function purgeContent(): Promise<void> {
  if (!process.env.SITE_ID) return;
  try {
    await purgeCache({ tags: [TAG] });
  } catch (error) {
    console.warn(`cache purge failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
