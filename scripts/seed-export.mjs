#!/usr/bin/env node
// Writes an export directory of content this repo ships, for migrate-content.mjs to load onto a site
// that has nothing yet, such as a preview:
//
//   node scripts/seed-export.mjs <dir>
//
// The guides in docs/ become pages under /guide, and a small trip bundle exercises what a real site
// holds: a home page and header built from templates, a page with a draft, collections with a
// reference between them, files at paths and one stored by hash, the owner's instructions, and a
// private path.
import { readdirSync, readFileSync } from "node:fs";
import { writeExport } from "./content-sites.mjs";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: seed-export.mjs <dir>");
  process.exit(1);
}

const root = new URL("../", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");

function topic(file) {
  const source = read(`docs/${file}`);
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  const fields = Object.fromEntries(
    (match?.[1] ?? "").split("\n").map((line) => [line.slice(0, line.indexOf(":")).trim(), line.slice(line.indexOf(":") + 1).trim()]),
  );
  // Links between topics are files in the repo and pages on the site.
  const body = source
    .slice(match ? match[0].length : 0)
    .replace(/\]\(([a-z-]+)\.md(#[^)]*)?\)/g, (_, name, hash = "") => `](/p/guide/${name}${hash})`);
  return { slug: file.replace(/\.md$/, ""), title: fields.title, order: fields.order, body };
}

const guides = readdirSync(new URL("docs/", root))
  .filter((file) => file.endsWith(".md"))
  .map(topic);

const page = (path, content, extra = {}) => ({ path, content, format: extra.format ?? "markdown", title: extra.title, meta: extra.meta ?? {}, ...extra });

const pages = [
  page(
    "/root",
    [
      "# pages",
      "",
      "A website built by talking to Claude, running on @celsoft/platform. This copy holds the guides and a",
      "small trip, migrated onto it to show what a site holds.",
      "",
      "```pages",
      '{% assign guides = site.pages | where: "meta.kind", "guide" | sort: "meta.order" %}',
      "<ul>{% for p in guides %}<li><a href=\"/p{{ p.path }}\">{{ p.title }}</a> <small>{{ p.minutes }} min</small></li>{% endfor %}</ul>",
      "```",
      "",
      "See also [the trip](/p/trip) and the [documentation](/docs).",
    ].join("\n"),
    { title: "pages" },
  ),
  page(
    "/root/chrome/header",
    '<nav class="site-nav"><a href="/">Home</a> · <a href="/p/guide">Guides</a> · <a href="/p/trip">Trip</a> · <a href="/docs">Docs</a></nav>',
    { format: "html", title: "Header" },
  ),
  page(
    "/guide",
    [
      "# Guides",
      "",
      "```pages",
      '{% assign guides = site.pages | where: "meta.kind", "guide" | sort: "meta.order" %}',
      "{% for p in guides %}- [{{ p.title }}](/p{{ p.path }}), {{ p.words }} words\n{% endfor %}",
      "```",
    ].join("\n"),
    { title: "Guides" },
  ),
  ...guides.map((g) => page(`/guide/${g.slug}`, g.body, { title: g.title, meta: { kind: "guide", order: String(g.order).padStart(3, "0") } })),
  page(
    "/trip",
    [
      "# Paris in three days",
      "",
      "```pages",
      '<ol>{% for s in collections["/trip/stops"] %}<li>{{ s.name }}, day {{ s.day }}</li>{% endfor %}</ol>',
      "```",
      "",
      "The route is [a stored line](/assets/trip/route.geojson); day one has [its own page](/p/trip/day1).",
    ].join("\n"),
    {
      title: "Paris in three days",
      meta: { kind: "trip", date: "2026-05-01" },
      draft: {
        title: "Paris in four days",
        format: "markdown",
        meta: { kind: "trip", date: "2026-05-01" },
        content: "# Paris in four days\n\nA fourth day is being planned; readers still see three.",
      },
    },
  ),
  page(
    "/trip/day1",
    [
      "<!doctype html>",
      '<html lang="en"><head><meta charset="utf-8"><title>Day one</title></head>',
      "<body><h1>Day one</h1><ul id=\"stops\"></ul>",
      "<script>",
      "fetch('/data/trip/stops.json').then((r) => r.json()).then((items) => {",
      "  document.getElementById('stops').innerHTML = items.filter((s) => s.day === 1).map((s) => '<li>' + s.name + '</li>').join('');",
      "});",
      "</script></body></html>",
    ].join("\n"),
    { format: "html", title: "Day one" },
  ),
  page("/drafts/plan", "# Next trip\n\nSomewhere with mountains. This path is private.", { title: "Next trip" }),
];

const collections = [
  {
    path: "/trip/cities",
    refs: {},
    items: [
      { id: "paris", name: "Paris", country: "France" },
      { id: "versailles", name: "Versailles", country: "France" },
    ],
  },
  {
    path: "/trip/stops",
    refs: { city: "/trip/cities" },
    items: [
      { id: "louvre", name: "Louvre", day: 1, city: "paris", hours: { open: "09:00", close: "18:00" } },
      { id: "orsay", name: "Musée d'Orsay", day: 1, city: "paris", tags: ["impressionists", "café"] },
      { id: "chateau", name: "Château de Versailles", day: 2, city: "versailles", hours: { open: "09:00", close: "18:30" } },
      { id: "montmartre", name: "Montmartre", day: 3, city: "paris" },
    ],
  },
];

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#2f5fd0"/><path d="M9 23V9h8a5 5 0 0 1 0 10h-4v4z" fill="#fff"/></svg>';
const route = {
  type: "Feature",
  geometry: { type: "LineString", coordinates: [[2.3376, 48.8606], [2.3266, 48.86], [2.1204, 48.8049]] },
  properties: { distance_m: 21400, attribution: "© OpenStreetMap contributors, ODbL" },
};
const asset = (path, filename, contentType, text) => ({ path, filename, contentType, bytes: Buffer.from(text) });

await writeExport(dir, {
  site: {
    title: "pages",
    description: "A website built by talking to Claude",
    head: "<style>.site-nav{font-size:.9rem;margin:0 0 1rem}</style>",
    header: "/root/chrome/header",
    footer: "",
    theme: "default",
  },
  instructions: "Write in British English.\nKeep repeating content in collections under the page that shows it.",
  private: ["/drafts"],
  pages,
  collections,
  assets: [
    asset("/root/favicon.svg", "favicon.svg", "image/svg+xml", svg),
    asset("/trip/route.geojson", "route.geojson", "application/geo+json", `${JSON.stringify(route)}\n`),
    asset("/drafts/notes.txt", "notes.txt", "text/plain", "Only the owner and a link holder can read this.\n"),
    asset(null, "stamp.txt", "text/plain", "Stored by hash, with no path.\n"),
  ],
});
console.log(`seed export written to ${dir}: ${pages.length} pages, ${collections.length} collections, 4 assets`);
