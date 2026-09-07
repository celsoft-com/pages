import { contentHeaders, privateHeaders } from "../cache";
import { accessTo } from "../private/gate";
import { getPrivacy, privateScope } from "../private/service";
import { getCollection, manifest, MANIFEST_PATH, normalizeCollectionPath } from "./service";

export async function handleData(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/data/")) return notFound();

  const raw = decodeURIComponent(url.pathname.slice("/data/".length));
  if (!raw || !/\.json$/i.test(raw)) return notFound();

  const path = normalizeCollectionPath(raw);
  if (path === MANIFEST_PATH) return serveManifest(request);

  const access = await accessTo(request, path);
  if (!access.open) return notFound();

  const collection = await getCollection(path);
  if (!collection) return notFound();

  const etag = `W/"${collection.rev}"`;
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    ...(access.scope
      ? // No wildcard origin on a private collection. The page that reads it is same-origin, so it
        // needs none, and handing one out invites another site to try the visitor's cookie.
        privateHeaders()
      : { ...contentHeaders(), "access-control-allow-origin": "*" }),
    etag,
  };
  if (access.cookie) headers["set-cookie"] = access.cookie;

  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(JSON.stringify(collection.items), { headers });
}

// The index is public and cached, so a private collection is left out of it for everyone, grant
// holders included: one body is served to every caller, and it cannot name what most may not read.
// A page that needs a private collection knows its path already.
async function serveManifest(request: Request): Promise<Response> {
  const privacy = await getPrivacy();
  const collections = (await manifest()).filter((c) => !privateScope(privacy, c.path));
  const body = JSON.stringify(collections);
  const etag = `W/"m${collections.reduce((sum, c) => sum + c.rev, collections.length)}"`;
  const headers = {
    "content-type": "application/json; charset=utf-8",
    ...contentHeaders(),
    "access-control-allow-origin": "*",
    etag,
  };

  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
}

// One answer for a collection that does not exist and one a visitor may not see, headers included,
// so nothing here says which it was.
function notFound(): Response {
  return Response.json(
    { error: "Not found" },
    { status: 404, headers: { "access-control-allow-origin": "*", ...privateHeaders() } },
  );
}
