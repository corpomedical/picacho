import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/stripe/client", () => ({ stripe: {} }));
const { chargeState, OPEN_DISPUTE_STATUSES } = await import("./payments");
const { applyUserFilters, searchTerm } = await import("./user-search");

describe("a Stripe charge as the Payments page names it", () => {
  const base = { status: "succeeded" as const, refunded: false, amount_refunded: 0, disputed: false };
  it("a dispute outranks everything, then refunds, then failure", () => {
    expect(chargeState({ ...base, disputed: true, refunded: true })).toBe("disputed");
    expect(chargeState({ ...base, refunded: true, amount_refunded: 1900 })).toBe("refunded");
    expect(chargeState({ ...base, amount_refunded: 500 })).toBe("partly refunded");
    expect(chargeState({ ...base, status: "failed" })).toBe("failed");
    expect(chargeState({ ...base, status: "pending" })).toBe("pending");
    expect(chargeState(base)).toBe("paid");
  });
  it("only disputes Stripe still waits on count as open", () => {
    expect(OPEN_DISPUTE_STATUSES.has("needs_response")).toBe(true);
    expect(OPEN_DISPUTE_STATUSES.has("warning_needs_response")).toBe(true);
    expect(OPEN_DISPUTE_STATUSES.has("won")).toBe(false);
  });
});

describe("Users search", () => {
  it("drops what would break out of the or() filter", () => {
    expect(searchTerm("rosa,role.eq.admin")).toBe("rosa role.eq.admin");
    expect(searchTerm("  (x)*% ")).toBe("x");
    expect(searchTerm(undefined)).toBe("");
  });
  it("an id pasted whole is an exact match; anything else searches email and name", () => {
    const calls: string[] = [];
    const q = {
      eq(c: string, v: string | boolean) {
        calls.push(`eq ${c} ${v}`);
        return q;
      },
      or(f: string) {
        calls.push(`or ${f}`);
        return q;
      },
    };
    applyUserFilters(q, "00000000-0000-4000-8000-000000000002", "suspended");
    applyUserFilters(q, "rosa", "all");
    expect(calls).toEqual([
      "eq id 00000000-0000-4000-8000-000000000002",
      "eq status suspended",
      "or email.ilike.%rosa%,full_name.ilike.%rosa%",
    ]);
  });
});
