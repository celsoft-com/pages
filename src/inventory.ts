import { deleteAsset, listAssets } from "./assets/service";
import { contains, ownerOf, wouldBeOwner } from "./bundle";
import { deleteCollection, getCollection, listCollections, MANIFEST_PATH } from "./data/service";
import { ROOT_BUNDLE } from "./pages/path";
import { deletePage, listPages, pagePaths } from "./pages/service";

export interface PageEntry {
  path: string;
  title: string;
  owner: string | null;
}

export interface CollectionEntry {
  path: string;
  count: number;
  rev: number;
  refs: Record<string, string>;
  owner: string | null;
}

export interface AssetEntry {
  path: string | null;
  key: string;
  filename: string;
  size: number;
  owner: string | null;
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

export const ROOT_IS_NOT_A_BUNDLE =
  "/ is not a bundle. There is no root scope: every top-level path is its own scope, the home page included, " +
  `which lives at ${ROOT_BUNDLE} and is served at /. Call list_pages or list_ungrouped to see what exists.`;

function ownable(path: string): boolean {
  return path !== MANIFEST_PATH;
}

export async function ownedCollections(): Promise<CollectionEntry[]> {
  const [pages, collections] = await Promise.all([pagePaths(), listCollections()]);
  return collections.filter((c) => ownable(c.path)).map((c) => ({
    path: c.path,
    count: c.count,
    rev: c.rev,
    refs: c.refs,
    owner: ownerOf(c.path, pages),
  }));
}

export async function ownedAssets(): Promise<AssetEntry[]> {
  const [pages, assets] = await Promise.all([pagePaths(), listAssets()]);
  return assets.map((a) => ({
    path: a.path ?? null,
    key: a.key,
    filename: a.filename,
    size: a.size,
    owner: a.path ? ownerOf(a.path, pages) : null,
  }));
}

export async function bundleContents(path: string): Promise<BundleContents> {
  const [pages, collections, assets] = await Promise.all([listPages(), ownedCollections(), ownedAssets()]);
  const paths = pages.map((p) => p.path);

  return {
    path,
    pages: pages
      .filter((p) => p.path !== "/" && contains(path, p.path))
      .map((p) => ({
        path: p.path,
        title: p.title,
        owner: ownerOf(p.path, paths.filter((other) => other !== p.path)),
      })),
    collections: collections.filter((c) => contains(path, c.path)),
    assets: assets.filter((a) => a.path !== null && contains(path, a.path)),
  };
}

export async function ungrouped(): Promise<{
  collections: (CollectionEntry & { wouldBeOwner: string | null })[];
  assets: (AssetEntry & { wouldBeOwner: string | null })[];
}> {
  const [collections, assets] = await Promise.all([ownedCollections(), ownedAssets()]);
  return {
    collections: collections
      .filter((c) => c.owner === null)
      .map((c) => ({ ...c, wouldBeOwner: wouldBeOwner(c.path) })),
    assets: assets
      .filter((a) => a.owner === null)
      .map((a) => ({ ...a, wouldBeOwner: a.path ? wouldBeOwner(a.path) : null })),
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

export interface BundlePlan extends BundleContents {
  breaks: BrokenReference[];
}

export async function planBundleDelete(path: string): Promise<BundlePlan> {
  if (path === "/") throw new Error(ROOT_IS_NOT_A_BUNDLE);
  if (path === MANIFEST_PATH) throw new Error(`${MANIFEST_PATH} is the reserved collection index and cannot be deleted.`);

  const contents = await bundleContents(path);
  const breaks = await referencesInto(new Set(contents.collections.map((c) => c.path)));
  return { ...contents, breaks };
}

export async function applyBundleDelete(plan: BundlePlan): Promise<void> {
  for (const collection of plan.collections) await deleteCollection(collection.path);
  for (const asset of plan.assets) await deleteAsset(asset.key);
  for (const page of plan.pages) await deletePage(page.path);
}
