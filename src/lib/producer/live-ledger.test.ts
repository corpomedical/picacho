import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  beatLiveCall,
  chargedSeconds,
  closeLiveCall,
  hangUpLiveCall,
  isLiveSessionId,
  LIVE_BLOCK_UNITS,
  liveUnits,
  needsMore,
  openLiveCall,
  sweepLiveCalls,
} from "./live-ledger";

// ---------------------------------------------------------------------------
// A small in-memory stand-in for the two tables and two functions the ledger
// uses, answering the same query-builder chains PostgREST's client builds.
type Row = Record<string, unknown>;
function fakeDb(opts: { allowance?: number } = {}) {
  const tables: Record<string, Row[]> = { producer_live_sessions: [], agent_usage: [] };
  let allowance = opts.allowance ?? 1000;
  let nextId = 1;
  const settles: string[] = [];
  const builder = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let op: { kind: "select" | "update" | "insert"; value?: Row } = { kind: "select" };
    let returning = false;
    let single = false;
    let limit = Infinity;
    const run = () => {
      const rows = tables[table];
      if (op.kind === "insert") {
        const r = { id: `u${nextId++}`, ...op.value };
        if (table === "producer_live_sessions" && rows.some((x) => x.id === r.id)) return { data: null, error: { message: "duplicate" } };
        rows.push(r);
        return { data: null, error: null };
      }
      const hit = rows.filter((r) => filters.every((f) => f(r))).slice(0, limit);
      if (op.kind === "update") {
        for (const r of hit) Object.assign(r, op.value);
        return { data: returning ? hit.map((r) => ({ id: r.id })) : null, error: null };
      }
      if (single) return { data: hit[0] ? { ...hit[0] } : null, error: null };
      return { data: hit.map((r) => ({ ...r })), error: null };
    };
    const b = {
      select() {
        if (op.kind !== "select") returning = true;
        return b;
      },
      insert(value: Row) {
        op = { kind: "insert", value };
        return b;
      },
      update(value: Row) {
        op = { kind: "update", value };
        return b;
      },
      eq(k: string, v: unknown) {
        filters.push((r) => r[k] === v);
        return b;
      },
      is(k: string, v: unknown) {
        filters.push((r) => (r[k] ?? null) === v);
        return b;
      },
      in(k: string, vs: unknown[]) {
        filters.push((r) => vs.includes(r[k]));
        return b;
      },
      or(expr: string) {
        const parts = expr.split(/,(?=[a-z_]+\.)/).map((p) => p.match(/^([a-z_]+)\.lt\."(.+)"$/));
        filters.push((r) => parts.some((m) => !!m && String(r[m[1]]) < m[2]));
        return b;
      },
      order() {
        return b;
      },
      limit(n: number) {
        limit = n;
        return b;
      },
      maybeSingle() {
        single = true;
        return Promise.resolve(run());
      },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
        return Promise.resolve(run()).then(res, rej);
      },
    };
    return b;
  };
  const admin = {
    from: (t: string) => builder(t),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "reserve_agent_units") {
        const units = Number(args.p_units);
        if (units > allowance) return { data: { id: null, topup: 0 }, error: null };
        allowance -= units;
        const id = `r${nextId++}`;
        tables.agent_usage.push({ id, user_id: args.p_user_id, mode: "reserved", units });
        return { data: { id, topup: 0 }, error: null };
      }
      if (fn === "settle_assistant_topup") {
        settles.push(String(args.p_user_id));
        return { data: 0, error: null };
      }
      return { data: null, error: { message: `no ${fn}` } };
    },
  } as unknown as SupabaseClient;
  return { admin, tables, settles, setAllowance: (n: number) => (allowance = n) };
}

const T0 = Date.parse("2026-09-29T10:00:00Z");
const USER = "user-1";

async function started(db: ReturnType<typeof fakeDb>, id = "sess_abc") {
  const reservation = (await db.admin.rpc("reserve_agent_units", { p_user_id: USER, p_units: LIVE_BLOCK_UNITS })).data as { id: string };
  await openLiveCall(db.admin, { id, userId: USER, since: "2026-09-01T00:00:00Z", cap: 2500, reservationId: reservation.id });
  // Opened at T0 (the stand-in has no clock of its own).
  const row = db.tables.producer_live_sessions.find((r) => r.id === id)!;
  row.started_at = row.beat_at = new Date(T0).toISOString();
  return reservation.id;
}

