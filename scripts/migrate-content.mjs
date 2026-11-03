#!/usr/bin/env node
// Copies a pages site's content onto another, through the target's API with a manage token.
//
//   node scripts/migrate-content.mjs --source <url|dir> --token-env NAME --target <url> [--target-token-env NAME] [--dry-run]
//   node scripts/migrate-content.mjs --source <url|dir> --token-env NAME --export <dir>
//
// The source is a site URL, read with the token in the environment variable --token-env names, or an
// export directory, which needs none. The target is a site URL, written with a manage-capped token in
// --target-token-env, TARGET_TOKEN unless named. A token is only ever named, never passed, and never
// printed; `mise run migrate` sources .env.secrets for them. One source goes to one target: two sites
// are never merged into one.
//
// It is idempotent: everything is compared with what the target already holds and only a difference
// is written, so running it again after a fix writes only what the fix changed. --dry-run lists what
// it would write and writes nothing. It never deletes anything on the target; what the target holds
// and the source does not is reported, for a person to decide.
//
// What cannot move: share links, because a site keeps only a hash of each. A private path arrives
// closed, and its links are minted again on the target.
import { canonical, openSource, openTarget, parseArgs, same, sha256, SiteError, writeExport } from "./content-sites.mjs";

const actions = [];
const notes = [];
const act = (line) => actions.push(line);

