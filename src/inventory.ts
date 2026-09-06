import { listAssets } from "./assets/service";
import { contains } from "./bundle";
import { getCollection, listCollections, MANIFEST_PATH } from "./data/service";
import { ROOT_BUNDLE } from "./pages/path";
import { listPages } from "./pages/service";

export const ROOT_IS_NOT_A_BUNDLE =
  "/ is not a bundle: it would hold every page, collection and asset on the site. Every other path is. " +
  `As a page path / means ${ROOT_BUNDLE}, the home page bundle, which is served at / and lists like any other. ` +
  "Call list_pages or list_collections to see what exists.";

export interface PageEntry {
  path: string;
  title: string;
}

export interface CollectionEntry {
  path: string;
  count: number;
  rev: number;
  refs: Record<string, string>;
}

export interface AssetEntry {
  path: string | null;
  key: string;
  filename: string;
  size: number;
}

export interface BundleContents {
  path: string;
  pages: PageEntry[];
  collections: CollectionEntry[];
  assets: AssetEntry[];
}

export interface BrokenReference {
  path: string;
  field: string;
  references: string;
  count: number;
}

export async function collectionEntries(): Promise<CollectionEntry[]> {
  return (await listCollections())
    .filter((c) => c.path !== MANIFEST_PATH)
    .map((c) => ({ path: c.path, count: c.count, rev: c.rev, refs: c.refs }));
}

export async function assetEntries(): Promise<AssetEntry[]> {
  return (await listAssets()).map((a) => ({
    path: a.path ?? null,
    key: a.key,
    filename: a.filename,
    size: a.size,
  }));
}

export async function bundleContents(path: string): Promise<BundleContents> {
  const [pages, collections, assets] = await Promise.all([listPages(), collectionEntries(), assetEntries()]);

  return {
    path,
    pages: pages.filter((p) => contains(path, p.path)).map((p) => ({ path: p.path, title: p.title })),
    collections: collections.filter((c) => contains(path, c.path)),
    assets: assets.filter((a) => a.path !== null && contains(path, a.path)),
  };
}

// Records outside the bundle that point at a collection inside it. Every one of them breaks
// when the bundle goes, and the caller who reached for a bundle delete is the least likely
// to audit afterwards.
export async function referencesInto(doomed: Set<string>): Promise<BrokenReference[]> {
  const broken: BrokenReference[] = [];
  for (const summary of await listCollections()) {
    if (doomed.has(summary.path)) continue;
    for (const [field, target] of Object.entries(summary.refs)) {
      if (!doomed.has(target)) continue;
      const collection = await getCollection(summary.path);
      const count = (collection?.items ?? []).filter(
        (item) => item[field] !== null && item[field] !== undefined,
      ).length;
      broken.push({ path: summary.path, field, references: target, count });
    }
  }
  return broken;
}