describe("the numbers", () => {
  it("a minute is 3 units; five are held at a time (13)", () => {
    expect(liveUnits(0)).toBe(0);
    expect(liveUnits(1)).toBe(1);
    expect(liveUnits(60)).toBe(3); // $0.05 → 2.5 → 3
    expect(liveUnits(600)).toBe(25); // $0.50
    expect(LIVE_BLOCK_UNITS).toBe(13);
  });

  it("takes OpenAI's count only inside what the heartbeats prove", () => {
    const at = (s: number) => T0 + s * 1000;
    // Honest: inside the bounds.
    expect(chargedSeconds({ startedAt: T0, beatAt: at(60), now: at(95), reported: 92 })).toEqual({ seconds: 92, confirmed: true });
    // Under-reported: at least to the last heartbeat.
    expect(chargedSeconds({ startedAt: T0, beatAt: at(180), now: at(200), reported: 10 })).toEqual({ seconds: 180, confirmed: false });
    // Over-reported: at most since it started (+5 s).
    expect(chargedSeconds({ startedAt: T0, beatAt: at(0), now: at(30), reported: 600 })).toEqual({ seconds: 35, confirmed: false });
    // Nothing reported: a minute past the last heartbeat, never past now.
    expect(chargedSeconds({ startedAt: T0, beatAt: at(120), now: at(400), reported: null })).toEqual({ seconds: 180, confirmed: false });
    expect(chargedSeconds({ startedAt: T0, beatAt: at(120), now: at(130), reported: null })).toEqual({ seconds: 135, confirmed: false });
  });

  it("holds more when the call gets within two minutes of what's held", () => {
    expect(needsMore({ startedAt: T0, now: T0 + 60_000, reservedUnits: 13 })).toBe(false); // 3 min = 8 units
    // 13 units hold 5:12 ($0.26): at 3:13 the call is within two minutes of it.
    expect(needsMore({ startedAt: T0, now: T0 + 191_000, reservedUnits: 13 })).toBe(false);
    expect(needsMore({ startedAt: T0, now: T0 + 193_000, reservedUnits: 13 })).toBe(true);
  });

  it("only a session id goes in the hang-up URL", () => {
    expect(isLiveSessionId("sess_01Kabc-9")).toBe(true);
    expect(isLiveSessionId("../x")).toBe(false);
    expect(isLiveSessionId("a".repeat(201))).toBe(false);
  });
});

describe("a call on the ledger", () => {
  it("heartbeats hold the allowance ahead; the end charges it once, on the first hold", async () => {
    const db = fakeDb();
    const first = await started(db);
    expect(await beatLiveCall(db.admin, { id: "sess_abc", userId: USER, now: T0 + 60_000 })).toEqual({ ok: true });
    expect(db.tables.agent_usage).toHaveLength(1);
    // At 3:20 the call is within two minutes of what 13 units hold (5:12): another block.
    expect(await beatLiveCall(db.admin, { id: "sess_abc", userId: USER, now: T0 + 200_000 })).toEqual({ ok: true });
    expect(db.tables.agent_usage).toHaveLength(2);
    const row = db.tables.producer_live_sessions[0];
    expect(row.reserved_units).toBe(26);
    // Someone else's heartbeat for it is refused.
    expect(await beatLiveCall(db.admin, { id: "sess_abc", userId: "someone", now: T0 + 201_000 })).toEqual({ ok: false, reason: "gone" });

    const r = await closeLiveCall(db.admin, { id: "sess_abc", userId: USER, reported: 200, reason: "ended", now: T0 + 205_000 });
    expect(r).toEqual({ seconds: 200, units: 9, confirmed: true }); // 200 s = $0.1667 → 8.33 → 9
    const [a, b] = db.tables.agent_usage;
    expect(a).toMatchObject({ id: first, mode: "producer-live", units: 9 });
    expect(b).toMatchObject({ mode: "producer-live", units: 0 });
    expect(db.settles).toEqual([USER]);
    // The sweep (or a second close) finds nothing left to charge.
    expect(await closeLiveCall(db.admin, { id: "sess_abc", reported: null, reason: "quiet", now: T0 + 400_000 })).toBeNull();
    expect(db.tables.agent_usage[0].units).toBe(9);
  });

  it("when the allowance runs out, the heartbeat says so", async () => {
    const db = fakeDb({ allowance: 13 });
    await started(db);
    expect(await beatLiveCall(db.admin, { id: "sess_abc", userId: USER, now: T0 + 200_000 })).toEqual({ ok: false, reason: "allowance" });
  });

  it("a quiet page's call is hung up and charged a minute past its last heartbeat", async () => {
    const db = fakeDb();
    await started(db);
    await beatLiveCall(db.admin, { id: "sess_abc", userId: USER, now: T0 + 60_000 });
    const hung: string[] = [];
    const fetchImpl = (async (url: string) => {
      hung.push(url);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    // Two minutes after that heartbeat: not yet stale (2.5 min).
    expect(await sweepLiveCalls(db.admin, { key: "k", now: T0 + 180_000, fetchImpl })).toBe(0);
    expect(await sweepLiveCalls(db.admin, { key: "k", now: T0 + 215_000, fetchImpl })).toBe(1);
    expect(hung).toEqual(["https://api.openai.com/v1/live/sessions/sess_abc/hangup"]);
    const row = db.tables.producer_live_sessions[0];
    expect(row).toMatchObject({ seconds: 120, units: 5, reason: "quiet", confirmed: false });
  });

  it("a new call replaces the person's open one", async () => {
    const db = fakeDb();
    await started(db, "sess_old");
    const fetchImpl = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    expect(await sweepLiveCalls(db.admin, { key: "k", userId: USER, others: true, now: T0 + 30_000, fetchImpl })).toBe(1);
    expect(db.tables.producer_live_sessions[0]).toMatchObject({ reason: "replaced", seconds: 35 });
  });
});

describe("hangUpLiveCall", () => {
  it("posts to OpenAI's hang-up and never throws", async () => {
    const calls: [string, RequestInit][] = [];
    const ok = (async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    expect(await hangUpLiveCall("sess_1", "key", ok)).toBe(true);
    expect(calls[0][0]).toBe("https://api.openai.com/v1/live/sessions/sess_1/hangup");
    expect((calls[0][1].headers as Record<string, string>).authorization).toBe("Bearer key");
    const boom = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    expect(await hangUpLiveCall("sess_1", "key", boom)).toBe(false);
    expect(await hangUpLiveCall("../evil", "key", ok)).toBe(false);
  });
});
