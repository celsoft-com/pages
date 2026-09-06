import { assetKeyFor, getAsset, listAssets } from "./assets/service";
import { contains, segmentsOf } from "./bundle";
import {
  getCollection,
  listCollections,
  MANIFEST_PATH,
  normalizeCollectionPath,
  writeCollectionBlob,
} from "./data/service";
import { ROOT_IS_NOT_A_BUNDLE, referencesInto, type BrokenReference } from "./inventory";
import { ROOT_BUNDLE, normalizeAssetPath, normalizePath } from "./pages/path";
import { findInPages, getPage, listPages, writePageBlob, type PageMatch } from "./pages/service";
import { encodeKey, stores } from "./store";
import type { Asset, Collection, Page } from "./types";

export type Verb = "copy" | "move" | "delete";
export type Kind = "page" | "collection" | "asset";
export type Scope = Kind | "bundle";

export interface Resource {
  kind: Kind;
  from: string;
  to: string | null;
  replaced: boolean;
  title?: string;
  items?: number;
  rev?: number;
  refs?: Record<string, string>;
  bytes?: number;
}

export interface Transfer {
  verb: Verb;
  scope: Scope;
  from: string;
  to: string | null;
  applied: boolean;
  resources: Resource[];
  breaks: BrokenReference[];
}

// One normalizer per kind of path. Asset paths keep their filename whole; the page rules
// would eat the extension and pop a trailing "index".
export function normalizeFor(scope: Scope, raw: string): string {
  if (scope === "asset") return normalizeAssetPath(raw);
  if (scope === "collection") return normalizeCollectionPath(raw);
  return normalizePath(raw);
}

interface Sources {
  pages: Page[];
  collections: Collection[];
  assets: Asset[];
}

async function gather(scope: Scope, verb: Verb, from: string): Promise<Sources> {
  if (scope === "page") {
    const page = await getPage(from);
    if (!page) throw new Error(`No page exists at ${from}`);
    return { pages: [page], collections: [], assets: [] };
  }

  if (scope === "collection") {
    if (from === MANIFEST_PATH)
      throw new Error(`${MANIFEST_PATH} is the reserved collection index and cannot be copied, moved or deleted.`);
    const collection = await getCollection(from);
    if (!collection) throw new Error(`No collection exists at ${from}`);
    return { pages: [], collections: [collection], assets: [] };
  }

  if (scope === "asset") {
    const assets = await listAssets();
    const found = assets.find((a) => a.path === from);
    if (found) return { pages: [], collections: [], assets: [found] };

    // A hash-keyed asset has no path, so it can be deleted by its key but never re-homed.
    const hashed = assets.find((a) => !a.path && `/${a.key}` === from);
    if (hashed && verb === "delete") return { pages: [], collections: [], assets: [hashed] };
    if (hashed)
      throw new Error(
        `Asset ${hashed.key} is stored under a content hash, so it has no path to ${verb} it to. Upload it ` +
          `again with a path to file it into a bundle; its current URL keeps working either way.`,
      );
    throw new Error(`No asset exists at ${from}`);
  }

  if (from === MANIFEST_PATH)
    throw new Error(`${MANIFEST_PATH} is the reserved collection index and is in no bundle.`);

  const [pages, collections, assets] = await Promise.all([listPages(), listCollections(), listAssets()]);
  const inScope: Sources = { pages: [], collections: [], assets: [] };

  for (const summary of pages)
    if (contains(from, summary.path)) {
      const page = await getPage(summary.path);
      if (page) inScope.pages.push(page);
    }
  for (const summary of collections)
    if (summary.path !== MANIFEST_PATH && contains(from, summary.path)) {
      const collection = await getCollection(summary.path);
      if (collection) inScope.collections.push(collection);
    }
  for (const asset of assets) if (asset.path && contains(from, asset.path)) inScope.assets.push(asset);

  if (inScope.pages.length + inScope.collections.length + inScope.assets.length === 0)
    throw new Error(`Nothing is at or under ${from}.`);
  return inScope;
}

