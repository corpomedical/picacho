import { describe, expect, it } from "vitest";
import type { LedgerEvent, LedgerInput } from "./ledger.mts";
import { SpendGuard } from "./spend-guard.mts";

function guard(maxUsd: number, replay?: LedgerEvent[]) {
  const events: LedgerInput[] = [];
  const g = new SpendGuard({ maxUsd, sink: (e) => events.push(e), replay });
  return { g, events };
}

describe("SpendGuard", () => {
  it("reserves within the max and refuses — and stops — past it", () => {
    const { g, events } = guard(1);
    expect(g.reserve("astra", 0.6, "b1").ok).toBe(true);
    const over = g.reserve("astra", 0.6, "b2");
    expect(over.ok).toBe(false);
    expect(g.stopped?.reason).toBe("budget");
    expect(g.reserve("astra", 0.1, "b3").ok).toBe(false);
    expect(events.map((e) => e.ev)).toEqual(["reserve", "stop"]);
  });

  it("settles, releases and meters", () => {
    const { g } = guard(10);
    const a = g.reserve("astra", 1.155, "b1");
    const b = g.reserve("astra", 0.53, "b2");
    if (!a.ok || !b.ok) throw new Error("reserve");
    expect(g.committedUsd).toBeCloseTo(1.685, 12);
    g.settle(a.ticket, 0.15, 0.3, "usage (batch)");
    g.release(b.ticket, "not run");
    expect(g.settledUsd).toBeCloseTo(0.15, 12);
    expect(g.settledStandardUsd).toBeCloseTo(0.3, 12);
    expect(g.outstandingUsd).toBe(0);
    g.meter({ host: "api.openai.com", model: "gpt-5.4-mini", usage: {}, usd: 0.01 });
    g.meter({ host: "api.anthropic.com", model: "claude-sonnet-5", usage: {}, usd: null });
    expect(g.meteredUsd).toBeCloseTo(0.01, 12);
    expect(g.unpricedMeterEvents).toBe(1);
    expect(g.committedUsd).toBeCloseTo(0.16, 12);
  });

  it("trips when metered spend reaches the max", () => {
    const { g } = guard(0.05);
    g.meter({ host: "api.openai.com", model: "m", usage: {}, usd: 0.05 });
    expect(g.stopped?.reason).toBe("budget");
  });

  it("records an overshoot of a reservation and stops", () => {
    const { g, events } = guard(10);
    const a = g.reserve("astra", 0.5, "b1");
    if (!a.ok) throw new Error("reserve");
    g.settle(a.ticket, 0.7, 0.7, "usage");
    expect(g.overshoots).toEqual([{ ticket: a.ticket, worstUsd: 0.5, actualUsd: 0.7 }]);
    expect(g.stopped?.reason).toBe("overshoot");
    expect(events.find((e) => e.ev === "settle")).toMatchObject({ basis: expect.stringMatching(/OVERSHOOT/) });
  });

  it("replays a ledger: open reservations count as spent, and can still be settled", () => {
    const t = "2026-09-11T00:00:00.000Z";
    const replay: LedgerEvent[] = [
      { t, ev: "reserve", ticket: "t1", kind: "astra", worstUsd: 0.5, ref: "a" },
      { t, ev: "reserve", ticket: "t2", kind: "astra", worstUsd: 0.5, ref: "b" },
      { t, ev: "settle", ticket: "t1", actualUsd: 0.2, standardUsd: 0.4, basis: "usage" },
      { t, ev: "meter", host: "api.openai.com", model: "m", usage: {}, usd: 0.05 },
      { t, ev: "stop", reason: "sigint", committedUsd: 0.75, maxUsd: 1 },
    ];
    const { g, events } = guard(1, replay);
    expect(events).toEqual([]);
    expect(g.committedUsd).toBeCloseTo(0.75, 12);
    expect(g.stopped).toBeNull();
    expect(g.openTickets().map((x) => x.ticket)).toEqual(["t2"]);
    g.settle("t2", 0.1, 0.2, "usage");
    const next = g.reserve("astra", 0.1, "c");
    expect(next.ok && next.ticket).toBe("t3");
  });

  it("refuses a max that is not a positive number", () => {
    expect(() => new SpendGuard({ maxUsd: 0, sink: () => {} })).toThrow();
    expect(() => new SpendGuard({ maxUsd: Number.NaN, sink: () => {} })).toThrow();
  });
});
