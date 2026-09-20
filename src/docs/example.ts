// The call, both ways round, built from the tool's own input schema. Neither shape is written down
// anywhere: the JSON-RPC envelope is what handler.ts dispatches on, the HTTP request is what
// api/handler.ts parses, and the arguments between them are the schema a client is already handed.
// A tool that gains a required argument gains it in both examples at once.

type Schema = Record<string, any>;

function placeholder(schema: Schema): unknown {
  if (Array.isArray(schema.enum)) return schema.enum[0];

  const types: string[] = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes("number")) return 0;
  if (types.includes("boolean")) return true;
  if (types.includes("array")) return [placeholder(schema.items ?? {})];
  if (types.includes("object")) {
    const properties: Record<string, Schema> = schema.properties ?? {};
    const required: string[] = schema.required ?? Object.keys(properties);
    return Object.fromEntries(required.map((name) => [name, placeholder(properties[name] ?? {})]));
  }
  return "<string>";
}

// Required arguments only. An example carrying every optional one stops being an example.
export function exampleArgs(schema: Schema): Record<string, unknown> {
  return placeholder({ ...schema, type: "object" }) as Record<string, unknown>;
}

export function mcpExample(name: string, schema: Schema, url: string): string {
  const call = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: exampleArgs(schema) },
  };
  return `POST ${url}
authorization: Bearer <token>
content-type: application/json

${JSON.stringify(call, null, 2)}`;
}

export function restExample(name: string, schema: Schema, prefix: string): string {
  return `POST ${prefix}/${name}
authorization: Bearer <token>
content-type: application/json

${JSON.stringify(exampleArgs(schema), null, 2)}`;
}
