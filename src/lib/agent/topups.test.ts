import { describe, expect, it, vi } from "vitest";
import { ASSISTANT_TOPUPS, getAssistantTopUp, topUpCheckoutHref } from "./topups";
import { AGENT_UNIT_USD } from "./prices";
import { PRODUCER_UNIT_USD } from "../producer/prices";
import { isMissingInDatabase, reserveAssistantUnits, settleAssistantTopUp } from "./allowance";

describe("assistant top-up packs", () => {
  it("are the operator's picks: 500 for 19, 1,250 for 45, 2,500 for 85", () => {
    expect(ASSISTANT_TOPUPS.map((t) => [t.units, t.price])).toEqual([
      [500, 19],
      [1250, 45],
      [2500, 85],
    ]);
  });

  it("charge about twice what the units cost us, never under 1.7×, in both assistants' unit", () => {
    expect(AGENT_UNIT_USD).toBe(PRODUCER_UNIT_USD);
    for (const t of ASSISTANT_TOPUPS) {
      const cost = t.units * AGENT_UNIT_USD;
      expect(t.price / cost).toBeGreaterThanOrEqual(1.7);
      expect(t.price / cost).toBeLessThanOrEqual(2);
    }
  });

  it("have unique ids and a bigger pack is never dearer per unit", () => {
    expect(new Set(ASSISTANT_TOPUPS.map((t) => t.id)).size).toBe(ASSISTANT_TOPUPS.length);
    for (let i = 1; i < ASSISTANT_TOPUPS.length; i++) {
      const a = ASSISTANT_TOPUPS[i - 1];
      const b = ASSISTANT_TOPUPS[i];
      expect(b.units).toBeGreaterThan(a.units);
      expect(b.price / b.units).toBeLessThanOrEqual(a.price / a.units);
    }
  });

  it("are looked up by id only", () => {
    expect(getAssistantTopUp("assistant-500")?.units).toBe(500);
    expect(getAssistantTopUp("small")).toBeUndefined();
    expect(getAssistantTopUp(null)).toBeUndefined();
  });

  it("open the embedded checkout and come back through its return allowlist", () => {
    const href = topUpCheckoutHref("assistant-1250", "/app/generate");
    expect(href).toBe("/app/checkout?topup=assistant-1250&return_to=%2Fapp%2Fgenerate");
    const back = new URLSearchParams(href.split("?")[1]).get("return_to") ?? "";
    // checkout-core.ts's allowlist for return paths.
    expect(/^\/app\/[a-z0-9/-]*$/i.test(back)).toBe(true);
  });
});

type Call = { fn: string; args: unknown };
function fakeAdmin(answers: Record<string, { data: unknown; error: { code?: string; message: string } | null }>) {
  const calls: Call[] = [];
  const admin = {
    rpc: async (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return answers[fn] ?? { data: null, error: { code: "PGRST202", message: `Could not find the function public.${fn}` } };
    },
  };
  return { admin: admin as never, calls };
}

describe("reserving assistant units", () => {
  const a = { userId: "u1", since: "2026-09-01T00:00:00.000Z", cap: 2500, units: 40 };

  it("reads the reservation and the top-up balance", async () => {
    const { admin, calls } = fakeAdmin({ reserve_agent_units: { data: { id: "row-1", topup: 450 }, error: null } });
    expect(await reserveAssistantUnits(admin, a)).toEqual({ ok: true, id: "row-1", topUp: 450 });
    expect(calls).toEqual([{ fn: "reserve_agent_units", args: { p_user_id: "u1", p_since: a.since, p_cap: 2500, p_units: 40 } }]);
  });

  it("says the limit is reached with a null id", async () => {
    const { admin } = fakeAdmin({ reserve_agent_units: { data: { id: null, topup: 0 }, error: null } });
    expect(await reserveAssistantUnits(admin, a)).toEqual({ ok: true, id: null, topUp: 0 });
  });

  it("falls back to the old function before the SQL has run", async () => {
    const { admin, calls } = fakeAdmin({ record_agent_units: { data: "row-2", error: null } });
    expect(await reserveAssistantUnits(admin, a)).toEqual({ ok: true, id: "row-2", topUp: 0 });
    expect(calls.map((c) => c.fn)).toEqual(["reserve_agent_units", "record_agent_units"]);
  });

  it("fails closed on any other database error (no fallback)", async () => {
    const { admin, calls } = fakeAdmin({ reserve_agent_units: { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } } });
    expect(await reserveAssistantUnits(admin, a)).toEqual({ ok: false, error: "canceling statement due to statement timeout" });
    expect(calls).toHaveLength(1);
  });

  it("settles quietly before the SQL has run, and says so when it really fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await settleAssistantTopUp(fakeAdmin({}).admin, a);
    expect(spy).not.toHaveBeenCalled();
    await settleAssistantTopUp(fakeAdmin({ settle_assistant_topup: { data: null, error: { code: "08006", message: "connection failure" } } }).admin, a);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("knows PostgREST's and Postgres's 'not there' answers", () => {
    expect(isMissingInDatabase({ code: "PGRST202", message: "" })).toBe(true);
    expect(isMissingInDatabase({ code: "42883", message: "function does not exist" })).toBe(true);
    expect(isMissingInDatabase({ code: "42703", message: 'column profiles.assistant_topup_units does not exist' })).toBe(true);
    expect(isMissingInDatabase({ code: "23505", message: "duplicate key value" })).toBe(false);
    expect(isMissingInDatabase(null)).toBe(false);
  });
});