function retarget(path: string, from: string, to: string): string {
  return from === to ? path : to + path.slice(from.length);
}

export async function planTransfer(input: {
  scope: Scope;
  verb: Verb;
  from: string;
  to?: string;
  overwrite?: boolean;
  ifRev?: number;
}): Promise<{ transfer: Transfer; sources: Sources; targets: Map<string, string> }> {
  const { scope, verb } = input;
  const from = normalizeFor(scope, input.from);
  const to = verb === "delete" ? null : normalizeFor(scope, String(input.to ?? ""));

  if (scope === "bundle" && (from === "/" || to === "/")) throw new Error(ROOT_IS_NOT_A_BUNDLE);

  if (to !== null) {
    if (from === to)
      throw new Error(`${from} and ${to} are the same path, so there is nothing to ${verb}.`);
    if (scope === "bundle" && (contains(from, to) || contains(to, from)))
      throw new Error(
        `${to} is nested inside ${from}, so the ${verb} would consume its own target. Pick a path outside ${from}.`,
      );
    if (scope === "collection" && to === MANIFEST_PATH)
      throw new Error(`${MANIFEST_PATH} is reserved for the index of collections. Pick another path.`);
    if (scope === "asset" && to === "/")
      throw new Error("to must name a file, for example /germanfunstuff/images/coburg.jpg");
  }

  const sources = await gather(scope, verb, from);

  const targets = new Map<string, string>();
  if (to !== null) {
    for (const page of sources.pages) targets.set(`page${page.path}`, retarget(page.path, from, to));
    for (const c of sources.collections) targets.set(`collection${c.path}`, retarget(c.path, from, to));
    for (const a of sources.assets) if (a.path) targets.set(`asset${a.path}`, retarget(a.path, from, to));
  }

  if (input.ifRev !== undefined) {
    const [collection] = sources.collections;
    if (sources.collections.length !== 1 || collection.path !== from)
      throw new Error(
        `if_rev checks one collection, but ${from} covers ${sources.collections.length}. ` +
          `Name a single collection, or drop if_rev.`,
      );
    if (collection.rev !== input.ifRev)
      throw new Error(
        `Collection ${from} has changed since you read it: you have rev ${input.ifRev}, it is now ` +
          `rev ${collection.rev}. Call list_items again before you ${verb} it.`,
      );
  }

  const occupied = await collisions(targets);
  if (occupied.length > 0 && input.overwrite !== true)
    throw new Error(
      `${occupied.join("; ")}. Nothing was changed. Pass overwrite: true to replace ` +
        `${occupied.length === 1 ? "it" : "them"}, or pick another path.`,
    );

  // A move takes the source path away, so a reference from outside the operation breaks just
  // as surely as it does on a delete. One inside is rewritten, so it does not.
  const doomed = new Set(verb === "copy" ? [] : sources.collections.map((c) => c.path));
  const breaks = doomed.size === 0 ? [] : await referencesInto(doomed);

  const resources: Resource[] = [
    ...sources.pages.map((page) => resourceFor("page", page.path, targets, { title: page.title })),
    ...sources.collections.map((c) =>
      resourceFor("collection", c.path, targets, {
        items: c.items.length,
        rev: c.rev,
        refs: rewriteRefs(c.refs, from, to, sources),
      }),
    ),
    ...sources.assets.map((a) => resourceFor("asset", a.path ?? `/${a.key}`, targets, { bytes: a.size })),
  ];

  return {
    transfer: { verb, scope, from, to, applied: false, resources, breaks },
    sources,
    targets,
  };
}

function resourceFor(kind: Kind, path: string, targets: Map<string, string>, extra: Partial<Resource>): Resource {
  return { kind, from: path, to: targets.get(`${kind}${path}`) ?? null, replaced: false, ...extra };
}

