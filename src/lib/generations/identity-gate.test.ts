import { describe, expect, it } from "vitest";
import {
  betterAttemptScore,
  DEFAULT_IDENTITY_THRESHOLD,
  gateLogLine,
  identityGateDecision,
  MAX_IDENTITY_THRESHOLD,
  resolveIdentityThreshold,
} from "./identity-gate";

// The identity gate (2026-09-01). Every test here is really about one of two
// things: does the gate fire when a render genuinely missed, and can it be
// made to spend money when it did not.

describe("resolveIdentityThreshold", () => {
  it("defaults when the setting has never been written", () => {
    expect(resolveIdentityThreshold(null)).toBe(DEFAULT_IDENTITY_THRESHOLD);
    expect(resolveIdentityThreshold(undefined)).toBe(DEFAULT_IDENTITY_THRESHOLD);
    expect(resolveIdentityThreshold("")).toBe(DEFAULT_IDENTITY_THRESHOLD);
    expect(resolveIdentityThreshold("   ")).toBe(DEFAULT_IDENTITY_THRESHOLD);
  });

  it("reads a real admin value", () => {
    expect(resolveIdentityThreshold("55")).toBe(55);
    expect(resolveIdentityThreshold("80")).toBe(80);
    expect(resolveIdentityThreshold("72.4")).toBe(72);
  });

  it("REGRESSION: garbage falls back to the default, never to zero", () => {
    // Zero disables the gate. If a typo silently disabled it, the symptom
    // would be indistinguishable from "no render ever misses" — the failure
    // mode you never notice.
    for (const bad of ["abc", "NaN", "Infinity", "-Infinity", "1e999", "]"]) {
      expect(resolveIdentityThreshold(bad), bad).toBe(DEFAULT_IDENTITY_THRESHOLD);
    }
  });

  it("REGRESSION: refuses a threshold that would retry and refund everything", () => {
    // The scorer essentially never returns 100, so a threshold of 100 means
    // every render misses twice, gets re-rendered, and gets refunded — an
    // unbounded bill and zero revenue, one admin typo away.
    expect(resolveIdentityThreshold("100")).toBe(DEFAULT_IDENTITY_THRESHOLD);
    expect(resolveIdentityThreshold("96")).toBe(DEFAULT_IDENTITY_THRESHOLD);
    expect(resolveIdentityThreshold("-5")).toBe(DEFAULT_IDENTITY_THRESHOLD);
    expect(resolveIdentityThreshold(String(MAX_IDENTITY_THRESHOLD))).toBe(MAX_IDENTITY_THRESHOLD);
  });

  it("keeps zero as a deliberate kill switch", () => {
    expect(resolveIdentityThreshold("0")).toBe(0);
  });
});

