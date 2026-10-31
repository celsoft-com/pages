import type { App } from "@celsoft/platform";
import { segmentsOf } from "./bundle";
import type * as schema from "./schema";

export type PagesApp = App<typeof schema>;

// Everything on the site hangs off this point, so the owner manages all of it and everyone reads.
export const SITE_POINT = "site";

// A private path is the one point a path has of its own, so a path is gated by the nearest point at
// or above it, and by the site when none is private. The platform checks the first that exists.
export function pointsFor(path: string): string[] {
  const segments = segmentsOf(path);
  return [...segments.map((_, i) => `path:/${segments.slice(0, segments.length - i).join("/")}`), SITE_POINT];
}
