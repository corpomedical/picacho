import { describe, expect, it } from "vitest";
import { productScorerVersion, PRODUCT_PROMPT_REVISION } from "../generations/scorer-version";
import { GATE, calibrationReport, countBy, histogram, meetsBar, wilsonUpper, type LabelledFrame } from "./calibration";

// The calibration gate (synthesis §3.4, Cut 9) and the view's arithmetic.

function rows(n: number, frameVerdict: string, label: LabelledFrame["label"], over: Partial<LabelledFrame> = {}, i0 = 0): LabelledFrame[] {
  return Array.from({ length: n }, (_, i) => ({
    frameVerdict,
    label,
    productId: `p${(i0 + i) % 20}`,
    lane: `lane${(i0 + i) % 4}`,
    source: "bakeoff",
    ...over,
  }));
}

describe("Wilson's upper bound (95%)", () => {
  it("matches the textbook values", () => {
    expect(wilsonUpper(0, 10)).toBeCloseTo(0.2775, 3);
    expect(wilsonUpper(5, 100)).toBeCloseTo(0.1118, 3);
    expect(wilsonUpper(0, 0)).toBe(1);
  });

  it("a rate meets its bar only when its point AND its upper bound (≤ 2× the bar) do", () => {
    // 3 of 300 = 1%, upper ≈ 2.9%: meets 3% (upper ≤ 6%).
    expect(meetsBar({ k: 3, n: 300, rate: 0.01, upper: wilsonUpper(3, 300) }, 0.03)).toBe(true);
    // 1 of 20 = 5% — over a 3% bar.
    expect(meetsBar({ k: 1, n: 20, rate: 0.05, upper: wilsonUpper(1, 20) }, 0.03)).toBe(false);
    // 0 of 30: the point is 0 but the upper bound (11.4%) is past 6%.
    expect(meetsBar({ k: 0, n: 30, rate: 0, upper: wilsonUpper(0, 30) }, 0.03)).toBe(false);
    expect(meetsBar({ k: 0, n: 0, rate: null, upper: 1 }, 0.03)).toBe(false);
  });
});

describe("the truth from a label and a verdict", () => {
  it("match+correct and didnt_match+wrong are true matches; the other two true mismatches", () => {
    const r = calibrationReport([
      ...rows(4, "match", "correct"),
      ...rows(1, "didnt_match", "wrong"),
      ...rows(2, "didnt_match", "correct"),
      ...rows(3, "match", "wrong"),
    ]);
    expect(r.trueMatches).toBe(5);
    expect(r.trueMismatches).toBe(5);
    expect(r.falseMismatch).toMatchObject({ k: 1, n: 5 });
    expect(r.falseMatch).toMatchObject({ k: 3, n: 5 });
  });

  it("not-readable verdicts and frames a person can't read count beside the rates, not in them", () => {
    const r = calibrationReport([...rows(2, "not_readable", "wrong"), ...rows(1, "not_readable", "correct"), ...rows(3, "match", "not_readable"), ...rows(4, "match", null)]);
    expect(r.missedReads).toBe(2);
    expect(r.humanUnreadable).toBe(3);
    expect(r.unlabelled).toBe(4);
    expect(r.labelled).toBe(6);
    expect(r.trueMatches).toBe(0);
  });
});

describe("the gate", () => {
  const passing = () => [
    ...rows(GATE.trueMatches, "match", "correct"),
    ...rows(GATE.trueMismatches, "didnt_match", "correct", {}, 7),
  ];

  it("a clean set passes both bars (the flags stay the operator's)", () => {
    const r = calibrationReport(passing());
    expect(r.sample).toEqual({ trueMatches: true, trueMismatches: true, products: true, lanes: true, realMismatches: true });
    expect(r.reshootReady).toBe(true);
    expect(r.refundReady).toBe(true);
  });

  it("too few mismatches: not ready, whatever the rates", () => {
    const r = calibrationReport([...rows(GATE.trueMatches, "match", "correct"), ...rows(GATE.trueMismatches - 1, "didnt_match", "correct")]);
    expect(r.sample.trueMismatches).toBe(false);
    expect(r.reshootReady).toBe(false);
  });

  it("fewer than 20 real-render mismatches (the rest seeded): not ready", () => {
    const r = calibrationReport([
      ...rows(GATE.trueMatches, "match", "correct"),
      ...rows(19, "didnt_match", "correct"),
      ...rows(GATE.trueMismatches, "didnt_match", "correct", { source: "seeded" }),
    ]);
    expect(r.realMismatches).toBe(19);
    expect(r.sample.realMismatches).toBe(false);
    expect(r.refundReady).toBe(false);
  });

  it("too few products or lanes: not ready", () => {
    const r = calibrationReport(passing().map((x) => ({ ...x, productId: "one", lane: "one" })));
    expect(r.sample.products).toBe(false);
    expect(r.sample.lanes).toBe(false);
    expect(r.reshootReady).toBe(false);
  });

  it("a false-mismatch rate over 3% blocks the re-shoot; over 2% blocks refunds", () => {
    const reshoot = calibrationReport([...passing(), ...rows(15, "didnt_match", "wrong")]); // 15/315 ≈ 4.8%
    expect(reshoot.reshootReady).toBe(false);
    const refund = calibrationReport([...passing(), ...rows(8, "didnt_match", "wrong")]); // 8/308 ≈ 2.6%
    expect(refund.reshootReady).toBe(true);
    expect(refund.refundReady).toBe(false);
  });

  it("a false-match rate over 5% blocks refunds", () => {
    const r = calibrationReport([...passing(), ...rows(8, "match", "wrong")]); // 8/108 ≈ 7.4%
    expect(r.refundReady).toBe(false);
  });
});

describe("distributions", () => {
  it("histogram: equal bins, the top edge in the last, nulls and outliers skipped", () => {
    expect(histogram([0, 9, 10, 55, 100, null, -1, 101], { min: 0, max: 100, buckets: 10 })).toEqual([2, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("countBy: most first, ties by name", () => {
    expect(countBy(["b", "c", "b", "a"], (x) => x)).toEqual([
      { value: "b", count: 2 },
      { value: "a", count: 1 },
      { value: "c", count: 1 },
    ]);
    expect(countBy([null], (x) => x)).toEqual([{ value: "—", count: 1 }]);
  });
});

describe("the product checker's stamp", () => {
  it("names both readers and the prompt revision, and splits on each", () => {
    expect(productScorerVersion("gemini-3.1-flash-lite", "claude-sonnet-5")).toBe(`gemini-3.1-flash-lite+claude-sonnet-5/p${PRODUCT_PROMPT_REVISION}`);
    expect(productScorerVersion("a", "b")).not.toBe(productScorerVersion("a", "c"));
    expect(productScorerVersion(" ", "")).toBe(`unknown+unknown/p${PRODUCT_PROMPT_REVISION}`);
  });
});