describe("identityGateDecision", () => {
  const T = 70;

  it("passes a render that met the bar", () => {
    expect(identityGateDecision({ score: 70, threshold: T, retriesUsed: 0 })).toEqual({
      action: "pass",
      reason: "above-threshold",
    });
    expect(identityGateDecision({ score: 91, threshold: T, retriesUsed: 0 }).action).toBe("pass");
  });

  it("retries a render that missed, once", () => {
    expect(identityGateDecision({ score: 41, threshold: T, retriesUsed: 0 })).toEqual({
      action: "retry",
      score: 41,
    });
  });

  it("settles after the retry also missed", () => {
    const d = identityGateDecision({ score: 52, threshold: T, retriesUsed: 1, previousScore: 41 });
    expect(d).toEqual({ action: "settle", score: 52, bestScore: 52, keepPrevious: false });
  });

  it("keeps the FIRST attempt when the re-roll came out worse", () => {
    // A second render is not monotonically better. Shipping the retry
    // regardless would hand the user the worse of two images they can see
    // the scores of.
    const d = identityGateDecision({ score: 38, threshold: T, retriesUsed: 1, previousScore: 61 });
    expect(d).toEqual({ action: "settle", score: 38, bestScore: 61, keepPrevious: true });
  });

  it("MONEY: an unscored FIRST render never triggers a paid retry", () => {
    // scoreIdentityMatch is best-effort and returns null on a timeout, a
    // rate limit, a malformed reply or a missing identity photo. Treating
    // null as a miss would re-render every image in flight during any
    // OpenAI blip, at our expense, and refund them all.
    expect(identityGateDecision({ score: null, threshold: T, retriesUsed: 0 })).toEqual({
      action: "pass",
      reason: "not-scored",
    });
    expect(identityGateDecision({ score: NaN, threshold: T, retriesUsed: 0 }).action).toBe("pass");
  });

  it("REGRESSION: an unscored RETRY settles on what we know, keeping the measured attempt", () => {
    // The first draft of this module returned a bare "pass" here, which made
    // the caller ship the unmeasured re-roll and throw away an attempt we
    // had actually measured — and skip the refund that was already owed,
    // since attempt one had missed the bar.
    const d = identityGateDecision({ score: null, threshold: T, retriesUsed: 1, previousScore: 41 });
    expect(d).toEqual({ action: "settle", score: 41, bestScore: 41, keepPrevious: true });
  });

  it("keeps the better attempt even when the retry CLEARS the bar", () => {
    // Passing the threshold is not the same as being the better image. A 75
    // against an earlier 80 has cleared the bar and is still the worse of
    // two renders whose scores the user can see.
    const d = identityGateDecision({ score: 75, threshold: T, retriesUsed: 1, previousScore: 80 });
    expect(d).toEqual({ action: "pass", reason: "above-threshold", keepPrevious: true });

    const e = identityGateDecision({ score: 88, threshold: T, retriesUsed: 1, previousScore: 62 });
    expect(e).toEqual({ action: "pass", reason: "above-threshold", keepPrevious: false });
  });

  it("MONEY: a disabled gate spends nothing, whatever the score", () => {
    for (const score of [0, 5, 41, 69]) {
      expect(identityGateDecision({ score, threshold: 0, retriesUsed: 0 })).toEqual({
        action: "pass",
        reason: "gate-disabled",
      });
    }
  });

  it("MONEY: never grants a second retry, however many times it is asked", () => {
    // retriesUsed is read from the row, not from memory, so a webhook and a
    // poll landing on the same generation both see the same count. This
    // asserts the policy they both consult.
    for (const retriesUsed of [1, 2, 7]) {
      expect(
        identityGateDecision({ score: 10, threshold: T, retriesUsed, previousScore: 12 }).action,
      ).toBe("settle");
    }
  });

  it("treats the threshold as a floor, not a range", () => {
    expect(identityGateDecision({ score: 69, threshold: T, retriesUsed: 0 }).action).toBe("retry");
    expect(identityGateDecision({ score: 70, threshold: T, retriesUsed: 0 }).action).toBe("pass");
  });
});

describe("betterAttemptScore", () => {
  it("keeps the higher score", () => {
    expect(betterAttemptScore(61, 38)).toBe("first");
    expect(betterAttemptScore(38, 61)).toBe("second");
  });

  it("prefers a measured attempt over an unmeasured one", () => {
    // null means "we don't know". A known 41 is better evidence than an
    // unknown, in both directions.
    expect(betterAttemptScore(null, 41)).toBe("second");
    expect(betterAttemptScore(41, null)).toBe("first");
  });

  it("keeps the retry on a tie, so no file has to move", () => {
    expect(betterAttemptScore(50, 50)).toBe("second");
    expect(betterAttemptScore(null, null)).toBe("second");
  });

  it("agrees with the decision it is paired with", () => {
    // keepPrevious and betterAttemptScore must never disagree, or the row
    // records one attempt and storage serves the other.
    for (const [a, b] of [
      [61, 38],
      [38, 61],
      [50, 50],
    ] as const) {
      const d = identityGateDecision({ score: b, threshold: 70, retriesUsed: 1, previousScore: a });
      if (d.action !== "settle") throw new Error("expected settle");
      expect(d.keepPrevious).toBe(betterAttemptScore(a, b) === "first");
    }
  });
});

describe("gateLogLine", () => {
  it("says nothing when nothing happened", () => {
    expect(gateLogLine({ action: "pass", reason: "above-threshold" }, false)).toBeNull();
  });

  it("reports the score of the attempt actually kept", () => {
    const d = identityGateDecision({ score: 38, threshold: 70, retriesUsed: 1, previousScore: 61 });
    const line = gateLogLine(d, true)!;
    expect(line).toContain("61");
    expect(line).not.toContain("38");
    expect(line).toContain("first attempt");
  });

  it("REGRESSION: only promises a refund that actually happened", () => {
    // The 2026-08-31 ledger audit found the blank-frame log promising "and
    // refunded" unconditionally while the refund sat behind a switch that
    // was off — a person's own pipeline log contradicting the ledger.
    const d = identityGateDecision({ score: 40, threshold: 70, retriesUsed: 1, previousScore: 39 });
    expect(gateLogLine(d, true)).toContain("has been put back");
    expect(gateLogLine(d, false)).toContain("Contact us");
    expect(gateLogLine(d, false)).not.toContain("has been put back");
  });
});
