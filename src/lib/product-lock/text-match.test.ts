import { describe, expect, it } from "vitest";
import {
  CONFLICT_SIMILARITY,
  LABEL_MATCH_SIMILARITY,
  appearsIn,
  editDistance,
  normaliseForMatch,
  readLabel,
  similarity,
} from "./text-match";

// T1: the words read on a frame, against the words the product carries.
// Arithmetic only — these tests pin the two thresholds the spec names (0.85
// to count a confirmed string as read, 0.5 below which a line is foreign)
// and the v2 #7 rule that a line is foreign only if it appears NOWHERE on
// the product's own photos, not merely outside the ticked words.

describe("normalising", () => {
  it("drops case, diacritics, spaces and punctuation", () => {
    expect(normaliseForMatch("Café Crème — 12 fl. oz")).toBe("cafecreme12floz");
    expect(normaliseForMatch("CAFE CREME 12FLOZ")).toBe("cafecreme12floz");
    expect(normaliseForMatch("Straße")).toBe("strasse");
  });

  it("is empty for anything that is not a string", () => {
    expect(normaliseForMatch(null)).toBe("");
    expect(normaliseForMatch(42)).toBe("");
  });
});

describe("edit distance and similarity", () => {
  it("counts inserts, deletes and substitutions", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("abc", "abc")).toBe(0);
  });

  it("is 1 for identical strings and 0 for nothing shared", () => {
    expect(similarity("acme", "acme")).toBe(1);
    expect(similarity("abc", "xyz")).toBe(0);
    expect(similarity("", "")).toBe(1);
  });
});

describe("appearsIn: approximate substring", () => {
  it("finds a word anywhere inside a longer text", () => {
    expect(appearsIn("coldbrew", "solstadcoldbrew330ml")).toBe(1);
  });

  it("forgives one slip in a long word", () => {
    // 1 edit in 12 characters: 0.917, above the 0.85 bar.
    expect(appearsIn("solstadcoldb", "xxsolstadcolbxx")).toBeGreaterThanOrEqual(LABEL_MATCH_SIMILARITY);
  });

  it("does not let a short reading stand for a long confirmed string", () => {
    // The whole confirmed string must appear: "acme" alone is not "acme cold brew".
    expect(appearsIn("acmecoldbrew", "acme")).toBeLessThan(LABEL_MATCH_SIMILARITY);
  });

  it("an empty needle is there; an empty haystack holds nothing", () => {
    expect(appearsIn("", "abc")).toBe(1);
    expect(appearsIn("abc", "")).toBe(0);
  });
});

describe("readLabel: MATCH (a confirmed string is read)", () => {
  const expected = ["SOLSTAD", "Cold Brew"];

  it("reads a confirmed string on one line", () => {
    const r = readLabel({ lines: ["SOLSTAD", "330 ml"], expected, referenceText: [] });
    expect(r.matched).toBe(true);
    expect(r.best).toBe(1);
    expect(r.bestString).toBe("SOLSTAD");
  });

  it("reads a confirmed string split over two lines", () => {
    const r = readLabel({ lines: ["Cold", "Brew"], expected: ["Cold Brew"], referenceText: [] });
    expect(r.matched).toBe(true);
  });

  it("forgives the reader's small slips (0.85)", () => {
    const r = readLabel({ lines: ["S0LSTAD"], expected: ["SOLSTAD"], referenceText: [] });
    expect(r.best).toBeCloseTo(6 / 7, 3);
    expect(r.matched).toBe(true);
  });

  it("does not count a label that came out garbled", () => {
    const r = readLabel({ lines: ["SOLTSAB"], expected: ["SOLSTAD"], referenceText: [] });
    expect(r.matched).toBe(false);
  });

  it("with no confirmed strings there is no best and nothing to match", () => {
    const r = readLabel({ lines: ["anything"], expected: [], referenceText: ["anything"] });
    expect(r.best).toBeNull();
    expect(r.matched).toBe(false);
  });
});

describe("readLabel: CONFLICT (a line the product doesn't carry)", () => {
  it("a line found nowhere on the product conflicts", () => {
    const r = readLabel({ lines: ["SOLSTAD", "MOUNTAIN DEW"], expected: ["SOLSTAD"], referenceText: ["SOLSTAD", "COLD BREW"] });
    expect(r.conflict).toBe("MOUNTAIN DEW");
  });

  it("v2 #7: a line printed on the product's own photos is not a conflict, ticked or not", () => {
    const r = readLabel({
      lines: ["Ingredients: water, coffee"],
      expected: ["SOLSTAD"],
      referenceText: ["SOLSTAD", "COLD BREW", "Ingredients: water, coffee"],
    });
    expect(r.conflict).toBeNull();
  });

  it("numbers alone never conflict: a price or a size read at an angle is not a different product", () => {
    const r = readLabel({ lines: ["$4.99", "500 ml", "2026"], expected: ["SOLSTAD"], referenceText: ["SOLSTAD"] });
    expect(r.conflict).toBeNull();
  });

  it("a line with fewer than 3 letters never conflicts", () => {
    const r = readLabel({ lines: ["XQ"], expected: ["SOLSTAD"], referenceText: [] });
    expect(r.conflict).toBeNull();
  });

  it("near-misses of the product's own text are not conflicts (below 0.85 is not a match, above 0.5 is not foreign)", () => {
    // "ACNE COLB BREV" vs "ACME COLD BREW": 3 slips in 12 letters.
    const r = readLabel({ lines: ["ACNE COLB BREV"], expected: ["ACME COLD BREW"], referenceText: [] });
    expect(r.matched).toBe(false);
    expect(r.conflict).toBeNull();
    expect(appearsIn(normaliseForMatch("ACNE COLB BREV"), normaliseForMatch("ACME COLD BREW"))).toBeGreaterThanOrEqual(CONFLICT_SIMILARITY);
  });

  it("a product with no readable text: any worded line conflicts", () => {
    const r = readLabel({ lines: ["LOREM IPSUM"], expected: [], referenceText: [] });
    expect(r.conflict).toBe("LOREM IPSUM");
  });

  it("a line that straddles two of the product's lines is still the product's", () => {
    const r = readLabel({ lines: ["COLD BREW 330"], expected: [], referenceText: ["SOLSTAD COLD", "BREW 330 ML"] });
    expect(r.conflict).toBeNull();
  });

  it("keeps the lines read, trimmed and bounded, for the record", () => {
    const r = readLabel({ lines: ["  a  b ", "", 7, "x".repeat(200)], expected: [], referenceText: [] });
    expect(r.lines[0]).toBe("a b");
    expect(r.lines).toHaveLength(2);
    expect(Array.from(r.lines[1])).toHaveLength(80);
  });
});
