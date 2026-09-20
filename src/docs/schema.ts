import { escapeHtml } from "../render/theme";

// One renderer for both halves of a tool, because both halves are written in the same vocabulary:
// the arguments a client sends and the reply it gets back are JSON Schema objects living on the
// tool definition, so nothing here knows any tool's name and no tool can be documented by hand.

type Schema = Record<string, any>;

interface Row {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

function typeName(schema: Schema): string {
  if (Array.isArray(schema.enum)) return schema.enum.map((value: unknown) => JSON.stringify(value)).join(" | ");
  if (Array.isArray(schema.anyOf)) return "one of";
  if (schema.type === undefined) return "any";

  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes("array")) return `array of ${typeName(schema.items ?? {})}`;
  if (types.includes("object")) {
    if (schema.properties) return types.join(" or ");
    if (schema.additionalProperties && schema.additionalProperties !== true)
      return `object of ${typeName(schema.additionalProperties)}`;
    return "object, any fields";
  }
  return types.join(" or ");
}

// Nested shapes are flattened onto dotted names rather than nested into tables inside cells:
// `resources[].kind` says where the field sits and still reads as one list.
function rowsOf(schema: Schema, prefix = ""): Row[] {
  const properties: Record<string, Schema> = schema.properties ?? {};
  const required = new Set<string>(schema.required ?? []);
  const rows: Row[] = [];

  for (const [name, property] of Object.entries(properties)) {
    rows.push({
      name: `${prefix}${name}`,
      type: typeName(property),
      required: required.has(name),
      description: typeof property.description === "string" ? property.description : "",
    });

    if (property.properties) rows.push(...rowsOf(property, `${prefix}${name}.`));
    else if (property.items?.properties) rows.push(...rowsOf(property.items, `${prefix}${name}[].`));
  }
  return rows;
}

function table(schema: Schema, need: [string, string]): string {
  const rows = rowsOf(schema);
  if (rows.length === 0) return "";

  const body = rows
    .map(
      (row) =>
        `<tr><td class="name">${escapeHtml(row.name)}</td><td class="type">${escapeHtml(row.type)}</td>` +
        `<td class="need">${row.required ? need[0] : need[1]}</td><td>${escapeHtml(row.description)}</td></tr>`,
    )
    .join("");

  return `<table><thead><tr><th>Field</th><th>Type</th><th></th><th>Notes</th></tr></thead><tbody>${body}</tbody></table>`;
}

// A branchy reply is drawn as one table per branch, titled with the case it answers, because a
// single table of mostly-optional fields does not say which fields arrive together.
function schemaHtml(schema: Schema, need: [string, string], empty: string): string {
  if (Array.isArray(schema.anyOf))
    return schema.anyOf
      .map(
        (option: Schema, index: number) =>
          `<h4>${escapeHtml(option.title ?? `Shape ${index + 1}`)}</h4>${table(option, need)}`,
      )
      .join("");

  return table(schema, need) || `<p>${escapeHtml(empty)}</p>`;
}

export function inputHtml(schema: Schema): string {
  return schemaHtml(schema, ["required", "optional"], "Takes no arguments.");
}

export function outputHtml(schema: Schema): string {
  return schemaHtml(schema, ["always", "sometimes"], "Returns nothing.");
}
