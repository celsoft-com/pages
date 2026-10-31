import { inArray } from "drizzle-orm";
import { assetKeyFor } from "./assets/service";
import { DEFAULT_FAVICON } from "./favicon-default";
import { ROOT_BUNDLE } from "./pages/path";
import type { PagesApp } from "./pages-app";
import { assets } from "./schema";
import { assetFile } from "./store";

// The site icon is a convention, not a setting: an asset named favicon.<ext> in the /root bundle
// is it. First name found wins, so uploading favicon.png to /root is the whole of changing it.
export const FAVICON_NAMES = ["favicon.ico", "favicon.svg", "favicon.png", "favicon.webp", "favicon.jpg"];
const KEYS = FAVICON_NAMES.map((name) => assetKeyFor(`${ROOT_BUNDLE}/${name}`));

const defaultBytes = () => Uint8Array.from(atob(DEFAULT_FAVICON.base64), (c) => c.charCodeAt(0));

// Served at /favicon.ico whatever the real type, because a stored HTML page is verbatim and
// carries no link tag: the well-known URL is the only handle a browser has on those pages.
export async function favicon(app: PagesApp): Promise<Response> {
  const rows = await app.db.select({ key: assets.key }).from(assets).where(inArray(assets.key, KEYS));
  const found = KEYS.find((key) => rows.some((row) => row.key === key));
  if (found) return app.files.response(assetFile(found));
  return new Response(defaultBytes(), { headers: { "content-type": DEFAULT_FAVICON.contentType } });
}
