// The money fence for a --spend run. Pure: every event goes to a sink (the
// ledger), and a replayed ledger rebuilds the same state.
//
//   committed = settled + metered + outstanding reservations
//
// reserve() refuses — and stops the run from starting anything new — the
// moment committed plus the next reservation would pass --max-usd. settle()
// replaces a reservation with what the call actually cost; an actual above
// the reservation is recorded as an overshoot and also stops new work.
// meter() adds spend that had no reservation (gate readers, scorers: the
// net guard's tap sees their usage) and stops new work once committed
// reaches the maximum. Metered calls already in flight can still land after
// that, so the summary prints any overshoot of the maximum.
//
// On --resume, open reservations from the old ledger stay counted as spent
// until something settles or releases them: conservative on purpose.

import type { CallKind, LedgerEvent, LedgerInput } from "./ledger.mts";

const EPS = 1e-9;

export type PlannedCall = {
  kind: CallKind;
  label: string;
  count: number;
  /** Worst case per call, US dollars; null when no source prices it. */
  unitUsd: number | null;
  source: string;
  /** Measured by the net guard's meter rather than reserved call by call. */
  metered: boolean;
};

export type PlanCheck = {
  ok: boolean;
  ceilingUsd: number;
  unpriced: string[];
  unacknowledged: string[];
  excessUsd: number;
};

export function checkPlan(plan: readonly PlannedCall[], maxUsd: number, allowUnpriced: readonly string[]): PlanCheck {
  let ceilingUsd = 0;
  const unpriced = new Set<string>();
  for (const line of plan) {
    if (line.count <= 0) continue;
    if (line.unitUsd === null) unpriced.add(line.kind);
    else ceilingUsd += line.count * line.unitUsd;
  }
  const unacknowledged = [...unpriced].filter((k) => !allowUnpriced.includes(k));
  const excessUsd = Math.max(0, ceilingUsd - maxUsd);
  return {
    ok: excessUsd <= EPS && unacknowledged.length === 0,
    ceilingUsd,
    unpriced: [...unpriced],
    unacknowledged,
    excessUsd,
  };
}

type Reservation = { kind: CallKind; worstUsd: number; ref: string };

export type StopReason = "budget" | "sigint" | "config" | "overshoot";

export class SpendGuard {
  readonly maxUsd: number;
  settledUsd = 0;
  /** What the settled calls would have cost at standard (non-Batch) prices. */
  settledStandardUsd = 0;
  meteredUsd = 0;
  unpricedMeterEvents = 0;
  readonly overshoots: { ticket: string; worstUsd: number; actualUsd: number }[] = [];
  stopped: { reason: StopReason; committedUsd: number } | null = null;
  private readonly reserved = new Map<string, Reservation>();
  private readonly sink: (e: LedgerInput) => void;
  private seq = 0;

  constructor(o: { maxUsd: number; sink: (e: LedgerInput) => void; replay?: readonly LedgerEvent[] }) {
    if (!Number.isFinite(o.maxUsd) || o.maxUsd <= 0) throw new Error("maxUsd must be finite and above 0");
    this.maxUsd = o.maxUsd;
    this.sink = o.sink;
    for (const e of o.replay ?? []) this.apply(e);
  }

  private apply(e: LedgerEvent): void {
    switch (e.ev) {
      case "reserve": {
        this.reserved.set(e.ticket, { kind: e.kind, worstUsd: e.worstUsd, ref: e.ref });
        const n = Number(e.ticket.replace(/^t/, ""));
        if (Number.isFinite(n)) this.seq = Math.max(this.seq, n);
        return;
      }
      case "settle":
        this.reserved.delete(e.ticket);
        this.settledUsd += e.actualUsd;
        this.settledStandardUsd += e.standardUsd;
        return;
      case "release":
        this.reserved.delete(e.ticket);
        return;
      case "meter":
        if (e.usd === null) this.unpricedMeterEvents += 1;
        else this.meteredUsd += e.usd;
        return;
      default:
        return;
    }
  }

  get outstandingUsd(): number {
    let s = 0;
    for (const r of this.reserved.values()) s += r.worstUsd;
    return s;
  }

  get committedUsd(): number {
    return this.settledUsd + this.meteredUsd + this.outstandingUsd;
  }

  /** Open reservations, e.g. replayed from a ledger. */
  openTickets(): { ticket: string; kind: CallKind; worstUsd: number; ref: string }[] {
    return [...this.reserved.entries()].map(([ticket, r]) => ({ ticket, ...r }));
  }

  reserve(kind: CallKind, worstUsd: number, ref: string): { ok: true; ticket: string } | { ok: false; reason: string } {
    if (!Number.isFinite(worstUsd) || worstUsd < 0) throw new Error(`reservation for ${ref} is not a price: ${worstUsd}`);
    if (this.stopped) return { ok: false, reason: `stopped (${this.stopped.reason})` };
    if (this.committedUsd + worstUsd > this.maxUsd + EPS) {
      const reason = `budget: committed $${this.committedUsd.toFixed(4)} + next $${worstUsd.toFixed(4)} would pass --max-usd $${this.maxUsd}`;
      this.stop("budget");
      return { ok: false, reason };
    }
    this.seq += 1;
    const ticket = `t${this.seq}`;
    this.reserved.set(ticket, { kind, worstUsd, ref });
    this.sink({ ev: "reserve", ticket, kind, worstUsd, ref });
    return { ok: true, ticket };
  }

  settle(ticket: string, actualUsd: number, standardUsd: number, basis: string, usage?: Record<string, unknown> | null): void {
    const r = this.reserved.get(ticket);
    if (!r) throw new Error(`settle of unknown ticket ${ticket}`);
    this.reserved.delete(ticket);
    const actual = Number.isFinite(actualUsd) && actualUsd > 0 ? actualUsd : 0;
    const standard = Number.isFinite(standardUsd) && standardUsd > 0 ? standardUsd : 0;
    this.settledUsd += actual;
    this.settledStandardUsd += standard;
    const over = actual > r.worstUsd + EPS;
    this.sink({ ev: "settle", ticket, actualUsd: actual, standardUsd: standard, basis: over ? `${basis}; OVERSHOOT of the reservation` : basis, usage: usage ?? null });
    if (over) {
      this.overshoots.push({ ticket, worstUsd: r.worstUsd, actualUsd: actual });
      this.stop("overshoot");
    }
  }

  release(ticket: string, reason: string): void {
    if (!this.reserved.has(ticket)) throw new Error(`release of unknown ticket ${ticket}`);
    this.reserved.delete(ticket);
    this.sink({ ev: "release", ticket, reason });
  }

  meter(e: { host: string; model: string; usage: Record<string, unknown>; usd: number | null; tag?: string; ref?: string }): void {
    this.sink({ ev: "meter", ...e });
    if (e.usd === null) this.unpricedMeterEvents += 1;
    else this.meteredUsd += e.usd;
    if (this.committedUsd >= this.maxUsd - EPS) this.stop("budget");
  }

  stop(reason: StopReason): void {
    if (this.stopped) return;
    this.stopped = { reason, committedUsd: this.committedUsd };
    this.sink({ ev: "stop", reason, committedUsd: this.committedUsd, maxUsd: this.maxUsd });
  }

  /** Spend past --max-usd that landed after the stop (metered calls in flight). */
  get overMaxUsd(): number {
    return Math.max(0, this.settledUsd + this.meteredUsd - this.maxUsd);
  }
}
