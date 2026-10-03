import { describe, expect, it } from "vitest";
import { USD_PER_CREDIT } from "../effects/catalog";
import { RECAST_COST_BASIS_USD_PER_CREDIT } from "../recast/recast";
import { PRICING_TIERS } from "../pricing";
import {
  changeHold,
  CHANGE_BUDGET_USD,
  composeCredits,
  CREDIT_USD,
  CUT_BUDGET_USD,
  cutHold,
  exportCredits,
  MEASURED_CUT_USD,
  OVERSHOOT_USD,
  turnCharge,
  typicalCut,
} from "./pricing";
import { composeCostUsd } from "./composer";

// The prices the operator approved on 2026-10-03 ("Pay what it uses", every
// paid plan): a cut holds up to 17, a change up to 10, most cuts come to
// 8–11, three ElevenLabs takes 7, ACE drafts 1, an export 1.
describe("Director's Cut prices", () => {
  it("prices on the house's credit, the one every lane uses", () => {
    expect(CREDIT_USD).toBe(USD_PER_CREDIT);
    expect(CREDIT_USD).toBe(RECAST_COST_BASIS_USD_PER_CREDIT);
  });

  it("holds what he approved for a typical pile", () => {
    expect(cutHold(0)).toBe(17);
    expect(cutHold(500e6)).toBe(17);
    expect(changeHold(0)).toBe(10);
    expect(typicalCut()).toEqual({ low: 8, high: 11 });
    expect(composeCredits("eleven", 60, 3)).toBe(7);
    expect(composeCredits("eleven", 60, 1)).toBe(3);
    expect(composeCredits("ace", 60, 3)).toBe(1);
    expect(exportCredits(60)).toBe(1);
    expect(exportCredits(120)).toBe(1);
    expect(exportCredits(150)).toBe(2);
  });

  it("never loses money: a hold carries Opus's whole budget, the overshoot and the download", () => {
    for (const bytes of [0, 50e6, 1e9, 12e9]) {
      expect(cutHold(bytes) * CREDIT_USD).toBeGreaterThanOrEqual(CUT_BUDGET_USD + OVERSHOOT_USD + (bytes / 1e9) * 0.09);
      expect(changeHold(bytes) * CREDIT_USD).toBeGreaterThanOrEqual(CHANGE_BUDGET_USD + OVERSHOOT_USD + (bytes / 1e9) * 0.09);
    }
    // Every real cut so far fits inside the budget with room to spare.
    for (const usd of MEASURED_CUT_USD) expect(usd).toBeLessThan(CUT_BUDGET_USD * 0.75);
    // Music: the credits cover fal's list price at every length and take count.
    for (const engine of ["eleven", "ace"] as const)
      for (const seconds of [5, 30, 60, 61, 240])
        for (const takes of [1, 2, 3]) expect(composeCredits(engine, seconds, takes) * CREDIT_USD).toBeGreaterThanOrEqual(composeCostUsd(engine, seconds, takes));
  });

  it("charges a finished turn what it used, rounded up, and never more than it held", () => {
    expect(turnCharge({ sessionUsd: 2.09, whisperUsd: 0.006, footageBytes: 50e6, held: 17 })).toBe(8);
    expect(turnCharge({ sessionUsd: 2.77, whisperUsd: 0.024, footageBytes: 500e6, held: 17 })).toBe(11);
    expect(turnCharge({ sessionUsd: 4.6, whisperUsd: 0.24, footageBytes: 0, held: 17 })).toBe(17);
    expect(turnCharge({ sessionUsd: 0.01, whisperUsd: 0, footageBytes: 0, held: 10 })).toBe(1);
  });

  it("keeps every plan's monthly credit worth more than its worst-case cost", () => {
    // Worst money a plan brings in per credit: price / 1.27 (27% VAT inside) × 0.96 (card, Billing, Tax) − $0.27 a charge.
    for (const tier of PRICING_TIERS) {
      const net = ((tier.price / 1.27) * 0.96 - 0.27) / tier.credits;
      expect(1 - CREDIT_USD / net, tier.id).toBeGreaterThanOrEqual(0.3);
    }
  });
});