function rewriteRefs(
  refs: Record<string, string>,
  from: string,
  to: string | null,
  sources: Sources,
): Record<string, string> {
  if (to === null) return refs;
  const moving = new Set(sources.collections.map((c) => c.path));
  return Object.fromEntries(
    Object.entries(refs).map(([field, target]) => [field, moving.has(target) ? retarget(target, from, to) : target]),
  );
}

async function collisions(targets: Map<string, string>): Promise<string[]> {
  const found: string[] = [];
  for (const [source, target] of targets) {
    const kind = source.slice(0, source.indexOf("/")) as Kind;
    if (kind === "page" && (await getPage(target))) found.push(`a page already exists at ${target}`);
    if (kind === "collection") {
      const held = await getCollection(target);
      if (held) found.push(`${target} already holds ${held.items.length} item${held.items.length === 1 ? "" : "s"}`);
    }
    if (kind === "asset" && (await getAsset(assetKeyFor(target)))) found.push(`an asset already exists at ${target}`);
  }
  return found;
}

interface Write {
  run: () => Promise<unknown>;
  undo: () => Promise<unknown>;
}

export async function applyTransfer(plan: {
  transfer: Transfer;
  sources: Sources;
  targets: Map<string, string>;
}): Promise<Transfer> {
  const { transfer, sources, targets } = plan;
  const move = transfer.verb === "move";
  const now = Date.now();
  const writes: Write[] = [];

  // Everything is read and staged before a single byte is written, so a source that vanishes
  // partway costs no writes and a failed write can be unwound.
  for (const page of sources.pages) {
    const target = targets.get(`page${page.path}`);
    if (target === undefined) continue;
    const prior = await getPage(target);
    const key = encodeKey(target);
    const next: Page = {
      ...page,
      path: target,
      createdAt: move ? page.createdAt : (prior?.createdAt ?? now),
      updatedAt: now,
    };
    mark(transfer, "page", page.path, prior !== null);
    writes.push({
      run: () => writePageBlob(key, next),
      undo: () => (prior ? writePageBlob(key, prior) : stores.pages().delete(key)),
    });
  }

  for (const collection of sources.collections) {
    const target = targets.get(`collection${collection.path}`);
    if (target === undefined) continue;
    const prior = await getCollection(target);
    const key = encodeKey(target);
    // A replaced collection must never hand back a rev someone already holds.
    const rev = move ? Math.max(collection.rev, (prior?.rev ?? 0) + 1) : (prior?.rev ?? 0) + 1;
    const next: Collection = {
      path: target,
      items: collection.items,
      refs: transfer.resources.find((r) => r.kind === "collection" && r.from === collection.path)!.refs!,
      rev,
      revs: move ? collection.revs : Object.fromEntries(collection.items.map((item) => [item.id, rev])),
      createdAt: move ? collection.createdAt : (prior?.createdAt ?? now),
      updatedAt: now,
    };
    mark(transfer, "collection", collection.path, prior !== null);
    writes.push({
      run: () => writeCollectionBlob(key, next),
      undo: () => (prior ? writeCollectionBlob(key, prior) : stores.data().delete(key)),
    });
  }

  for (const asset of sources.assets) {
    const target = targets.get(`asset${asset.path}`);
    if (target === undefined) continue;
    const held = await getAsset(asset.key);
    if (!held) throw new Error(`Asset ${asset.path} disappeared before the ${transfer.verb} began.`);
    const key = assetKeyFor(target);
    const prior = await getAsset(key);
    const next: Asset = {
      ...asset,
      key,
      path: target,
      createdAt: move ? asset.createdAt : now,
    };
    mark(transfer, "asset", asset.path ?? `/${asset.key}`, prior !== null);
    writes.push({
      run: () => stores.assets().set(key, held.body, { metadata: { ...next } }),
      undo: () =>
        prior
          ? stores.assets().set(key, prior.body, { metadata: { ...prior.asset } })
          : stores.assets().delete(key),
    });
  }

  if (transfer.verb !== "copy") {
    for (const page of sources.pages) {
      const key = encodeKey(page.path);
      writes.push({ run: () => stores.pages().delete(key), undo: () => writePageBlob(key, page) });
    }
    for (const collection of sources.collections) {
      const key = encodeKey(collection.path);
      writes.push({ run: () => stores.data().delete(key), undo: () => writeCollectionBlob(key, collection) });
    }
    for (const asset of sources.assets) {
      const held = await getAsset(asset.key);
      if (!held) continue;
      writes.push({
        run: () => stores.assets().delete(asset.key),
        undo: () => stores.assets().set(asset.key, held.body, { metadata: { ...held.asset } }),
      });
    }
  }

  const done: Write[] = [];
  try {
    for (const write of writes) {
      await write.run();
      done.push(write);
    }
  } catch (error) {
    for (const write of done.reverse())
      try {
        await write.undo();
      } catch {
        // one failed rollback step must not strand the rest
      }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`The ${transfer.verb} failed partway and was rolled back: ${reason}`);
  }

  return { ...transfer, applied: true };
}

