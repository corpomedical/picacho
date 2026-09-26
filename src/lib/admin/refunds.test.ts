import { describe, expect, it } from "vitest";
import { onlyRefunded, refundLimit, wasRefunded, type RefundRow } from "./refunds";

// Admin → Users → the person, the Refunds list (2026-09-26). It listed only
// rows stamped refunded_at, which a forced refund never is, and its amounts
// read 0 because a refund zeroes what they added up. These pin which renders
// count as refunded, that the page's query picks exactly those, and which
// daily limit each one says it counted toward.

const row = (over: Partial<RefundRow>): RefundRow => ({
  status: "failed",
  credits_used: 0,
  purchased_credits_used: 0,
  bonus_credits_used: 0,
  free_generation_used: false,
  refunded_at: null,
  identity_gated_at: null,
  ...over,
});

const STAMP = "2026-09-26T08:00:00Z";

// Every shape refundGenerationCosts can leave behind, and the ones it can't.
const CASES: { name: string; row: RefundRow; refunded: boolean }[] = [
  { name: "a refund behind the switch: zeroed and stamped", row: row({ refunded_at: STAMP }), refunded: true },
  // The rows the old list missed: a refusal, a provider rejection, a rules
  // block, a stop before anything rendered.
  { name: "a forced refund: zeroed, never stamped", row: row({}), refunded: true },
  {
    name: "a face-check miss: delivered, zeroed, settled",
    row: row({ status: "succeeded", identity_gated_at: STAMP }),
    refunded: true,
  },
  { name: "withheld at the daily limit: the plan's credits kept", row: row({ credits_used: 3 }), refunded: false },
  {
    name: "a bought-credit refund whose add failed: the record put back",
    row: row({ purchased_credits_used: 2, refunded_at: STAMP }),
    refunded: false,
  },
  { name: "bonus credits still spent", row: row({ bonus_credits_used: 1 }), refunded: false },
  { name: "the day's free render still used", row: row({ free_generation_used: true }), refunded: false },
  {
    name: "a face-check miss over its limit: settled, credits kept",
    row: row({ status: "succeeded", identity_gated_at: STAMP, credits_used: 2 }),
    refunded: false,
  },
  { name: "a render that delivered and kept its charge", row: row({ status: "succeeded", credits_used: 1 }), refunded: false },
  { name: "still rendering", row: row({ status: "generating", credits_used: 1 }), refunded: false },
];

describe("which renders count as refunded", () => {
  for (const c of CASES) {
    it(c.name, () => {
      expect(wasRefunded(c.row)).toBe(c.refunded);
    });
  }

  it("REGRESSION: a refund with no refunded_at is still a refund", () => {
    // What "refunded_at is set" said about the commonest refund of all, a
    // likeness refusal on Seedance: nothing. The credits were back all along.
    const refusal = row({});
    expect(refusal.refunded_at).toBeNull();
    expect(wasRefunded(refusal)).toBe(true);
  });
});

// A stand-in for the Supabase builder: records the filters onlyRefunded sends,
// then applies them to a row the way PostgREST would. It knows only eq and
// the two or-terms in use; anything else throws, so a change to the query
// fails here until this knows what the new filter means.
function recordFilters() {
  const eqs: [string, unknown][] = [];
  const ors: string[] = [];
  const builder = {
    eq(column: string, value: unknown) {
      eqs.push([column, value]);
      return builder;
    },
    or(filters: string) {
      ors.push(filters);
      return builder;
    },
  };
  const term = (r: RefundRow, t: string): boolean => {
    const eq = /^(\w+)\.eq\.(\w+)$/.exec(t);
    if (eq) return String(r[eq[1] as keyof RefundRow]) === eq[2];
    const notNull = /^(\w+)\.not\.is\.null$/.exec(t);
    if (notNull) return r[notNull[1] as keyof RefundRow] != null;
    throw new Error(`the test doesn't know this filter: ${t}`);
  };
  const matches = (r: RefundRow) =>
    eqs.every(([column, value]) => r[column as keyof RefundRow] === value) &&
    ors.every((group) => group.split(",").some((t) => term(r, t)));
  return { builder, matches };
}

describe("the Refunds query picks exactly the refunded renders", () => {
  it("row for row, the filters agree with wasRefunded", () => {
    const { builder, matches } = recordFilters();
    expect(onlyRefunded(builder)).toBe(builder);
    for (const c of CASES) {
      expect(matches(c.row), c.name).toBe(c.refunded);
    }
  });
});

describe("which daily limit a refund counted toward", () => {
  it("a stamped refund counted toward the plan's daily limit", () => {
    expect(refundLimit(row({ refunded_at: STAMP }))).toBe("failures");
  });
  it("a face-check miss counted toward its own limit", () => {
    expect(refundLimit(row({ status: "succeeded", identity_gated_at: STAMP }))).toBe("face-check");
  });
  it("a forced refund counted toward none", () => {
    expect(refundLimit(row({}))).toBe("none");
  });
});
