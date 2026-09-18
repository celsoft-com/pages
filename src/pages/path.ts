// / is not a bundle. Every top-level path is a peer scope, the home page included: it lives in
// this bundle and is served at /, so nothing sits above everything else.
export const ROOT_BUNDLE = "/root";

// The home page is the site's contents, generated from what is published, so it is the one page
// nobody writes, edits or deletes. It is still a path: /root is what privacy closes, what a share
// link opens and where the favicon sits, and a page blob stored there would be a second home page
// nothing serves. Every write that would make one is refused with this.
export const HOME_IS_GENERATED =
  `${ROOT_BUNDLE} is served at / as the site contents, a list of every public page, generated on every ` +
  "request. It is not stored, so it cannot be published, edited, moved onto or deleted. Publish at any " +
  "other path and it appears in the list.";

export function normalizePath(input: string): string {
  let path = input.trim();
  try {
    path = decodeURIComponent(path);
  } catch {
    // leave as-is when the caller passed raw text rather than an encoded URL
  }
  path = path.split("?")[0].split("#")[0];
  path = path.replace(/\\/g, "/");
  path = path.toLowerCase();

  const segments = path
    .split("/")
    .filter((s) => s.length > 0 && s !== ".")
    .filter((s) => s !== "..");

  if (segments.length > 0) {
    const last = segments[segments.length - 1];
    const stripped = last.replace(/\.(md|markdown|html?)$/, "");
    if (stripped.length > 0) segments[segments.length - 1] = stripped;
    if (segments[segments.length - 1] === "index") segments.pop();
  }

  if (segments.length === 0) return "/";
  return "/" + segments.join("/");
}

export function isValidPath(path: string): boolean {
  return /^\/(?:[a-z0-9._~-]+(?:\/[a-z0-9._~-]+)*)?$/.test(path);
}

// Assets keep their filename whole. The page normalizer strips .html/.md and pops a trailing
// "index", which would turn an asset at /foo/index.html into /foo and /notes.md into /notes.
export function normalizeAssetPath(input: string): string {
  let path = input.trim();
  try {
    path = decodeURIComponent(path);
  } catch {
    // leave as-is when the caller passed raw text rather than an encoded URL
  }
  path = path.split("?")[0].split("#")[0];
  path = path.replace(/\\/g, "/");
  path = path.toLowerCase();

  const segments = path.split("/").filter((s) => s.length > 0 && s !== "." && s !== "..");
  if (segments.length === 0) return "/";
  return "/" + segments.join("/");
}
