import { describe, expect, it } from "vitest";
import { isProviderBalanceFailure } from "./report-constants";

// Incident-replay tests, same spirit as send-plan.test.ts: the positive
// cases are the real provider strings that motivated the detector, the
// negative cases are the ordinary failures and in-product copy that must
// NEVER page the operator as a balance lock.

describe("isProviderBalanceFailure", () => {
  it("matches the 2026-08-25 fal.ai lock verbatim", () => {
    expect(
      isProviderBalanceFailure(
        "User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing.",
      ),
    ).toBe(true);
  });

  it("matches each fal lock phrase on its own (messages get truncated to 500 chars)", () => {
    expect(isProviderBalanceFailure("User is locked.")).toBe(true);
    expect(isProviderBalanceFailure("Reason: Exhausted balance")).toBe(true);
    expect(isProviderBalanceFailure("Top up your balance at fal.ai")).toBe(true);
  });

  it("matches OpenAI's quota wording", () => {
    expect(
      isProviderBalanceFailure(
        "You exceeded your current quota, please check your plan and billing details.",
      ),
    ).toBe(true);
  });

  it("matches generic insufficient-balance and 402 language", () => {
    expect(isProviderBalanceFailure("Insufficient balance")).toBe(true);
    expect(isProviderBalanceFailure("insufficient credits in account")).toBe(true);
    expect(isProviderBalanceFailure("402 Payment Required")).toBe(true);
  });

  it("ignores ordinary render failures", () => {
    expect(isProviderBalanceFailure("Internal server error")).toBe(false);
    expect(isProviderBalanceFailure("The request timed out after 300s.")).toBe(false);
    expect(isProviderBalanceFailure("Your request was rejected by the safety system.")).toBe(false);
    expect(isProviderBalanceFailure("The result was missing: outfit.")).toBe(false);
    expect(isProviderBalanceFailure("Generation failed after 3 attempts.")).toBe(false);
  });

  it("ignores Picacho's own out-of-credits copy (a user out of OUR credits is not an outage)", () => {
    expect(
      isProviderBalanceFailure("Seedance 2.0 at 5s needs 15 credits — you have 3."),
    ).toBe(false);
  });
});
