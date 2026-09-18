// The URL a browser is actually on, which is not the one the function is handed. Anything that
// terminates TLS in front of this code forwards a plain http request, so the scheme has to come
// from x-forwarded-proto or every URL the site hands out names something the visitor is not on:
// a share link, the OAuth metadata, the MCP connector URL. It is one helper because those five
// places were five copies of `${url.protocol}//${url.host}` and a sixth would have been written
// the same way.
//
// The header is taken on trust, as x-forwarded-for already is in the rate limiter. A forged one
// can only make a generated link say http, and http is where it would have been anyway.
export function publicUrl(request: Request): URL {
  const url = new URL(request.url);
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0].trim().toLowerCase();
  if (forwarded === "https" || forwarded === "http") url.protocol = `${forwarded}:`;
  return url;
}

export function originOf(url: URL): string {
  return `${url.protocol}//${url.host}`;
}
