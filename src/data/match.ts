import { EXPANSIONS } from "./expansions";

const TOKEN_FLOOR = 0.7;
const PREFIX_SCORE = 0.85;
const PREFIX_MIN_LENGTH = 4;
const SUBSET_BONUS = 0.5;

// JavaScript has no casefold, so lowercase plus the expansion table stands in for it:
// lowercase leaves ß and ı alone, and the table is what closes that gap.
export function normalize(input: string): string {
  const folded = [...input.normalize("NFKC").toLowerCase()]
    .map((character) => EXPANSIONS[character] ?? character)
    .join("");

  return folded
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function tokenize(input: string): string[] {
  const normalized = normalize(input);
  return normalized === "" ? [] : [...new Set(normalized.split(" "))];
}

function grams(input: string, size: number): Set<string> {
  if (input.length < size) return new Set(input ? [input] : []);
  const found = new Set<string>();
  for (let i = 0; i <= input.length - size; i++) found.add(input.slice(i, i + size));
  return found;
}

function dice<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared++;
  return (2 * shared) / (a.size + b.size);
}

function characterScore(a: string, b: string): number {
  return dice(grams(a, 2), grams(b, 2));
}

// Whole names share far more bigrams than single words do, and a script written
// without spaces arrives here as one long token, so trigrams carry the weight that
// separates two different names of the same shape.
function stringScore(a: string, b: string): number {
  const left = a.replace(/ /g, "");
  const right = b.replace(/ /g, "");
  return dice(
    new Set([...grams(left, 2), ...grams(left, 3)]),
    new Set([...grams(right, 2), ...grams(right, 3)]),
  );
}

function tokenScore(a: string, b: string): number {
  if (a === b) return 1;

  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= PREFIX_MIN_LENGTH && long.startsWith(short)) return PREFIX_SCORE;

  return characterScore(a, b);
}

function isSubset(a: string[], b: string[]): boolean {
  return a.length > 0 && a.every((token) => b.includes(token));
}

function pairedScore(a: string[], b: string[]): number {
  const taken = new Set<number>();
  let matched = 0;

  for (const token of [...a].sort((x, y) => y.length - x.length)) {
    let best = 0;
    let bestAt = -1;
    b.forEach((other, index) => {
      if (taken.has(index)) return;
      const score = tokenScore(token, other);
      if (score > best) {
        best = score;
        bestAt = index;
      }
    });
    if (best >= TOKEN_FLOOR && bestAt !== -1) {
      matched += best;
      taken.add(bestAt);
    }
  }

  return (2 * matched) / (a.length + b.length);
}

export function similarity(left: string, right: string): number {
  const a = tokenize(left);
  const b = tokenize(right);
  if (a.length === 0 || b.length === 0) return 0;

  if (isSubset(a, b) || isSubset(b, a)) {
    const base = dice(new Set(a), new Set(b));
    return base + (1 - base) * SUBSET_BONUS;
  }

  // Token sets are degenerate for a single token, and for scripts written without
  // spaces every name is one token, so compare characters instead.
  if (a.length < 2 || b.length < 2) return stringScore(normalize(left), normalize(right));

  return pairedScore(a, b);
}
