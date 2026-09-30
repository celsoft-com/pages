// / is not a bundle. Every top-level path is a peer scope, the home page included: it lives in
// this bundle and is served at /, so nothing sits above everything else.
export const ROOT_BUNDLE = "/root";

// The home page is stored at /root and served at /. / itself is never a page path: it would be a
// second name for the same page, and a scope at / would hold the whole site.
export const HOME_IS_AT_ROOT =
  `The home page is stored at ${ROOT_BUNDLE} and served at /. Publish at ${ROOT_BUNDLE} to write one; ` +
  "until one exists, / serves the generated contents, a list of every public page.";

// What a read of /root says when nothing is stored there. It is not missing: / is serving the
// generated contents, and a client told only that nothing is there cannot tell that from a lost page.
export const HOME_IS_GENERATED =
  `No page is stored at ${ROOT_BUNDLE}, so / serves the generated contents, a list of every public page. ` +
  `Publish at ${ROOT_BUNDLE} to replace it with a home page of your own.`;

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
