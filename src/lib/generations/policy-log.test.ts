import { beforeEach, describe, expect, it, vi } from "vitest";

// The prompt gate's own brakes (2026-09-30, operator: "fix the remaining
// small ones"): before any paid reader is asked, an account that drew
// PROMPT_REFUSAL_BRAKE refusals in the last hour, or spent the gate's budget
// for ten minutes or a day, is answered at once. Neither answer is a reading,
// so neither is logged as a refusal.

const h = vi.hoisted(() => ({
  refusals: 0,
  role: null as string | null,
  burst: false,
  day: false,
  limits: [] as { scope: string; windowSeconds?: number; max: number }[],
  inserts: [] as unknown[],
  assert: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimited: async (_user: string, scope: string, windowSeconds: number, max: number) => {
    h.limits.push({ scope, windowSeconds, max });
    return h.burst;
  },
  dailyCapReached: async (_user: string, scope: string, max: number) => {
    h.limits.push({ scope: `${scope}-day`, max });
    return h.day;
  },
}));
vi.mock("@/lib/generations/content-policy", async () => ({
  ...(await import("./content-policy")),
  assertPromptAllowed: h.assert,
}));
vi.mock("@/lib/generations/refusal-attribution", () => ({ refusalProviderFor: async () => null }));
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        neq: () => chain,
        gte: () => chain,
        maybeSingle: () => Promise.resolve({ data: { role: h.role }, error: null }),
        insert: (row: unknown) => {
          h.inserts.push(row);
          return Promise.resolve({ error: null });
        },
        then: (resolve: (v: { count: number; error: null }) => unknown) => resolve({ count: h.refusals, error: null }),
      };
      return chain;
    },
  }),
}));

import { ContentPolicyRefusal } from "@/lib/generations/content-policy";
import {
  GATE_BUSY_MESSAGE,
  GATE_REFUSAL_BRAKE_MESSAGE,
  PROMPT_GATES_PER_10_MIN,
  PROMPT_GATES_PER_DAY,
  PROMPT_REFUSAL_BRAKE,
  gatePrompt,
} from "./policy-log";

const USER = "11111111-1111-4111-8111-111111111111";

async function refusalOf(p: Promise<unknown>): Promise<ContentPolicyRefusal> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ContentPolicyRefusal) return err;
    throw err;
  }
  throw new Error("expected a refusal");
}

beforeEach(() => {
  h.refusals = 0;
  h.role = null;
  h.burst = false;
  h.day = false;
  h.limits = [];
  h.inserts = [];
  h.assert.mockReset().mockResolvedValue(undefined);
});

describe("the prompt gate's brakes", () => {
  it("reads as before, with its session context, once under both brakes, and counts one gate in each budget", async () => {
    h.refusals = PROMPT_REFUSAL_BRAKE - 1;
    await expect(gatePrompt({ prompt: "Eva on a rooftop at dusk", userId: USER })).resolves.toMatchObject({ priorHits: PROMPT_REFUSAL_BRAKE - 1 });
    expect(h.assert).toHaveBeenCalledTimes(1);
    expect(h.assert.mock.calls[0][0]).toMatchObject({ sessionPriorHits: PROMPT_REFUSAL_BRAKE - 1 });
    expect(h.limits).toEqual([
      { scope: "prompt-gate", windowSeconds: 600, max: PROMPT_GATES_PER_10_MIN },
      { scope: "prompt-gate-day", max: PROMPT_GATES_PER_DAY },
    ]);
  });

  it("answers at once after PROMPT_REFUSAL_BRAKE refusals in the hour: no reader, no budget spent, nothing logged", async () => {
    h.refusals = PROMPT_REFUSAL_BRAKE;
    const refusal = await refusalOf(gatePrompt({ prompt: "anything", userId: USER }));
    expect(refusal.reason).toBe("unavailable");
    expect(refusal.userMessage).toBe(GATE_REFUSAL_BRAKE_MESSAGE);
    expect(h.assert).not.toHaveBeenCalled();
    expect(h.limits).toEqual([]);
    expect(h.inserts).toEqual([]);
  });

  it("answers at once past the ten-minute budget or the day's, and asks no reader", async () => {
    h.burst = true;
    let refusal = await refusalOf(gatePrompt({ prompt: "anything", userId: USER }));
    expect([refusal.reason, refusal.userMessage]).toEqual(["unavailable", GATE_BUSY_MESSAGE]);
    // The burst brake answered: the day's bucket was not touched.
    expect(h.limits.map((l) => l.scope)).toEqual(["prompt-gate"]);

    h.burst = false;
    h.day = true;
    h.limits = [];
    refusal = await refusalOf(gatePrompt({ prompt: "anything", userId: USER }));
    expect([refusal.reason, refusal.userMessage]).toEqual(["unavailable", GATE_BUSY_MESSAGE]);
    expect(h.assert).not.toHaveBeenCalled();
    expect(h.inserts).toEqual([]);
  });

  it("lets an admin through both, for support and testing", async () => {
    h.role = "admin";
    h.refusals = PROMPT_REFUSAL_BRAKE + 5;
    h.burst = true;
    h.day = true;
    await expect(gatePrompt({ prompt: "Eva on a rooftop at dusk", userId: USER })).resolves.toMatchObject({ priorHits: PROMPT_REFUSAL_BRAKE + 5 });
    expect(h.assert).toHaveBeenCalledTimes(1);
    expect(h.limits).toEqual([]);
  });

  it("still logs a real refusal, once, exactly as before", async () => {
    h.assert.mockRejectedValue(new ContentPolicyRefusal("sexual", "refused"));
    const refusal = await refusalOf(gatePrompt({ prompt: "something refused", userId: USER }));
    expect(refusal.reason).toBe("sexual");
    expect(h.inserts).toHaveLength(1);
  });
});
