// Holds a handler's reply against the outputSchema published for it. A result is the REST body and
// the /docs reference both, so a key returned and not declared is a break in somebody's cron job
// and a lie on the documentation page at once. Every call in results.test.ts goes through this, so
// the shapes are checked wherever they are already being exercised rather than in a list of their own.

type Schema = Record<string, any>;

function kindOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function typesOf(schema: Schema): string[] {
  if (schema.type === undefined) return [];
  return Array.isArray(schema.type) ? schema.type : [schema.type];
}

export function schemaProblems(schema: Schema, value: unknown, at = "result"): string[] {
  if (Array.isArray(schema.anyOf)) {
    const tried = schema.anyOf.map((option: Schema) => schemaProblems(option, value, at));
    const matched = tried.find((problems: string[]) => problems.length === 0);
    if (matched) return [];
    // The branch that came closest, so the failure names one shape rather than all of them.
    const closest = tried.sort((a: string[], b: string[]) => a.length - b.length)[0];
    return closest.map((problem: string) => `${problem} (no declared branch fits)`);
  }

  const types = typesOf(schema);
  if (types.length > 0 && !types.includes(kindOf(value)))
    return [`${at} is ${kindOf(value)}, declared ${types.join(" or ")}`];

  if (schema.type === "array" && Array.isArray(value) && schema.items)
    return value.flatMap((entry, index) => schemaProblems(schema.items, entry, `${at}[${index}]`));

  if (schema.type !== "object" || value === null || typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  const properties: Record<string, Schema> | undefined = schema.properties;
  const problems: string[] = [];

  // An undefined value is a key JSON.stringify drops, so it is absent as far as any caller is
  // concerned and is treated as absent here.
  const present = Object.keys(record).filter((key) => record[key] !== undefined);

  if (properties) {
    for (const key of present)
      if (!(key in properties)) problems.push(`${at}.${key} is returned and not declared`);
    for (const key of schema.required ?? [])
      if (!present.includes(key)) problems.push(`${at}.${key} is declared and not returned`);
    for (const key of present)
      if (properties[key]) problems.push(...schemaProblems(properties[key], record[key], `${at}.${key}`));
    return problems;
  }

  // A free-form object: values are checked only when the schema says what they are.
  if (schema.additionalProperties && schema.additionalProperties !== true)
    for (const key of present)
      problems.push(...schemaProblems(schema.additionalProperties, record[key], `${at}.${key}`));
  return problems;
}
