// Characters that casefold to themselves but have a conventional multi-character
// expansion, so NFD plus combining-mark stripping cannot reach them. Data only:
// extend this table without touching the matching algorithm.
export const EXPANSIONS: Record<string, string> = {
  "ß": "ss", // ß
  "ẞ": "ss", // ẞ
  "æ": "ae", // æ
  "œ": "oe", // œ
  "ø": "o", // ø
  "ł": "l", // ł
  "đ": "d", // đ
  "ð": "d", // ð
  "þ": "th", // þ
  "ħ": "h", // ħ
  "ŧ": "t", // ŧ
  "ı": "i", // ı
  "ĸ": "k", // ĸ
  "ŋ": "n", // ŋ
};
