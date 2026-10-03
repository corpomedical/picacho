import { describe, expect, it, vi } from "vitest";
import { EDITOR_MODEL_ID, failedToday, HOLD_BACKSTOP_MS, placeHold, settleForgottenHolds, settleHold, type Allowance } from "./charge";

type Row = Record<string, unknown>;

/** Just enough of supabase-js for charge.ts: generations rows, reserve_generations and the two balance adds. */
function fakeDb(rows: Row[] = []) {
  const rpcs: [string, Record<string, unknown>][] = [];
  function query() {
    const filters: ((r: Row) => boolean)[] = [];
    let patch: Row | null = null;
    let head = false;
    const api = {
      select: (_c?: string, opts?: { head?: boolean }) => ((head = Boolean(opts?.head)), api),
      update: (p: Row) => ((patch = p), api),
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), api),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), api),
      gte: (k: string, v: string) => (filters.push((r) => String(r[k]) >= v), api),
      lt: (k: string, v: string) => (filters.push((r) => String(r[k]) < v), api),
      limit: () => api,
      run() {
        const hits = rows.filter((r) => filters.every((f) => f(r)));
        if (patch) for (const r of hits) Object.assign(r, patch);
        return { data: hits.map((r) => ({ ...r })), error: null, count: head ? hits.length : null };
      },
      maybeSingle: async () => ({ data: api.run().data[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve(api.run()),
    };
    return api;
  }
  const db = {
    from: () => query(),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push([fn, args]);
      if (fn === "reserve_generations") {
        const row = (args.p_rows as Row[])[0];
        rows.push({ ...row, user_id: args.p_user_id, created_at: new Date().toISOString() });
        return { data: [row.id], error: null };
      }
      return { data: null, error: null };
    },
  };
  return { db: db as never, rows, rpcs };
}

const deps = (db: never, allowance: Allowance, spends = { purchased: true, bonus: true }) => ({
  admin: db,
  allowance: vi.fn(async () => allowance),
  consumePurchased: vi.fn(async () => spends.purchased),
  consumeBonus: vi.fn(async () => spends.bonus),
});

const input = { userId: "u1", rowId: "h1", credits: 17, modelId: EDITOR_MODEL_ID, prompt: "Make shorts", detail: "holding 17", hidden: true };

describe("placeHold", () => {
  it("holds the credits on one hidden row, monthly first, the bought part from the balance", async () => {
    const { db, rows, rpcs } = fakeDb();
    const d = deps(db, { error: null, isAdmin: false, consumePurchased: 5, monthlyLimit: 30, periodStartIso: "2026-10-01T00:00:00Z" });
    expect(await placeHold(d, input)).toEqual({ error: null, rowId: "h1", credits: 17 });
    expect(rpcs[0][1]).toMatchObject({ p_user_id: "u1", p_monthly_portion: 12, p_limit: 30 });
    expect(rows[0]).toMatchObject({ id: "h1", status: "generating", model_id: EDITOR_MODEL_ID, credits_used: 17, purchased_credits_used: 5, bonus_credits_used: 0 });
    expect(typeof rows[0].deleted_at).toBe("string");
    expect(d.consumePurchased).toHaveBeenCalledWith(5);
  });

  it("charges an admin nothing and writes nothing", async () => {
    const { db, rows } = fakeDb();
    expect(await placeHold(deps(db, { error: null, isAdmin: true }), input)).toEqual({ error: null, rowId: null, credits: 0 });
    expect(rows).toHaveLength(0);
  });

  it("refuses when the allowance can't cover it, before anything is written", async () => {
    const { db, rows } = fakeDb();
    const held = await placeHold(deps(db, { error: "You only have 12 left.", isAdmin: false }), input);
    expect(held).toEqual({ error: "You only have 12 left.", code: "noCredits" });
    expect(rows).toHaveLength(0);
  });

  it("closes the row when the bought credits were spent elsewhere in the meantime", async () => {
    const { db, rows } = fakeDb();
    const held = await placeHold(deps(db, { error: null, isAdmin: false, consumePurchased: 17 }, { purchased: false, bonus: true }), input);
    expect(held).toMatchObject({ code: "noCredits" });
    expect(rows[0]).toMatchObject({ status: "failed", credits_used: 0, purchased_credits_used: 0 });
  });
});

