import { describe, expect, it } from "vitest";
import { readElevenLabs, readHeygen } from "./provider-funds";

const now = new Date("2026-10-02T12:00:00Z");

describe("readElevenLabs", () => {
  it("shows what is left of the month's credits and when they reset", () => {
    const r = readElevenLabs(
      { character_count: 40_000, character_limit: 100_000, next_character_count_reset_unix: Date.UTC(2026, 9, 12) / 1000 },
      now,
    );
    expect(r).toEqual({ kind: "live", amount: 60_000, unit: "credits", of: 100_000, note: "resets 12 Oct", low: false });
  });

  it("is low under a tenth of the allowance, and never below zero", () => {
    expect(readElevenLabs({ character_count: 95_000, character_limit: 100_000 }, now)).toMatchObject({ amount: 5_000, low: true });
    expect(readElevenLabs({ character_count: 120_000, character_limit: 100_000 }, now)).toMatchObject({ amount: 0, low: true });
  });

  it("says so when the answer has no counts", () => {
    expect(readElevenLabs({ detail: { status: "missing_permissions" } }, now).kind).toBe("error");
    expect(readElevenLabs(null, now).kind).toBe("error");
  });
});

describe("readHeygen", () => {
  it("reads the API wallet first", () => {
    expect(readHeygen({ data: { wallet: { currency: "USD", remaining_balance: 42.5 } } })).toMatchObject({
      kind: "live",
      amount: 42.5,
      unit: "USD",
    });
  });

  it("falls back to plan and add-on credits when there is no wallet balance", () => {
    expect(
      readHeygen({
        data: {
          wallet: { currency: "USD", remaining_balance: null },
          subscription: { credits: { premium_credits: { remaining: 30 }, add_on_credits: { remaining: 5 } } },
        },
      }),
    ).toMatchObject({ kind: "live", amount: 35, unit: "credits" });
  });

  it("says so when there is nothing to read", () => {
    expect(readHeygen({ data: {} }).kind).toBe("error");
  });
});
