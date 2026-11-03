import { EndpointError } from "@celsoft/platform";
import { buildStamp, describeBuild } from "../build";
import type { PagesApp } from "../pages-app";
import { renderMarkdown } from "../render/markdown";
import { LICENSE_MD, README_MD } from "./content";
import { docsLayout, type NavItem } from "./layout";
import { GROUPS, referenceGroup, referenceIndex, slugOf } from "./reference";
import { linkToPage, topics } from "./topics";

// Four sources and no fifth: the README, the licence, the topics in docs/, and the endpoints drawn
// as a reference. Nothing here writes documentation; a paragraph written into this file would be a
// source nobody thinks to update.

// docs/tools.md introduces the generated reference rather than standing alone, so it is the
// reference's index page and takes its place in the sidebar.
const REFERENCE = "tools";

function nav(): NavItem[] {
  const intro = topics().find((topic) => topic.slug === REFERENCE);
  return [
    { href: "/docs", label: "Overview" },
    ...topics()
      .filter((topic) => topic.slug !== REFERENCE)
      .map((topic) => ({ href: `/docs/${topic.slug}`, label: topic.title })),
    {
      href: "/docs/tools",
      label: intro?.title ?? "Tool reference",
      children: GROUPS.map((group) => ({ href: `/docs/tools/${slugOf(group)}`, label: group })),
    },
    { href: "/docs/license", label: "License" },
  ];
}

function page(app: PagesApp, here: string, title: string, body: string): string {
  return docsLayout({ title, here, nav: nav(), body, build: describeBuild(buildStamp(app.env)) });
}

const markdown = (source: string) => renderMarkdown(linkToPage(source));

export async function docsPage(app: PagesApp, slug: string): Promise<string> {
  if (slug === "") return page(app, "/docs", "Overview", markdown(README_MD));
  if (slug === "license") return page(app, "/docs/license", "License", markdown(LICENSE_MD));
  if (slug === REFERENCE) {
    const intro = topics().find((topic) => topic.slug === REFERENCE);
    return page(
      app,
      "/docs/tools",
      intro?.title ?? "Tool reference",
      [intro ? markdown(intro.source) : "<h1>Tool reference</h1>", await referenceIndex()].join("\n"),
    );
  }
  const topic = topics().find((entry) => entry.slug === slug);
  if (!topic) throw new EndpointError(404, `No documentation at /docs/${slug}.`);
  return page(app, `/docs/${topic.slug}`, topic.title, markdown(topic.source));
}

export async function referencePage(app: PagesApp, group: string): Promise<string> {
  const found = await referenceGroup(group);
  if (!found) throw new EndpointError(404, `No tool group at /docs/tools/${group}.`);
  return page(app, `/docs/tools/${group}`, found.title, found.html);
}
