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
