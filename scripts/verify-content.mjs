#!/usr/bin/env node
// Compares a target site with the source it was migrated from, byte for byte.
//
//   node scripts/verify-content.mjs --source <url|dir> [--token-env NAME] --target <url> [--target-token-env NAME]
//
// Arguments and tokens as for migrate-content.mjs. It reads both whole and reports every page (live
// and draft), item (fields and order), collection reference, asset (by SHA-256 of its bytes), the
// instructions, the site settings and the private paths that differ. It exits 1 on any difference.
import { canonical, oldPathRedirects, openSource, openTarget, parseArgs, rewriteContent, same, sha256, SiteError } from "./content-sites.mjs";

async function main() {
  const options = parseArgs(process.argv.slice(2), ["rewrite-links", "redirect-old-paths"]);
  if (!options.source || !options.target) throw new SiteError("usage: verify-content.mjs --source <url|dir> [--token-env NAME] --target <url> [--target-token-env NAME]");
  const source = await openSource(options.source, options["token-env"]);
  const target = openTarget(options.target, options["target-token-env"] ?? "TARGET_TOKEN");
  const [read, have] = await Promise.all([source.read(), target.snapshot()]);
  // Compared modulo the migration's link rewrites, which it lists, so a rewrite is the only difference allowed.
  let want = read;
  if (options["rewrite-links"]) {
    const result = rewriteContent(read);
    want = result.content;
    for (const r of result.rewritten) console.log(`expected rewrite in ${r.page}: ${r.from} -> ${r.to}`);
  }
  const problems = [];
  let checked = 0;

  const pages = new Map(have.pages.map((p) => [p.path, p]));
  for (const page of want.pages) {
    checked++;
    const there = pages.get(page.path);
    if (!there) {
      problems.push(`page ${page.path}: missing`);
      continue;
    }
    if (there.content !== page.content) problems.push(`page ${page.path}: content differs (${page.content.length} bytes in source, ${there.content.length} on target)`);
    for (const key of ["title", "format"]) if (there[key] !== page[key]) problems.push(`page ${page.path}: ${key} "${there[key]}" is not "${page[key]}"`);
    if (!same(there.meta, page.meta)) problems.push(`page ${page.path}: meta ${canonical(there.meta)} is not ${canonical(page.meta)}`);
    if (!same(there.draft ?? null, page.draft ?? null)) problems.push(`page ${page.path}: draft differs`);
  }

  const collections = new Map(have.collections.map((c) => [c.path, c]));
  for (const collection of want.collections) {
    const there = collections.get(collection.path);
    if (!there) {
      problems.push(`collection ${collection.path}: missing`);
      continue;
    }
    const items = new Map(there.items.map((item) => [item.id, item]));
    for (const item of collection.items) {
      checked++;
      if (!items.has(item.id)) problems.push(`item ${collection.path}#${item.id}: missing`);
      else if (!same(items.get(item.id), item)) problems.push(`item ${collection.path}#${item.id}: fields differ`);
    }
    const order = collection.items.map((item) => item.id);
    if (canonical(there.items.map((item) => item.id).filter((id) => order.includes(id))) !== canonical(order))
      problems.push(`collection ${collection.path}: order differs`);
    if (!same(there.refs, collection.refs)) problems.push(`collection ${collection.path}: references differ`);
  }

  const key = (asset) => asset.path ?? `#${asset.filename}:${sha256(asset.bytes)}`;
  const assets = new Map(have.assets.map((a) => [key(a), a]));
  for (const asset of want.assets) {
    checked++;
    const there = assets.get(key(asset));
    if (!there) problems.push(`asset ${asset.path ?? asset.filename}: missing`);
    else if (sha256(there.bytes) !== sha256(asset.bytes)) problems.push(`asset ${asset.path}: bytes differ`);
    else if (there.contentType !== asset.contentType)
      problems.push(`asset ${asset.path ?? asset.filename}: served as ${there.contentType}, not ${asset.contentType}`);
  }

  // Each old address must answer, signed out, with a 301 to the page's /p URL.
  if (options["redirect-old-paths"])
    for (const { from, to } of oldPathRedirects(want)) {
      checked++;
      const response = await fetch(`${target.url}${from}`, { redirect: "manual", headers: { "user-agent": "pages-migrate/1" } });
      const location = response.headers.get("location") ?? "";
      if (response.status !== 301 || !location.endsWith(to)) problems.push(`redirect ${from}: ${response.status} ${location}, not 301 to ${to}`);
    }

  if (have.instructions !== want.instructions) problems.push("instructions differ");
  for (const [field, value] of Object.entries(want.site))
    if (have.site[field] !== value) problems.push(`site ${field}: "${have.site[field]}" is not "${value}"`);
  for (const path of want.private) if (!have.private.includes(path)) problems.push(`private path ${path}: not private on the target`);

  console.log(`checked ${checked} pages, items and assets, plus instructions, settings and ${want.private.length} private paths`);
  console.log(problems.length ? problems.join("\n") : "the target matches the source");
  process.exit(problems.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof SiteError ? `verify: ${error.message}` : error);
  process.exit(1);
});