describe("settleHold", () => {
  const held = (): Row => ({ id: "h1", user_id: "u1", status: "generating", credits_used: 17, purchased_credits_used: 2, bonus_credits_used: 4, result_url: null, model_id: EDITOR_MODEL_ID, created_at: "2026-10-03T00:00:00Z" });

  it("keeps the charge and gives the rest back: bought first, then bonus, then the month", async () => {
    const { db, rows, rpcs } = fakeDb([held()]);
    expect(await settleHold(db, "h1", { charge: 9, outcome: "succeeded", detail: "used 9" })).toEqual({ settled: true, charged: 9, refunded: 8 });
    expect(rows[0]).toMatchObject({ status: "succeeded", credits_used: 9, purchased_credits_used: 0, bonus_credits_used: 0 });
    expect(rpcs).toEqual([
      ["add_purchased_credits", { p_user_id: "u1", p_amount: 2 }],
      ["add_bonus_credits", { p_user_id: "u1", p_amount: 4 }],
    ]);
  });

  it("never keeps more than it held, and runs once", async () => {
    const { db, rows, rpcs } = fakeDb([held()]);
    await settleHold(db, "h1", { charge: 40, outcome: "succeeded", detail: "x" });
    expect(rows[0].credits_used).toBe(17);
    expect(await settleHold(db, "h1", { charge: 1, outcome: "succeeded", detail: "x" })).toMatchObject({ settled: false });
    expect(await settleHold(db, "h1", { charge: 0, outcome: "failed", detail: "x" })).toMatchObject({ settled: true, refunded: 17 });
    expect(await settleHold(db, "h1", { charge: 0, outcome: "failed", detail: "x" })).toMatchObject({ settled: false });
    expect(rpcs.filter(([fn]) => fn === "add_purchased_credits")).toHaveLength(1);
  });
});

describe("the backstop and the daily brake", () => {
  it("gives back a hold nothing settled within three hours; a cut whose video landed keeps it, free", async () => {
    const now = Date.parse("2026-10-03T12:00:00Z");
    const old = new Date(now - HOLD_BACKSTOP_MS - 1000).toISOString();
    const { db, rows } = fakeDb([
      { id: "a", user_id: "u1", status: "generating", credits_used: 17, purchased_credits_used: 0, bonus_credits_used: 0, result_url: null, model_id: EDITOR_MODEL_ID, created_at: old },
      { id: "b", user_id: "u1", status: "generating", credits_used: 10, purchased_credits_used: 0, bonus_credits_used: 0, result_url: "https://x/b.mp4", model_id: EDITOR_MODEL_ID, created_at: old },
      { id: "c", user_id: "u1", status: "generating", credits_used: 17, purchased_credits_used: 0, bonus_credits_used: 0, result_url: null, model_id: EDITOR_MODEL_ID, created_at: new Date(now - 60_000).toISOString() },
    ]);
    expect(await settleForgottenHolds(db, now)).toBe(2);
    expect(rows.map((r) => [r.id, r.status, r.credits_used])).toEqual([
      ["a", "failed", 0],
      ["b", "succeeded", 0],
      ["c", "generating", 17],
    ]);
  });

  it("counts a day's failed cuts and changes", async () => {
    const now = Date.parse("2026-10-03T12:00:00Z");
    const { db } = fakeDb([
      { id: "a", user_id: "u1", status: "failed", model_id: EDITOR_MODEL_ID, created_at: "2026-10-03T10:00:00Z" },
      { id: "b", user_id: "u1", status: "failed", model_id: EDITOR_MODEL_ID, created_at: "2026-10-01T10:00:00Z" },
      { id: "c", user_id: "u1", status: "succeeded", model_id: EDITOR_MODEL_ID, created_at: "2026-10-03T10:00:00Z" },
    ]);
    expect(await failedToday(db, "u1", now)).toBe(1);
  });
});
