import { assetKeyFor, getAsset } from "./assets/service";
import { DEFAULT_FAVICON } from "./favicon-default";
import { ROOT_BUNDLE } from "./pages/path";
import type { Asset } from "./types";

// The site icon is a convention, not a setting: an asset named favicon.<ext> in the /root bundle
// is it. First name found wins, so uploading favicon.png to /root is the whole of changing it.
export const FAVICON_NAMES = ["favicon.ico", "favicon.svg", "favicon.png", "favicon.webp", "favicon.jpg"];

export async function findFavicon(): Promise<{ body: ArrayBuffer; asset: Asset } | null> {
  for (const name of FAVICON_NAMES) {
    const found = await getAsset(assetKeyFor(`${ROOT_BUNDLE}/${name}`));
    if (found) return found;
  }
  return null;
}

function defaultBytes(): ArrayBuffer {
  const binary = atob(DEFAULT_FAVICON.base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// Served at /favicon.ico whatever the real type, because a stored HTML page is verbatim and
// carries no link tag: the well-known URL is the only handle a browser has on those pages.
export async function handleFavicon(): Promise<Response> {
  const found = await findFavicon();
  return new Response(found ? found.body : defaultBytes(), {
    headers: {
      "content-type": (found ? found.asset.contentType : DEFAULT_FAVICON.contentType) || "image/x-icon",
      "cache-control": "public, max-age=600",
    },
  });
}
