import { EndpointError } from "@celsoft/platform";
import { buildStamp, describeBuild } from "../build";
import type { PagesApp } from "../pages-app";
import { renderMarkdown } from "../render/markdown";
import { LICENSE_MD, README_MD } from "./content";
import { docsLayout, type NavItem } from "./layout";
import { linkToPage, topics } from "./topics";

// Three sources and no fourth: the README, the licence and the topics in docs/. Nothing here
// writes documentation; a paragraph written into this file would be a source nobody thinks to update.
function nav(): NavItem[] {
  return [
    { href: "/docs", label: "Overview" },
    ...topics().map((topic) => ({ href: `/docs/${topic.slug}`, label: topic.title })),
    { href: "/docs/license", label: "License" },
  ];
}

function page(app: PagesApp, here: string, title: string, markdown: string): string {
  return docsLayout({
    title,
    here,
    nav: nav(),
    body: renderMarkdown(linkToPage(markdown)),
    build: describeBuild(buildStamp(app.env)),
  });
}

export function docsPage(app: PagesApp, slug: string): string {
  if (slug === "") return page(app, "/docs", "Overview", README_MD);
  if (slug === "license") return page(app, "/docs/license", "License", LICENSE_MD);
  const topic = topics().find((entry) => entry.slug === slug);
  if (!topic) throw new EndpointError(404, `No documentation at /docs/${slug}.`);
  return page(app, `/docs/${topic.slug}`, topic.title, topic.source);
}
