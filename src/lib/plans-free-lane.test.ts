import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { onDailyFreeTier, freeSlotOpen } from "./plans";

// The daily-free-lane rule used to be re-derived in five places with five
// clause sets (2026-09-05 audit); it now lives in plans.ts, and this pins
// its semantics to the authoritative SQL guard's.

describe("onDailyFreeTier", () => {
  it("plan none with no bonus is the free tier", () => {
    expect(onDailyFreeTier("none", 0)).toBe(true);
    expect(onDailyFreeTier(null, null)).toBe(true);
    expect(onDailyFreeTier(undefined, undefined)).toBe(true);
  });

  it("a plan or a bonus grant leaves the daily lane", () => {
    expect(onDailyFreeTier("basic", 0)).toBe(false);
    expect(onDailyFreeTier("none", 5)).toBe(false);
  });
});

describe("freeSlotOpen mirrors the RPC's UTC-midnight guard", () => {
  // spend_daily_free_generation: free_generation_last_at IS NULL OR
  // < date_trunc('day', now()) — Supabase runs in UTC.
  const now = new Date("2026-09-05T10:30:00.000Z");

  it("never used means open", () => {
    expect(freeSlotOpen(null, now)).toBe(true);
    expect(freeSlotOpen(undefined, now)).toBe(true);
  });

  it("used yesterday (UTC) means open again", () => {
    expect(freeSlotOpen("2026-09-04T23:59:59.999Z", now)).toBe(true);
  });

  it("used at today's UTC midnight exactly means spent", () => {
    // date_trunc('day') boundary: a spend AT midnight belongs to today.
    expect(freeSlotOpen("2026-09-05T00:00:00.000Z", now)).toBe(false);
  });

  it("used earlier today (UTC) means spent", () => {
    expect(freeSlotOpen("2026-09-05T09:00:00.000Z", now)).toBe(false);
  });

  it("a local-timezone yesterday that is a UTC today still counts as spent", () => {
    // The drift the five hand-kept copies risked: someone west of UTC at
    // 20:00 local on the 4th is at 03:00 UTC on the 5th — the RPC counts
    // that spend against the 5th, and so must we.
    const lateEveningWest = new Date("2026-09-05T03:00:00.000Z");
    expect(freeSlotOpen("2026-09-05T01:00:00.000Z", lateEveningWest)).toBe(false);
  });
});

describe("the SQL guard this mirrors still says what we mirror", () => {
  it("spend_daily_free_generation keeps the date_trunc day guard", () => {
    const sql = readFileSync(
      new URL("../../supabase/applied/2026-08-19/daily-trial.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("free_generation_last_at");
    expect(sql).toMatch(/date_trunc\('day', now\(\)\)/);
  });
});
