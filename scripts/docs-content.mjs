import { readdirSync, readFileSync, writeFileSync } from "node:fs";

// Everything /docs serves that is not generated from the registry: the README, the licence, and
// every topic in docs/. The deployed function has no repository to read them out of, because
// esbuild bundles source and not the markdown sitting beside it, so they are carried into the
// bundle as source. This runs in build:deploy ahead of the tests, so a deploy always ships the
// markdown it was built from and there is no step to remember. The generated copy is committed as
// well, because `mise run dev` and the suite read it rather than running a build, and
// content.test.ts holds it against the files on disk.
const root = new URL("../", import.meta.url);

function read(file) {
  return readFileSync(new URL(file, root), "utf8");
}

// One array entry per line, so a diff of this file reads as the diff of the markdown it holds.
function lines(text) {
  return text
    .split("\n")
    .map((line) => `    ${JSON.stringify(line)},`)
    .join("\n");
}

function constant(name, file) {
  return `export const ${name} = [\n${lines(read(file)).replace(/^ {2}/gm, "")}\n].join("\\n");\n`;
}

const topics = readdirSync(new URL("docs/", root))
  .filter((file) => file.endsWith(".md"))
  .sort()
  .map((file) => {
    const slug = file.replace(/\.md$/, "");
    return `  {\n    slug: ${JSON.stringify(slug)},\n    source: [\n${lines(read(`docs/${file}`))}\n    ].join("\\n"),\n  },`;
  })
  .join("\n");

const body = [
  constant("README_MD", "README.md"),
  constant("LICENSE_MD", "LICENSE.md"),
  `// Every file in docs/, carried verbatim. Frontmatter is parsed at runtime by topics.ts, so this
// stays a copy of what is on disk and nothing about a topic is decided here.
export const TOPIC_SOURCES: { slug: string; source: string }[] = [\n${topics}\n];\n`,
].join("\n");

writeFileSync(
  new URL("src/docs/content.ts", root),
  `// Written by scripts/docs-content.mjs from README.md, LICENSE.md and docs/*.md.
// The deploy build rewrites this, so an edit to any of them ships either way. Run \`mise run docs\`
// to refresh the committed copy that local dev and the tests read.

${body}`,
);

console.log(`docs-content: README.md, LICENSE.md, ${readdirSync(new URL("docs/", root)).filter((f) => f.endsWith(".md")).length} topics`);
