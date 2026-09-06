// A bundle is a path plus everything at or under it. Matching is on segment boundaries,
// never string prefixes: /bavaria does not contain /bavaria-lessons/lessons.
export function segmentsOf(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

export function contains(prefix: string, path: string): boolean {
  const outer = segmentsOf(prefix);
  const inner = segmentsOf(path);
  if (inner.length < outer.length) return false;
  return outer.every((segment, i) => inner[i] === segment);
}

// The owner is the nearest page above a resource. "/" is above everything, so it owns nothing.
export function ownerOf(path: string, pagePaths: Iterable<string>): string | null {
  let best: string | null = null;
  for (const page of pagePaths) {
    if (page === "/") continue;
    if (!contains(page, path)) continue;
    if (best === null || segmentsOf(page).length > segmentsOf(best).length) best = page;
  }
  return best;
}

// The path a resource would be owned at if a page were published there: its first segment.
export function wouldBeOwner(path: string): string | null {
  const [first] = segmentsOf(path);
  return first ? `/${first}` : null;
}
