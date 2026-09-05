import { getAsset } from "./service";

export async function handleAsset(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const key = decodeURIComponent(url.pathname.replace(/^\/assets\//, ""));
  if (!key) return new Response("Not found", { status: 404 });

  const found = await getAsset(key);
  if (!found) return new Response("Not found", { status: 404 });

  return new Response(found.body, {
    headers: {
      "content-type": found.asset.contentType || "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
