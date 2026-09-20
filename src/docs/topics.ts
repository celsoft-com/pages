import { INSTRUCTIONS, PROTOCOL_VERSION } from "../mcp/handler";
import { API_PREFIX } from "../api/handler";
import { TOPIC_SOURCES } from "./content";

// A topic is a markdown file in docs/, and that is the whole of it. Frontmatter gives it a title
// and a place in the sidebar; the body is prose, written where prose belongs, and nothing about a
// topic lives in TypeScript. The four sources of documentation are the README, the licence, these
// files and the tool registry, and there is deliberately no fifth.

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
    fields[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^["']|["']$/g, "");
  }
  return [fields, source.slice(match[0].length)];
}

export function topics(): Topic[] {
  return TOPIC_SOURCES.map(({ slug, source }) => {
    const [fields, body] = frontmatter(source);
    return {
      slug,
      // A topic with no title in its frontmatter is still reachable and still readable; it just
      // sorts last and is named after its file, which is visible enough to get fixed.
      title: fields.title ?? slug,
      order: Number(fields.order ?? Number.MAX_SAFE_INTEGER),
      source: body,
    };
  }).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

// The one thing a topic may take from the code: a value the code decides and prose must not
// restate. Anything a reader needs that is not in this table belongs in the markdown, and a
// placeholder that is not in this table fails docs.test.ts rather than printing itself on a page.
export function fills(origin: string): Record<string, string> {
  return {
    site_url: origin,
    mcp_url: `${origin}/mcp`,
    api_url: `${origin}${API_PREFIX}`,
    protocol_version: PROTOCOL_VERSION,
    instructions: ["```", INSTRUCTIONS, "```"].join("\n"),
  };
}

export const PLACEHOLDER = /\{\{([a-z_]+)\}\}/g;

export function fill(source: string, origin: string): string {
  const values = fills(origin);
  return source.replace(PLACEHOLDER, (whole, name: string) => values[name] ?? whole);
}

// Markdown in docs/ links to its neighbours as files, because the folder is read on GitHub and in
// an editor as well as here. Served, those files are pages: bundles.md is /docs/bundles, and the
// README's one relative link is the licence.
export function linkToPage(markdown: string): string {
  return markdown.replace(/\]\(([A-Za-z0-9._-]+)\.md(#[^)]*)?\)/g, (whole, name: string, hash = "") => {
    if (name === "README") return `](/docs${hash})`;
    if (name === "LICENSE") return `](/docs/license${hash})`;
    return `](/docs/${name.toLowerCase()}${hash})`;
  });
}
