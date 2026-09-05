import type { Item } from "../types";

type Operator = ":" | "=" | "!=" | ">" | ">=" | "<" | "<=";

interface Term {
  negated: boolean;
  field?: string;
  op: Operator;
  value: string;
}

const TERM_PATTERN = /^([A-Za-z0-9_.-]+)(>=|<=|!=|>|<|=|:)([\s\S]*)$/;

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quoted = false;

  for (const char of input) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

export function parseQuery(input: string): Term[] {
  return tokenize(input).map((token) => {
    const negated = token.startsWith("-") && token.length > 1;
    const body = negated ? token.slice(1) : token;

    const match = TERM_PATTERN.exec(body);
    if (!match) return { negated, op: ":" as Operator, value: body.toLowerCase() };

    const [, field, op, value] = match;
    if (field === "has" && op === ":") return { negated, field: value, op: ":", value: "*" };
    return { negated, field, op: op as Operator, value: value.toLowerCase() };
  });
}

function valueAt(item: Item, field: string): unknown {
  let current: unknown = item;
  for (const segment of field.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function scalars(value: unknown): (string | number | boolean)[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(scalars);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(scalars);
  return [value as string | number | boolean];
}

function compare(term: Term, raw: unknown): boolean {
  if (term.value === "*" && term.op === ":") return scalars(raw).length > 0;

  const candidates = scalars(raw);
  if (candidates.length === 0) return false;

  switch (term.op) {
    case ":":
      return candidates.some((c) => String(c).toLowerCase().includes(term.value));
    case "=":
      return candidates.some((c) => String(c).toLowerCase() === term.value);
    case "!=":
      return !candidates.some((c) => String(c).toLowerCase() === term.value);
    default: {
      const target = Number(term.value);
      if (Number.isNaN(target)) return false;
      return candidates.some((c) => {
        const n = Number(c);
        if (Number.isNaN(n)) return false;
        if (term.op === ">") return n > target;
        if (term.op === ">=") return n >= target;
        if (term.op === "<") return n < target;
        return n <= target;
      });
    }
  }
}

export function matchItem(item: Item, terms: Term[]): boolean {
  return terms.every((term) => {
    const raw = term.field === undefined ? item : valueAt(item, term.field);
    const hit = compare(term, raw);
    return term.negated ? !hit : hit;
  });
}
