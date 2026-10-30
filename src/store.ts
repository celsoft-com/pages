// Where each kind of resource lives in app.files. A path's own slashes become folders, so a bundle
// is a folder there too. The file is the truth; the row in the matching summary table is written
// after it by the one function that writes each kind, and deleted after it, so a listing can miss a
// file for a moment but never name one that is not there for long.

export function pageFile(path: string): string {
  return `pages${path}.json`;
}

// A collection may sit at /, which has no name of its own to file under.
export function collectionFile(path: string): string {
  return path === "/" ? "data/_root.json" : `data${path}.json`;
}

export function assetFile(key: string): string {
  return `assets/${key}`;
}

export function encodeKey(path: string): string {
  if (path === "/") return "_root";
  return path.replace(/^\//, "").replace(/\//g, "~");
}
