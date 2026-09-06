import { describe, expect, it } from "vitest";
import { normalize, similarity, tokenize } from "./match";

const THRESHOLD = 0.6;

describe("acceptance: must match at 0.6 or above", () => {
  const cases: [string, string][] = [
    ["Acme Corp.", "ACME Corporation"],
    ["Café Rouge", "Cafe Rouge"],
    ["Gruener Brauhaus", "Grüner Brauhaus"],
    ["Tokyo Station Hotel", "Hotel Tokyo Station"],
    ["İstanbul Modern", "Istanbul Modern"],
  ];

  for (const [left, right] of cases) {
    it(`${left} / ${right}`, () => {
      expect(similarity(left, right)).toBeGreaterThanOrEqual(THRESHOLD);
    });

    it(`${left} / ${right} is symmetric`, () => {
      expect(similarity(right, left)).toBeCloseTo(similarity(left, right), 10);
    });
  }
});

describe("acceptance: must score below 0.6", () => {
  const cases: [string, string][] = [
    ["North Clinic", "South Clinic"],
    ["Hotel Bristol", "Hotel Brussels"],
    ["Club Stereo", "Live Club"],
  ];

  for (const [left, right] of cases) {
    it(`${left} / ${right}`, () => {
      expect(similarity(left, right)).toBeLessThan(THRESHOLD);
    });

    it(`${left} / ${right} is symmetric`, () => {
      expect(similarity(right, left)).toBeCloseTo(similarity(left, right), 10);
    });
  }
});

describe("normalize", () => {
  it("casefolds where lowercase alone would not", () => {
    expect(normalize("STRASSE")).toBe(normalize("Straße"));
    expect(normalize("ISTANBUL")).toBe(normalize("ıstanbul"));
  });

  it("strips diacritics across scripts", () => {
    expect(normalize("Café")).toBe("cafe");
    expect(normalize("Grüner")).toBe("gruner");
    expect(normalize("Ångström")).toBe("angstrom");
    expect(normalize("Ἀθῆναι")).toBe(normalize("Αθηναι"));
    expect(normalize("Йошкар")).toBe(normalize("Иошкар"));
  });

  it("expands ligatures and slashed letters that do not decompose", () => {
    expect(normalize("Æther")).toBe("aether");
    expect(normalize("Ølhus")).toBe("olhus");
    expect(normalize("Łódź")).toBe("lodz");
  });

  it("turns punctuation and symbols into separators", () => {
    expect(normalize("Acme, Corp. & Sons")).toBe("acme corp sons");
    expect(normalize("Rock-n-Roll")).toBe("rock n roll");
    expect(normalize("  spaced   out  ")).toBe("spaced out");
  });

  it("keeps scripts it cannot tokenise rather than dropping them", () => {
    expect(normalize("東京駅")).toBe("東京駅");
    expect(normalize("مطعم")).toBe("مطعم");
  });

  it("returns empty for input that is only punctuation", () => {
    expect(normalize("!!! ---")).toBe("");
    expect(tokenize("!!! ---")).toEqual([]);
  });
});

describe("tokenize", () => {
  it("splits on whitespace and dedupes", () => {
    expect(tokenize("Bar Bar Grill")).toEqual(["bar", "grill"]);
  });

  it("yields one token for a script without word spacing", () => {
    expect(tokenize("東京駅ホテル")).toHaveLength(1);
  });
});

describe("scoring behaviour", () => {
  it("is order insensitive", () => {
    expect(similarity("Red Lion Pub", "Pub Red Lion")).toBe(1);
  });

  it("rewards a bare name inside a longer one", () => {
    expect(similarity("Acme", "Acme Corporation")).toBeGreaterThanOrEqual(THRESHOLD);
    expect(similarity("Red Lion", "Red Lion Hotel and Spa")).toBeGreaterThanOrEqual(THRESHOLD);
  });

  it("matches abbreviations that prefix the full word", () => {
    expect(similarity("Univ Hospital", "University Hospital")).toBeGreaterThanOrEqual(THRESHOLD);
    expect(similarity("Acme Corp", "Acme Corporation")).toBeGreaterThanOrEqual(THRESHOLD);
  });

  it("misses a contraction that is not a prefix, preferring that to a wrong match", () => {
    expect(similarity("Intl Foods", "International Foods")).toBeLessThan(THRESHOLD);
  });

  it("does not treat a shared domain word as a match", () => {
    expect(similarity("Fox Brewery", "Badger Brewery")).toBeLessThan(THRESHOLD);
    expect(similarity("Smith Clinic", "Jones Clinic")).toBeLessThan(THRESHOLD);
  });

  it("keeps leading articles rather than stripping them", () => {
    expect(similarity("The Hague", "Hague")).toBeGreaterThanOrEqual(THRESHOLD);
    expect(similarity("The Hague", "The Barn")).toBeLessThan(THRESHOLD);
  });

  it("compares characters for scripts without spaces", () => {
    expect(similarity("東京駅ホテル", "東京駅ホテル")).toBe(1);
    expect(similarity("東京駅ホテル", "大阪駅ホテル")).toBeLessThan(THRESHOLD);
  });

  it("scores an empty or punctuation-only side as no match", () => {
    expect(similarity("", "Acme")).toBe(0);
    expect(similarity("---", "Acme")).toBe(0);
  });

  it("scores identical input as 1", () => {
    expect(similarity("Acme Corp", "Acme Corp")).toBe(1);
  });

  it("stays within 0 and 1", () => {
    const samples = ["Acme Corp.", "ACME Corporation", "東京駅", "Café Rouge", "", "The Hague"];
    for (const left of samples)
      for (const right of samples) {
        const score = similarity(left, right);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
  });
});