async function main() {
  const options = parseArgs(process.argv.slice(2), ["dry-run"]);
  if (!options.source) throw new SiteError("usage: migrate-content.mjs --source <url|dir> [--token-env NAME] (--target <url> [--target-token-env NAME] [--dry-run] | --export <dir>)");
  const source = await openSource(options.source, options["token-env"]);
  const content = await source.read();

  if (options.export) {
    const dir = options.export;
    await writeExport(dir, content);
    console.log(`exported ${source.label} to ${dir}: ${summary(content)}`);
    return;
  }

  const dry = options["dry-run"] === true;
  const target = openTarget(options.target, options["target-token-env"] ?? "TARGET_TOKEN");
  if (source.site && source.site.url === target.url) throw new SiteError("the source and the target are the same site");
  const current = await target.snapshot();
  console.log(`${dry ? "dry run: " : ""}${source.label} -> ${target.url}`);
  console.log(`source: ${summary(content)}`);

  const write = async (line, work) => {
    act(line);
    if (!dry) await work();
  };

  // Pages before settings, because a header or footer may name a template page that must exist first.
  const pagesThere = new Map(current.pages.map((p) => [p.path, p]));
  for (const page of content.pages) {
    const there = pagesThere.get(page.path);
    const live = { title: page.title, format: page.format, meta: page.meta, content: page.content };
    if (!there)
      await write(`publish page ${page.path}`, () =>
        target.call("publish_page", { path: page.path, content: page.content, format: page.format, title: page.title, meta: page.meta }),
      );
    else if (!same(live, { title: there.title, format: there.format, meta: there.meta, content: there.content }))
      await write(`replace page ${page.path}`, () =>
        target.call("publish_page", {
          path: page.path,
          content: page.content,
          format: page.format,
          title: page.title,
          meta: page.meta,
          overwrite: true,
        }),
      );
    if (page.draft && !same(page.draft, there?.draft ?? null))
      await write(`draft of ${page.path}`, () =>
        target.call("update_page", {
          path: page.path,
          content: page.draft.content,
          title: page.draft.title,
          meta: withRemovals(there?.draft?.meta ?? page.meta, page.draft.meta),
          draft: true,
        }),
      );
    if (!page.draft && there?.draft) notes.push(`${page.path} has a draft on the target and none in the source; left alone`);
  }

  const collectionsThere = new Map(current.collections.map((c) => [c.path, c]));
  for (const collection of content.collections) {
    const there = collectionsThere.get(collection.path);
    const existing = new Map((there?.items ?? []).map((item) => [item.id, item]));
    for (const item of collection.items) {
      const { id, ...fields } = item;
      const was = existing.get(id);
      if (was && same(was, item)) continue;
      await write(`${was ? "replace" : "add"} item ${collection.path}#${id}`, async () => {
        const rev = was ? await revOf(target, collection.path, id) : undefined;
        await target.call("put_item", { path: collection.path, id, fields, merge: false, ...(rev === undefined ? {} : { if_rev: rev }) });
      });
    }
    const order = collection.items.map((item) => item.id);
    const after = [...(there?.items ?? []).map((item) => item.id).filter((id) => order.includes(id))];
    for (const id of order) if (!after.includes(id)) after.push(id);
    const extras = (there?.items ?? []).map((item) => item.id).filter((id) => !order.includes(id));
    if (extras.length) notes.push(`${collection.path} holds ${extras.join(", ")} on the target and not in the source; left alone`);
    if (canonical(after) !== canonical(order) && order.length > 1)
      await write(`reorder ${collection.path}`, async () => {
        const { rev } = await target.read("list_items", { path: collection.path, limit: 1 });
        await target.call("reorder_items", { path: collection.path, ids: [...order, ...extras], if_rev: rev });
      });
  }
  // References last, once every collection they point at holds its items.
  for (const collection of content.collections) {
    const there = collectionsThere.get(collection.path);
    if (Object.keys(collection.refs).length && !same(collection.refs, there?.refs ?? {}))
      await write(`references of ${collection.path}`, () => target.call("set_collection_refs", { path: collection.path, refs: collection.refs }));
  }

  const assetsThere = new Map(current.assets.map((a) => [a.path ?? `#${a.filename}:${sha256(a.bytes)}`, a]));
  for (const asset of content.assets) {
    const key = asset.path ?? `#${asset.filename}:${sha256(asset.bytes)}`;
    const there = assetsThere.get(key);
    if (there && sha256(there.bytes) === sha256(asset.bytes)) continue;
    await write(`${there ? "replace" : "upload"} asset ${asset.path ?? `${asset.filename} (by hash)`}`, () =>
      target.upload(asset.path, asset.filename, asset.contentType, asset.bytes),
    );
  }

  if (content.instructions !== current.instructions)
    await write("instructions", async () => {
      const { rev } = await target.read("get_instructions");
      await target.call("set_instructions", { text: content.instructions, ...(rev > 0 ? { if_rev: rev } : {}) });
    });

  const changed = Object.fromEntries(Object.entries(content.site).filter(([key, value]) => current.site[key] !== value));
  if (Object.keys(changed).length)
    await write(`site settings: ${Object.keys(changed).join(", ")}`, () => target.call("set_site_info", changed));

  // Privacy last, so nothing above is written into a path already closed to the token's own reads.
  for (const path of content.private)
    if (!current.private.includes(path)) await write(`make ${path} private`, () => target.call("set_privacy", { path, private: true }));
  for (const path of current.private)
    if (!content.private.includes(path)) notes.push(`${path} is private on the target and not in the source; left alone`);
  if (content.private.length) notes.push("share links never migrate, only their hashes are kept; mint new ones with share_path");

  console.log(actions.length ? actions.map((line) => `${dry ? "would " : ""}${line}`).join("\n") : "nothing to write: the target already matches");
  for (const note of notes) console.log(`note: ${note}`);
  console.log(`${dry ? "would write" : "wrote"} ${actions.length} change${actions.length === 1 ? "" : "s"}`);
}

// update_page merges meta, so a name the draft dropped goes as null.
function withRemovals(before, after) {
  const meta = { ...after };
  for (const name of Object.keys(before ?? {})) if (!(name in after)) meta[name] = null;
  return meta;
}

async function revOf(target, path, id) {
  const { rev } = await target.read("get_item", { path, id });
  return rev;
}

function summary(content) {
  const items = content.collections.reduce((n, c) => n + c.items.length, 0);
  const drafts = content.pages.filter((p) => p.draft).length;
  return `${content.pages.length} pages (${drafts} with drafts), ${content.collections.length} collections (${items} items), ${content.assets.length} assets, ${content.private.length} private paths, instructions ${content.instructions ? `${content.instructions.length} chars` : "empty"}`;
}

main().catch((error) => {
  console.error(error instanceof SiteError ? `migrate: ${error.message}` : error);
  process.exit(1);
});
