import { TOPIC_SOURCES } from "./content";

// A topic is a markdown file in docs/, and that is the whole of it. Frontmatter gives it a title and
// a place in the sidebar; the body is prose, and nothing about a topic lives in TypeScript.
export interface Topic {
  slug: string;
  title: string;
  order: number;
  source: string;
}

function frontmatter(source: string): [Record<string, string>, string] {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  if (!match) return [{}, source];
  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const at = line.indexOf(":");
    if (at === -1) continue;
    fields[line.slice(0, at).trim()] = line
      .slice(at + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return [fields, source.slice(match[0].length)];
}

export function topics(): Topic[] {
  return TOPIC_SOURCES.map(({ slug, source }) => {
    const [fields, body] = frontmatter(source);
    // A topic with no title is still served; it sorts last and is named after its file, which is
    // visible enough to get fixed.
    return { slug, title: fields.title ?? slug, order: Number(fields.order ?? Number.MAX_SAFE_INTEGER), source: body };
  }).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export const REPOSITORY = "https://github.com/celsoft-com/pages/blob/main";

// The markdown links to its neighbours as files, because the folder is read on GitHub and in an
// editor too. Served, a topic is a page: bundles.md and docs/bundles.md are /docs/bundles, the
// licence is /docs/license, and any other file in the repository is linked where it lives.
export function linkToPage(markdown: string): string {
  return markdown.replace(/\]\((?!https?:|\/|#|mailto:)([^)\s#]+)(#[^)]*)?\)/g, (whole, file: string, hash = "") => {
    const topic = /^(?:docs\/)?([A-Za-z0-9_-]+)\.md$/.exec(file);
    if (topic) {
      const name = topic[1];
      if (name === "README") return `](/docs${hash})`;
      if (name === "LICENSE") return `](/docs/license${hash})`;
      if (file.startsWith("docs/") || !/^[A-Z]/.test(name)) return `](/docs/${name.toLowerCase()}${hash})`;
    }
    if (file === "docs" || file === "docs/") return `](/docs${hash})`;
    return `](${REPOSITORY}/${file}${hash})`;
  });
}
