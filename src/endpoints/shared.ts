import { EndpointError } from "@celsoft/platform";
import { isValidPath, normalizePath, ROOT_BUNDLE } from "../pages/path";
import type { PagesApp } from "../pages-app";
import { SITE_POINT } from "../pages-app";

export const site = () => SITE_POINT;

export const BUNDLES =
  "Organization is a folder tree and nothing more. A path is a bundle and holds everything at or under it: /trip " +
  "holds /trip/items, /trip/images/photo.jpg and /trip/day1/items alike, and /trip/day1 holds that last one too. " +
  "Pages, collections and assets are all just resources at paths. None of them owns or belongs to another, there " +
  "is no owner and no owning page, and nothing is ever unfiled or ungrouped: a resource's own path already says " +
  "which bundles hold it, so publishing a page at /trip changes nothing about what is under /trip. Matching is on " +
  "whole path segments, so /photos does not hold /photos-archive/lessons. One exception: / is not a bundle, " +
  "because it would hold the entire site. A resource may still sit at /. What a browser gets at / is the page " +
  "stored at /root, or the site contents, a generated list of every public page, until one is published there. " +
  "The /root bundle is otherwise an ordinary folder holding the home page, the favicon and whatever else is filed " +
  "there. This is organization only, never a boundary: " +
  "nothing is rejected, moved or blocked by it, " +
  "any page may fetch any collection, and references may cross bundles.";

export function requirePath(raw: string, normalize: (input: string) => string = normalizePath): string {
  if (raw.trim() === "") throw new EndpointError(400, "path is required");
  const path = normalize(raw);
  if (!isValidPath(path))
    throw new EndpointError(
      400,
      `path "${raw}" is not usable. Use lowercase letters, numbers, dashes and slashes, for example /about`,
    );
  return path;
}

// Pages are served under /p, and /root is the home page at /, so a link to it is never a second URL.
export function urlFor(app: PagesApp, path: string): string {
  return `${app.env.APP_URL}${path === "/" || path === ROOT_BUNDLE ? "/" : `/p${path}`}`;
}

export function dataUrl(app: PagesApp, path: string): string {
  return `${app.env.APP_URL}/data${path === "/" ? "/index" : path}.json`;
}