function mark(transfer: Transfer, kind: Kind, from: string, replaced: boolean): void {
  const resource = transfer.resources.find((r) => r.kind === kind && r.from === from);
  if (resource) resource.replaced = replaced;
}

// A bundle touches more than one thing at a time, so it never applies without being asked twice.
export function needsConfirmation(transfer: Transfer): boolean {
  return transfer.scope === "bundle";
}

export async function runTransfer(input: {
  scope: Scope;
  verb: Verb;
  from: string;
  to?: string;
  overwrite?: boolean;
  confirm?: boolean;
  ifRev?: number;
}): Promise<Transfer> {
  const plan = await planTransfer(input);
  if (needsConfirmation(plan.transfer) && input.confirm !== true) return plan.transfer;
  return applyTransfer(plan);
}

function escape(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A page hardcodes the URLs it fetches, so anything the transfer takes away strands whoever
// still names it. The exact URL catches fetch('/data/trip/items.json'); the parent catches a
// const BASE = "/data/trip/". A page path is matched on segment boundaries so that a link to
// /trip does not report for /tripwire, and a link to /trip/day1 does not report for /trip.
export function stalePatterns(transfer: Transfer): RegExp[] {
  const patterns: RegExp[] = [];
  const prefixed = (root: string, path: string) => {
    patterns.push(new RegExp(escape(`${root}${path}`)));
    const parent = path.slice(0, path.lastIndexOf("/"));
    if (parent.length > 0) patterns.push(new RegExp(escape(`${root}${parent}/`)));
  };

  for (const resource of transfer.resources) {
    if (resource.to === resource.from) continue;
    // / names no resource. As a pattern it is a bare slash, which matches a CSS comment, a
    // regex literal and a division, so a page stored there is reported as breaking everything.
    if (segmentsOf(resource.from).length === 0) continue;
    if (resource.kind === "collection") prefixed("/data", resource.from);
    if (resource.kind === "asset") prefixed("/assets", resource.from);
    if (resource.kind === "page")
      patterns.push(new RegExp(`(?<![A-Za-z0-9._~-])${escape(resource.from)}(?![A-Za-z0-9._~/-])`));
  }
  return patterns;
}

// /root is served at /, so moving or deleting it changes what a browser gets at the site root.
export function touchesHomePage(transfer: Transfer): boolean {
  return transfer.verb !== "copy" && transfer.resources.some((r) => r.kind === "page" && r.from === ROOT_BUNDLE);
}

export async function staleReferences(transfer: Transfer): Promise<PageMatch[]> {
  if (transfer.verb === "copy") return [];
  return findInPages(stalePatterns(transfer));
}
