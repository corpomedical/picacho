// Calibration: what the hand labels say about the product checker, and
// whether it has earned the right to drive anything (synthesis v2 §3.4,
// Cut 9 gate). Admin's score-distribution view prints every number here.
//
// A label says whether the checker's FRAME verdict was right:
//   correct       the verdict was right
//   wrong         the verdict was wrong
//   not_readable  a person can't tell either
// From a label and the verdict the truth follows:
//   match        + correct → a true match     match        + wrong → a true mismatch (a FALSE MATCH)
//   didnt_match  + correct → a true mismatch  didnt_match  + wrong → a true match    (a FALSE MISMATCH)
// Frames the checker called not readable, and frames a person can't read,
// say nothing about either rate; they are counted beside them.
//
// THE GATE (synthesis §3.4, Cut 9):
//   ≥ 300 true-match frames and ≥ 100 true-mismatch frames, across ≥ 15
//   products and ≥ 3 lanes; ≥ 20 of the mismatches from real renders (the
//   rest may be seeded locally from real frames at $0).
//   Each rate meets its bar as a point estimate AND its Wilson 95% upper
//   bound is no more than twice the bar.
//   automatic re-shoot: false-mismatch ≤ 3%
//   refunds:            false-mismatch ≤ 2% and false-match ≤ 5% (plus the
//                       operator's yes; the word "locked" needs another)
// Passing is a fact to show the operator, never a switch: every flag stays
// his to turn on (product_lock_calibrated, _reshoot, _refund).
//
// Pure, alias-free.

import type { FrameLabel } from "./records";

export const GATE = {
  trueMatches: 300,
  trueMismatches: 100,
  products: 15,
  lanes: 3,
  realMismatches: 20,
  reshootFalseMismatch: 0.03,
  refundFalseMismatch: 0.02,
  refundFalseMatch: 0.05,
} as const;

/** One labelled row, as Admin reads it. */
export type LabelledFrame = {
  frameVerdict: string;
  label: FrameLabel | null;
  productId: string | null;
  lane: string | null;
  source: string;
};

/** The Wilson score interval's upper bound at 95% (z = 1.96) for k successes in n; 1 when n is 0. */
export function wilsonUpper(k: number, n: number, z = 1.96): number {
  if (!(n > 0)) return 1;
  const p = k / n;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.min(1, (centre + margin) / (1 + z2 / n));
}

export type Rate = { k: number; n: number; rate: number | null; upper: number };

function rate(k: number, n: number): Rate {
  return { k, n, rate: n > 0 ? k / n : null, upper: wilsonUpper(k, n) };
}

/** A rate meets `bar` when its point estimate does and its Wilson upper bound is at most twice it. */
export function meetsBar(r: Rate, bar: number): boolean {
  return r.rate !== null && r.rate <= bar && r.upper <= 2 * bar;
}

export type CalibrationReport = {
  labelled: number;
  unlabelled: number;
  trueMatches: number;
  trueMismatches: number;
  realMismatches: number;
  /** The checker said "not readable"; a person could read it (label wrong). */
  missedReads: number;
  /** A person couldn't read it either. */
  humanUnreadable: number;
  products: number;
  lanes: number;
  falseMismatch: Rate;
  falseMatch: Rate;
  sample: { trueMatches: boolean; trueMismatches: boolean; products: boolean; lanes: boolean; realMismatches: boolean };
  reshootReady: boolean;
  refundReady: boolean;
};

export function calibrationReport(rows: readonly LabelledFrame[]): CalibrationReport {
  let labelled = 0;
  let unlabelled = 0;
  let matchCorrect = 0;
  let matchWrong = 0;
  let missCorrect = 0;
  let missWrong = 0;
  let realMismatches = 0;
  let missedReads = 0;
  let humanUnreadable = 0;
  const products = new Set<string>();
  const lanes = new Set<string>();
  for (const r of rows) {
    if (!r.label) {
      unlabelled++;
      continue;
    }
    labelled++;
    if (r.label === "not_readable") {
      humanUnreadable++;
      continue;
    }
    const isMatch = r.frameVerdict === "match";
    const isMiss = r.frameVerdict === "didnt_match";
    if (!isMatch && !isMiss) {
      if (r.frameVerdict === "not_readable" && r.label === "wrong") missedReads++;
      continue;
    }
    if (r.productId) products.add(r.productId);
    if (r.lane) lanes.add(r.lane);
    const trueMismatch = (isMatch && r.label === "wrong") || (isMiss && r.label === "correct");
    if (trueMismatch && r.source !== "seeded") realMismatches++;
    if (isMatch && r.label === "correct") matchCorrect++;
    else if (isMatch) matchWrong++;
    else if (r.label === "correct") missCorrect++;
    else missWrong++;
  }
  const trueMatches = matchCorrect + missWrong;
  const trueMismatches = missCorrect + matchWrong;
  const falseMismatch = rate(missWrong, trueMatches);
  const falseMatch = rate(matchWrong, trueMismatches);
  const sample = {
    trueMatches: trueMatches >= GATE.trueMatches,
    trueMismatches: trueMismatches >= GATE.trueMismatches,
    products: products.size >= GATE.products,
    lanes: lanes.size >= GATE.lanes,
    realMismatches: realMismatches >= GATE.realMismatches,
  };
  const sampleOk = Object.values(sample).every(Boolean);
  return {
    labelled,
    unlabelled,
    trueMatches,
    trueMismatches,
    realMismatches,
    missedReads,
    humanUnreadable,
    products: products.size,
    lanes: lanes.size,
    falseMismatch,
    falseMatch,
    sample,
    reshootReady: sampleOk && meetsBar(falseMismatch, GATE.reshootFalseMismatch),
    refundReady: sampleOk && meetsBar(falseMismatch, GATE.refundFalseMismatch) && meetsBar(falseMatch, GATE.refundFalseMatch),
  };
}

// ---------------------------------------------------------------------------
// Distributions (the view's histograms)
// ---------------------------------------------------------------------------

/** Counts of `values` in `buckets` equal-width bins over [min, max]; the top edge falls in the last bin. */
export function histogram(values: readonly (number | null)[], opts: { min: number; max: number; buckets: number }): number[] {
  const out = new Array<number>(opts.buckets).fill(0);
  const width = (opts.max - opts.min) / opts.buckets;
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < opts.min || v > opts.max) continue;
    out[Math.min(opts.buckets - 1, Math.floor((v - opts.min) / width))]++;
  }
  return out;
}

/** How many rows carry each value of `key`, most first. */
export function countBy<T>(rows: readonly T[], key: (row: T) => string | null): { value: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r) ?? "—";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
