import { contentHeaders, immutableHeaders, privateHeaders } from "../cache";
import { accessToAsset } from "../private/gate";
import { findAsset } from "./service";

// One answer for a missing asset and for one a visitor may not see, so the two cannot be told
// apart, headers included. no-store because a shared cache holding this would keep answering it
// to someone who has since been given a link.
function notFound(): Response {
  return new Response("Not found", { status: 404, headers: privateHeaders() });
}

export async function handleAsset(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const raw = decodeURIComponent(url.pathname.replace(/^\/assets\//, ""));
  if (!raw) return notFound();

  const found = await findAsset(raw);
  if (!found) return notFound();

  // Gated on the resolved asset's own path, never on the request URL: findAsset tries the blob key
  // verbatim first, so /assets/trip~map.png reaches the same bytes as /assets/trip/map.png.
  const access = await accessToAsset(request, found.asset.path);
  if (!access.open) return notFound();

  const headers: Record<string, string> = {
    "content-type": found.asset.contentType || "application/octet-stream",
    // A rooted path can be uploaded over; a hash key names the bytes themselves and never changes.
    ...(access.scope ? privateHeaders() : found.asset.path ? contentHeaders() : immutableHeaders()),
  };
  if (access.cookie) headers["set-cookie"] = access.cookie;

  return new Response(found.body, { headers });
}
