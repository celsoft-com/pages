import { openApiDocument } from "@celsoft/platform";
import { ENDPOINT_GROUPS, endpoints } from "../endpoints";
import { escapeHtml } from "../render/theme";

// The tool reference is the platform's OpenAPI document of the endpoints, drawn as tables. Nothing
// here describes a tool: every word comes from an endpoint's own description and the .describe() on
// its fields, so a tool is documented the moment it exists and a changed one leaves nothing stale.

type Schema = {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  anyOf?: Schema[];
  contentMediaType?: string;
};

interface Operation {
  operationId: string;
  description?: string;
  parameters?: { name: string; required?: boolean; schema: Schema }[];
  requestBody?: { content: Record<string, { schema: Schema }> };
  responses?: Record<string, { content?: Record<string, { schema: Schema }> }>;
  "x-platform-access"?: { anyone?: boolean; level?: string; point?: string };
}

interface Tool {
  name: string;
  method: string;
  path: string;
  operation: Operation;
}

let document: Promise<Map<string, Tool>> | undefined;

async function tools(): Promise<Map<string, Tool>> {
  document ??= openApiDocument(endpoints, { title: "pages" }).then((doc) => {
    const found = new Map<string, Tool>();
    const paths = (doc.paths ?? {}) as Record<string, Record<string, Operation>>;
    for (const [path, methods] of Object.entries(paths))
      for (const [method, operation] of Object.entries(methods))
        found.set(operation.operationId, { name: operation.operationId, method: method.toUpperCase(), path, operation });
    return found;
  });
  return document;
}

export const slugOf = (group: string) => group.toLowerCase();

export const GROUPS = Object.keys(ENDPOINT_GROUPS);

function typeOf(schema: Schema): string {
  if (schema.anyOf) return schema.anyOf.map(typeOf).join(" or ");
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  if (schema.contentMediaType) return "file";
  const types = Array.isArray(schema.type) ? schema.type : [schema.type ?? "any"];
  return types
    .map((type) => (type === "array" ? `array of ${schema.items ? typeOf(schema.items) : "any"}` : type))
    .join(" or ");
}

function fieldsTable(rows: { name: string; schema: Schema; required: boolean }[], need: boolean): string {
  if (rows.length === 0) return "<p>None.</p>";
  return [
    `<table><thead><tr><th>Name</th><th>Type</th>${need ? "<th>Needed</th>" : ""}<th>Description</th></tr></thead><tbody>`,
    ...rows.map(
      (row) =>
        `<tr><td class="name">${escapeHtml(row.name)}</td><td class="type">${escapeHtml(typeOf(row.schema))}</td>` +
        (need ? `<td class="need">${row.required ? "required" : "optional"}</td>` : "") +
        `<td>${escapeHtml(row.schema.description ?? "")}</td></tr>`,
    ),
    "</tbody></table>",
  ].join("");
}

function objectRows(schema: Schema | undefined) {
  const required = new Set(schema?.required ?? []);
  return Object.entries(schema?.properties ?? {}).map(([name, field]) => ({ name, schema: field, required: required.has(name) }));
}

function argumentRows(operation: Operation) {
  if (operation.parameters) return operation.parameters.map((p) => ({ name: p.name, schema: p.schema, required: !!p.required }));
  const content = operation.requestBody?.content ?? {};
  return objectRows((content["application/json"] ?? Object.values(content)[0])?.schema);
}

function access(operation: Operation): string {
  const spec = operation["x-platform-access"];
  if (!spec || spec.anyone) return "anyone";
  return spec.level ?? "signed in";
}

function section(tool: Tool): string {
  const result = tool.operation.responses?.["200"]?.content?.["application/json"]?.schema;
  const level = access(tool.operation);
  return [
    `<section class="tool" id="${tool.name}">`,
    `<h2><a href="#${tool.name}">${escapeHtml(tool.name)}</a><span class="pill ${level}">${escapeHtml(level)}</span></h2>`,
    `<p class="endpoint"><code>${tool.method} ${escapeHtml(tool.path)}</code> over REST, and <code>${escapeHtml(tool.name)}</code> over MCP</p>`,
    `<p>${escapeHtml(tool.operation.description ?? "")}</p>`,
    "<h3>Arguments</h3>",
    fieldsTable(argumentRows(tool.operation), true),
    "<h3>Result</h3>",
    fieldsTable(objectRows(result), false),
    "</section>",
  ].join("\n");
}

const namesIn = (group: string) => Object.keys(ENDPOINT_GROUPS[group as keyof typeof ENDPOINT_GROUPS]);

export async function referenceIndex(): Promise<string> {
  const all = await tools();
  return GROUPS.map((group) => {
    const items = namesIn(group)
      .map((name) => all.get(name))
      .filter((tool): tool is Tool => tool !== undefined)
      .map((tool) => {
        const level = access(tool.operation);
        return `<li><a href="/docs/tools/${slugOf(group)}#${tool.name}">${escapeHtml(tool.name)}</a><span class="pill ${level}">${escapeHtml(level)}</span></li>`;
      })
      .join("");
    return `<h2><a href="/docs/tools/${slugOf(group)}">${escapeHtml(group)}</a></h2><ul class="tools">${items}</ul>`;
  }).join("\n");
}

export async function referenceGroup(slug: string): Promise<{ title: string; html: string } | null> {
  const group = GROUPS.find((name) => slugOf(name) === slug);
  if (!group) return null;
  const all = await tools();
  const sections = namesIn(group)
    .map((name) => all.get(name))
    .filter((tool): tool is Tool => tool !== undefined)
    .map(section);
  return { title: group, html: [`<h1>${escapeHtml(group)}</h1>`, ...sections].join("\n") };
}
