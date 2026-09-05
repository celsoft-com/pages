import { getCollection, normalizeCollectionPath } from "./service";

export async function handleData(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/data/")) return notFound();

  const raw = decodeURIComponent(url.pathname.slice("/data/".length));
  if (!raw || !/\.json$/i.test(raw)) return notFound();

  const collection = await getCollection(normalizeCollectionPath(raw));
  if (!collection) return notFound();

  const etag = `W/"${collection.rev}"`;
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=60",
    "access-control-allow-origin": "*",
    etag,
  };

  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(JSON.stringify(collection.items), { headers });
}

function notFound(): Response {
  return Response.json(
    { error: "Not found" },
    { status: 404, headers: { "access-control-allow-origin": "*" } },
  );
}
