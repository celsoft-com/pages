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
