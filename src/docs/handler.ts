import { API_PREFIX } from "../api/handler";
import { contentHeaders } from "../cache";
import { TOOLS, type AnyTool } from "../mcp/tools";
import { renderMarkdown } from "../render/markdown";
import { escapeHtml } from "../render/theme";
import { LICENSE_MD, README_MD } from "./content";
import { docsLayout, type NavItem } from "./layout";
import { mcpExample, restExample } from "./example";
import { inputHtml, outputHtml } from "./schema";
import { fill, linkToPage, topics } from "./topics";

export const DOCS_PREFIX = "/docs";

// Four sources and no fifth: the README, the licence, the topics in docs/, and the tool registry.
// Nothing here writes documentation. The reference is `TOOLS` drawn as tables, so a tool is
// documented the moment it exists and a changed one cannot leave a stale paragraph behind; every
// other page is markdown somebody wrote in docs/, where prose can be read and edited as prose. A
// paragraph written into this file would be a fifth source that nobody would think to update.

function slug(group: string): string {
  return group.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function groups(): string[] {
  const seen: string[] = [];
  for (const tool of TOOLS) if (!seen.includes(tool.group)) seen.push(tool.group);
  return seen;
}

// docs/tools.md is the reference's own introduction rather than a page of its own: it is the one
// topic whose body is followed by generated tables, so it takes the nav entry instead of adding one.
const REFERENCE = "tools";

function reference() {
  return topics().find((topic) => topic.slug === REFERENCE);
}

function nav(): NavItem[] {
  return [
    { href: "/docs", label: "Overview" },
    ...topics()
      .filter((topic) => topic.slug !== REFERENCE)
      .map((topic) => ({ href: `/docs/${topic.slug}`, label: topic.title })),
    {
      href: "/docs/tools",
      label: reference()?.title ?? "Tool reference",
      children: groups().map((group) => ({ href: `/docs/tools/${slug(group)}`, label: group })),
    },
    { href: "/docs/license", label: "License" },
  ];
}

function html(here: string, title: string, body: string, status = 200): Response {
  return new Response(docsLayout({ title, here, nav: nav(), body }), {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...contentHeaders() },
  });
}

function markdown(source: string, origin: string): string {
  return renderMarkdown(linkToPage(fill(source, origin)));
}

function pill(access: string): string {
  return `<span class="pill ${access}">${access}</span>`;
}

// One tool, one entry, and the transport is a tab rather than a second page: the arguments, the
// result and the description are the same value whichever door the call comes through, so the only
// thing that differs is the envelope, and that is the only thing the tabs hold.
function calls(tool: AnyTool, origin: string): string {
  const group = `call-${tool.name}`;
  return [
    `<div class="calls">`,
    `<input type="radio" class="mcp" name="${group}" id="${group}-mcp" checked>`,
    `<label for="${group}-mcp">MCP</label>`,
    `<input type="radio" class="rest" name="${group}" id="${group}-rest">`,
    `<label for="${group}-rest">REST</label>`,
    `<pre class="call mcp"><code>${escapeHtml(mcpExample(tool.name, tool.inputSchema, `${origin}/mcp`))}</code></pre>`,
    `<pre class="call rest"><code>${escapeHtml(
      restExample(tool.name, tool.inputSchema, `${origin}${API_PREFIX}`),
    )}</code></pre>`,
    `</div>`,
  ].join("");
}

function toolSection(tool: AnyTool, origin: string): string {
  return [
    `<section class="tool" id="${tool.name}">`,
    `<h2><a href="#${tool.name}">${escapeHtml(tool.name)}</a>${pill(tool.access)}</h2>`,
    `<p>${escapeHtml(tool.description)}</p>`,
    calls(tool, origin),
    "<h3>Arguments</h3>",
    inputHtml(tool.inputSchema),
    "<h3>Result</h3>",
    outputHtml(tool.outputSchema),
    "</section>",
  ].join("\n");
}

function toolsIndex(origin: string): string {
  const sections = groups()
    .map((group) => {
      const items = TOOLS.filter((tool) => tool.group === group)
        .map(
          (tool) =>
            `<li><a href="/docs/tools/${slug(group)}#${tool.name}">${escapeHtml(tool.name)}</a>` +
            `<span>${escapeHtml(tool.title)}</span>${pill(tool.access)}</li>`,
        )
        .join("");
      return `<h2><a href="/docs/tools/${slug(group)}">${escapeHtml(group)}</a></h2><ul class="tools">${items}</ul>`;
    })
    .join("\n");

  const intro = reference();
  return [
    intro ? markdown(intro.source, origin) : "<h1>Tool reference</h1>",
    sections,
  ].join("\n");
}

function groupPage(group: string, origin: string): string {
  return [
    `<h1>${escapeHtml(group)}</h1>`,
    ...TOOLS.filter((tool) => tool.group === group).map((tool) => toolSection(tool, origin)),
  ].join("\n");
}

function notFound(path: string): Response {
  return html(
    "/docs",
    "Not found",
    `<h1>Not found</h1><p>Nothing in the documentation is at <code>${escapeHtml(path)}</code>. ` +
      'Start at the <a href="/docs">overview</a>.</p>',
    404,
  );
}

export function handleDocs(request: Request, url: URL, origin: string): Response {
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET" } });

  const path = url.pathname.replace(/\/+$/, "") || "/docs";

  if (path === "/docs") return html(path, "Overview", markdown(README_MD, origin));
  if (path === "/docs/license") return html(path, "License", markdown(LICENSE_MD, origin));
  if (path === "/docs/tools")
    return html(path, reference()?.title ?? "Tool reference", toolsIndex(origin));

  const topic = topics().find((entry) => entry.slug !== REFERENCE && path === `/docs/${entry.slug}`);
  if (topic) return html(path, topic.title, markdown(topic.source, origin));

  const group = groups().find((name) => path === `/docs/tools/${slug(name)}`);
  if (group) return html(path, group, groupPage(group, origin));

  return notFound(url.pathname);
}
