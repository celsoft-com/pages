import { findAsset } from "./service";

export async function handleAsset(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const raw = decodeURIComponent(url.pathname.replace(/^\/assets\//, ""));
  if (!raw) return new Response("Not found", { status: 404 });

  const found = await findAsset(raw);
  if (!found) return new Response("Not found", { status: 404 });

  return new Response(found.body, {
    headers: {
      "content-type": found.asset.contentType || "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
