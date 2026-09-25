import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ONE REQUEST, CHARGED ONCE (Press Tour cut 0, 2026-09-25).
//
// runApiImageGeneration minted a fresh row id on every call, so an MCP host
// retrying a generate_image whose answer it never saw reserved, charged and
// rendered a second image. With an idempotency_key the row's primary key is
// made from the key: a retry finds the first request's row and answers with
// its take, and two deliveries racing meet at reserve_generation's primary
// key, where the second follows the first. The reservation IS the charge
// (reserve_generation inserts the row that getMonthlyUsage sums), so
// "charged once" is "reserved once" — counted here.
//
// generate.ts imports through "@/", which this suite does not resolve. The
// database is an in-memory stand-in with reserve_generation's one property
// that matters here (a taken id is Postgres 23505); the render, the gates and
// the credit check are stood in for. The repeat follower, the idempotency
// rules and the media URLs are the real modules.

const h = vi.hoisted(() => ({
  pipeline: vi.fn(),
  gate: vi.fn(),
  allowance: vi.fn(),
  refund: vi.fn(),
}));

vi.mock("@/lib/generations/send-plan", () => ({ resolveSendPlan: () => ({ entries: [], issues: [] }) }));
vi.mock("@/lib/generations/pipeline", () => ({ runRealPipeline: h.pipeline }));
vi.mock("@/lib/generations/core", () => ({
  checkGenerationAllowance: h.allowance,
  consumeBonusCredits: async () => true,
  consumePurchasedCredits: async () => true,
  consumeFreeGeneration: async () => true,
  persistGeneratedImage: async () => null,
}));
vi.mock("@/lib/generations/job-runner", () => ({ refundGenerationCosts: h.refund }));
vi.mock("@/lib/generations/refund-rules", () => ({ forceRefundEligible: () => false }));
vi.mock("@/lib/generations/providers/openai", () => ({ scoreIdentityMatch: async () => null }));
vi.mock("@/lib/generations/content-policy", () => ({
  ContentPolicyRefusal: class ContentPolicyRefusal extends Error {
    constructor(readonly userMessage: string) {
      super(userMessage);
    }
  },
}));
vi.mock("@/lib/generations/policy-log", () => ({ gatePrompt: h.gate }));
vi.mock("@/lib/push/low-credits", () => ({ maybeNotifyLowCredits: async () => {} }));
vi.mock("@/lib/media/url", async () => await import("../media/url"));
vi.mock("@/lib/generations/repeat-send", async () => await import("../generations/repeat-send"));
vi.mock("@/lib/api/idempotency", async () => await import("./idempotency"));
vi.mock("@/lib/api/plain-errors", async () => await import("./plain-errors"));

import { runApiImageGeneration } from "./generate";
import { IDEMPOTENCY_KEY_REUSED, IDEMPOTENT_TAKE_DELETED, idempotentGenerationId } from "./idempotency";
import { PLAIN_FREE_USED_TODAY } from "./plain-errors";

const SERVICE_KEY = "test-service-role";
vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
vi.stubEnv("MEDIA_SIGNING_SECRET", "test-only");

const ORIGIN = "https://picacho.ai";
const PROMPT = "Eva on a rooftop at golden hour";

type Row = Record<string, unknown>;

/**
 * The service-role client as generate.ts and the repeat follower use it:
 * generations and feature_flags with eq/is/in filters, UPDATE, and
 * reserve_generation, which inserts the row under p_row.id (or a fresh one)
 * and answers a taken id with 23505 exactly as the primary key does.
 */
function fakeDb() {
  const db = {
    generations: [] as Row[],
    generation_jobs: [] as Row[],
    feature_flags: [
      { key: "real_ai_providers", enabled: true },
      { key: "brand_rules_enforcement", enabled: false },
    ] as Row[],
    reservations: 0,
    // The give-backs a guarded-spend abort makes: [rpc, amount].
    released: [] as [string, number | null][],
    // Single-row reads of generations that come back empty, as a read that
    // races the row's insert would.
    hideNextKeyedReads: 0,
  };
  const table = (name: string): Row[] => (db as unknown as Record<string, Row[]>)[name] ?? [];
  const client = {
    from(name: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let patch: Row | null = null;
      const settle = () => {
        const rows = table(name).filter((r) => filters.every((f) => f(r)));
        if (patch) {
          for (const r of rows) Object.assign(r, patch);
          return { data: null, error: null };
        }
        return { data: rows.map((r) => ({ ...r })), error: null };
      };
      const b = {
        select: () => b,
        update(values: Row) {
          patch = values;
          return b;
        },
        eq(col: string, v: unknown) {
          filters.push((r) => r[col] === v);
          return b;
        },
        is(col: string, v: unknown) {
          filters.push((r) => (r[col] ?? null) === v);
          return b;
        },
        in(col: string, vs: unknown[]) {
          filters.push((r) => vs.includes(r[col]));
          return b;
        },
        order: () => b,
        limit: () => b,
        async single() {
          const { data } = settle();
          return data?.length === 1 ? { data: data[0], error: null } : { data: null, error: { message: "0 rows" } };
        },
        async maybeSingle() {
          if (name === "generations" && db.hideNextKeyedReads > 0) {
            db.hideNextKeyedReads -= 1;
            return { data: null, error: null };
          }
          const { data } = settle();
          return { data: data?.[0] ?? null, error: null };
        },
        then(resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return Promise.resolve(settle()).then(resolve, reject);
        },
      };
      return b;
    },
    async rpc(name: string, args: { p_user_id: string; p_row: Row; p_amount?: number }) {
      if (name === "add_bonus_credits" || name === "add_purchased_credits" || name === "refund_daily_free_generation") {
        db.released.push([name, args.p_amount ?? null]);
        return { data: null, error: null };
      }
      if (name !== "reserve_generation") throw new Error(`unexpected rpc ${name}`);
      const id = (args.p_row.id as string | undefined) ?? randomUUID();
      if (db.generations.some((r) => r.id === id)) {
        return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "generations_pkey"' } };
      }
      db.generations.push({
        result_url: null,
        match_score: null,
        pipeline_log: null,
        angle: null,
        angle_group_id: null,
        deleted_at: null,
        ...args.p_row,
        id,
        user_id: args.p_user_id,
      });
      db.reservations += 1;
      return { data: id, error: null };
    },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://signed.example/ref" } }) }) },
  };
  return { db, supabase: client as unknown as SupabaseClient };
}

/** A render that worked: its PNG in generated-images, its compiled prompt in the log. */
function rendered(prompt: string) {
  return {
    succeeded: true,
    resultUrl: `/api/media/generated-images/u/${randomUUID()}.png?v=written-under-an-old-key`,
    attempts: [{ attempt: 1, steps: [], passed: true, issues: [], compiledPrompt: `drafted: ${prompt}` }],
    finalPrompt: `drafted: ${prompt}`,
    contentPolicyBlock: null,
    rulesBlock: null,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/**
 * Lets pending promise chains and the follower's 2 s re-reads run, 50 ms of
 * fake time at a time (at most 20 s), until `done` holds.
 */
async function until(done: () => boolean, ticks = 400) {
  for (let i = 0; i < ticks && !done(); i++) await vi.advanceTimersByTimeAsync(50);
  expect(done()).toBe(true);
}

let world: ReturnType<typeof fakeDb>;
const call = (over: Partial<Parameters<typeof runApiImageGeneration>[0]> = {}) =>
  runApiImageGeneration({
    supabase: world.supabase,
    userId: "user-a",
    prompt: PROMPT,
    characterId: null,
    origin: ORIGIN,
    ...over,
  });

beforeEach(() => {
  world = fakeDb();
  h.pipeline.mockReset().mockImplementation(async (prompt: string) => rendered(prompt));
  h.gate.mockReset().mockResolvedValue(undefined);
  h.allowance.mockReset().mockResolvedValue({
    error: null,
    plan: "elite",
    isAdmin: false,
    monthlyLimit: 750,
    periodStartIso: "2026-09-01T00:00:00.000Z",
  });
  h.refund.mockReset().mockResolvedValue(true);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("without an idempotency key", () => {
  it("every call is a new, charged image — as before", async () => {
    const a = await call();
    const b = await call();
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(world.db.reservations).toBe(2);
    expect(h.pipeline).toHaveBeenCalledTimes(2);
  });
});

describe("with an idempotency key", () => {
  it("the row's id is made from the key, so a second delivery meets it", async () => {
    const a = await call({ idempotencyKey: "img-1" });
    expect(a.error === null && a.id).toBe(idempotentGenerationId({ userId: "user-a", key: "img-1" }, SERVICE_KEY));
  });

  it("MONEY: a retry after the first finished returns the first image and charges nothing more", async () => {
    const first = await call({ idempotencyKey: "img-1" });
    const retry = await call({ idempotencyKey: "img-1" });

    expect(first.error).toBeNull();
    expect(retry).toEqual(first);
    expect(world.db.reservations).toBe(1);
    expect(h.pipeline).toHaveBeenCalledTimes(1);
    // Answered before any gate or credit check ran again: the first
    // request's own charge could be the credit a second check refuses.
    expect(h.gate).toHaveBeenCalledTimes(1);
    expect(h.allowance).toHaveBeenCalledTimes(1);
  });

  it("the image URL is re-signed under today's key, like every other answer", async () => {
    const first = await call({ idempotencyKey: "img-1" });
    expect(first.error === null && first.imageUrl).toMatch(
      /^https:\/\/picacho\.ai\/api\/media\/generated-images\/u\/[0-9a-f-]+\.png\?v=(?!written-under-an-old-key)/,
    );
  });

  it("MONEY: a retry while the first is still rendering waits for it and answers with it", async () => {
    vi.useFakeTimers();
    const hold = deferred();
    h.pipeline.mockImplementationOnce(async (prompt: string) => {
      await hold.promise;
      return rendered(prompt);
    });

    const first = call({ idempotencyKey: "img-1" });
    await until(() => h.pipeline.mock.calls.length === 1);
    let retryDone = false;
    const retry = call({ idempotencyKey: "img-1" }).finally(() => (retryDone = true));
    await vi.advanceTimersByTimeAsync(5_000);
    // Still following: not answered, not reserved, not rendered.
    expect(retryDone).toBe(false);

    hold.resolve();
    const firstAnswer = await first;
    await until(() => retryDone);
    expect(await retry).toEqual(firstAnswer);
    expect(world.db.reservations).toBe(1);
    expect(h.pipeline).toHaveBeenCalledTimes(1);
  });

  it("MONEY: two deliveries racing meet at the primary key, and the second follows the first", async () => {
    // Both pass the opening look-up before either has reserved (the content
    // gate is held open for both), so only reserve_generation's primary key
    // stands between them and two charges.
    vi.useFakeTimers();
    const gateHold = deferred();
    h.gate.mockImplementation(async () => gateHold.promise);
    const renderHold = deferred();
    h.pipeline.mockImplementationOnce(async (prompt: string) => {
      await renderHold.promise;
      return rendered(prompt);
    });

    let bDone = false;
    const a = call({ idempotencyKey: "img-1" });
    const b = call({ idempotencyKey: "img-1" }).finally(() => (bDone = true));
    await until(() => h.gate.mock.calls.length === 2);
    gateHold.resolve();
    await until(() => h.pipeline.mock.calls.length === 1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(bDone).toBe(false);

    renderHold.resolve();
    const aAnswer = await a;
    await until(() => bDone);
    expect(await b).toEqual(aAnswer);
    expect(world.db.reservations).toBe(1);
    expect(h.pipeline).toHaveBeenCalledTimes(1);
  });

  it("MONEY: still rendering when the follower's clock runs out → 'generating' with the id, never a second take", async () => {
    vi.useFakeTimers();
    const hold = deferred();
    h.pipeline.mockImplementationOnce(async (prompt: string) => {
      await hold.promise;
      return rendered(prompt);
    });
    const first = call({ idempotencyKey: "img-1" });
    await until(() => h.pipeline.mock.calls.length === 1);

    let retryDone = false;
    const retry = call({ idempotencyKey: "img-1" }).finally(() => (retryDone = true));
    await vi.advanceTimersByTimeAsync(300_000);
    await until(() => retryDone);
    const answer = await retry;
    expect(answer).toMatchObject({
      error: null,
      id: idempotentGenerationId({ userId: "user-a", key: "img-1" }, SERVICE_KEY),
      status: "generating",
      imageUrl: null,
      creditsUsed: 1,
    });
    expect(world.db.reservations).toBe(1);

    hold.resolve();
    await first;
  });

  it("a key reused for a different picture is refused: nothing gated, charged or rendered", async () => {
    await call({ idempotencyKey: "img-1" });
    const reused = await call({ idempotencyKey: "img-1", prompt: "Eva in a kitchen" });
    expect(reused).toEqual({ error: IDEMPOTENCY_KEY_REUSED, status: 409 });
    expect(world.db.reservations).toBe(1);
    expect(h.pipeline).toHaveBeenCalledTimes(1);
    expect(h.gate).toHaveBeenCalledTimes(1);
  });

  it("SECURITY: two people using the same key each get their own image", async () => {
    const a = await call({ idempotencyKey: "img-1" });
    const b = await call({ idempotencyKey: "img-1", userId: "user-b" });
    expect(a.error === null && b.error === null && a.id !== b.id).toBe(true);
    expect(world.db.reservations).toBe(2);
  });

  it("a deleted image is not handed back through a retry", async () => {
    const first = await call({ idempotencyKey: "img-1" });
    const row = world.db.generations.find((r) => first.error === null && r.id === first.id)!;
    row.deleted_at = "2026-09-25T13:00:00.000Z";
    expect(await call({ idempotencyKey: "img-1" })).toEqual({ error: IDEMPOTENT_TAKE_DELETED, status: 410 });
    expect(world.db.reservations).toBe(1);
  });

  it("a retry of a take that failed and was refunded says failed, 0 credits — and does not render again", async () => {
    h.pipeline.mockImplementationOnce(async () => ({
      succeeded: false,
      resultUrl: null,
      attempts: [{ attempt: 1, steps: [], passed: false, issues: ["provider refused"], compiledPrompt: "x" }],
      finalPrompt: "x",
      contentPolicyBlock: null,
      rulesBlock: null,
    }));
    // The refund releases the charge on the row, as refundGenerationCosts does.
    h.refund.mockImplementation(async (id: string) => {
      const row = world.db.generations.find((r) => r.id === id);
      if (row) row.credits_used = 0;
      return true;
    });
    const first = await call({ idempotencyKey: "img-1" });
    expect(first).toMatchObject({ status: "failed", creditsUsed: 0 });
    const retry = await call({ idempotencyKey: "img-1" });
    expect(retry).toMatchObject({ status: "failed", creditsUsed: 0, imageUrl: null });
    expect(h.pipeline).toHaveBeenCalledTimes(1);
  });

  it("the first request's charge refusing the retry's credit check still answers with the first image", async () => {
    const first = await call({ idempotencyKey: "img-1" });
    // The opening look-up misses the first row (it landed just after), so
    // the retry reaches the credit check — which the first request's own
    // charge now refuses. That refusal is not the answer: the first image is.
    world.db.hideNextKeyedReads = 1;
    h.allowance.mockResolvedValue({ error: "You've used all 750 credits included in your Elite plan this month.", plan: "elite", isAdmin: false });
    expect(await call({ idempotencyKey: "img-1" })).toEqual(first);
    expect(h.allowance).toHaveBeenCalledTimes(2);
    expect(world.db.reservations).toBe(1);
  });

  it("without the server secret, a keyed request starts nothing", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    try {
      expect(await call({ idempotencyKey: "img-1" })).toEqual({ error: "Couldn't start that generation.", status: 500 });
      expect(world.db.reservations).toBe(0);
    } finally {
      vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
    }
  });
});

describe("refusals say what happened, not what to buy", () => {
  it("the credit check's pitch is cut from what the API answers", async () => {
    h.allowance.mockResolvedValue({
      error:
        "You've used today's free generation — it comes back tomorrow. Pick a plan or top up credits to keep going — your characters and history stay exactly as they are.",
      plan: "none",
      isAdmin: false,
    });
    expect(await call()).toEqual({ error: "You've used today's free generation — it comes back tomorrow.", status: 402 });
  });

  it("the free generation taken by a concurrent request is plain too", async () => {
    h.allowance.mockResolvedValue({ error: null, plan: "none", isAdmin: false, consumeFree: true, periodStartIso: "2026-09-25T00:00:00.000Z" });
    const core = await import("@/lib/generations/core");
    vi.spyOn(core, "consumeFreeGeneration").mockResolvedValue(false);
    expect(await call()).toEqual({ error: PLAIN_FREE_USED_TODAY, status: 402 });
  });
});

describe("MONEY: the guarded spends hold every source (review M2)", () => {
  const onBonus = { error: null, plan: "elite", isAdmin: false, monthlyLimit: 750, periodStartIso: "2026-09-01T00:00:00.000Z" };

  it("a bonus credit a concurrent request took first stops the render: 402, nothing run, the row released", async () => {
    h.allowance.mockResolvedValue({ ...onBonus, consumeBonus: 1 });
    const core = await import("@/lib/generations/core");
    vi.spyOn(core, "consumeBonusCredits").mockResolvedValue(false);
    expect(await call()).toEqual({ error: "Insufficient credits for that request.", status: 402 });
    expect(h.pipeline).not.toHaveBeenCalled();
    expect(world.db.generations).toHaveLength(1);
    expect(world.db.generations[0]).toMatchObject({ status: "failed", credits_used: 0, bonus_credits_used: 0, purchased_credits_used: 0 });
    // Nothing was taken, so nothing is given back.
    expect(world.db.released).toEqual([]);
  });

  it("ten concurrent calls on one bonus credit render once", async () => {
    h.allowance.mockResolvedValue({ ...onBonus, consumeBonus: 1 });
    let balance = 1;
    const core = await import("@/lib/generations/core");
    vi.spyOn(core, "consumeBonusCredits").mockImplementation(async () => (balance-- > 0));
    const answers = await Promise.all(Array.from({ length: 10 }, () => call()));
    expect(answers.filter((a) => a.error === null)).toHaveLength(1);
    expect(answers.filter((a) => a.error !== null).every((a) => a.status === 402)).toBe(true);
    expect(h.pipeline).toHaveBeenCalledTimes(1);
    // Only the paid row still says it used a bonus credit, so a refund can only give back the one taken.
    expect(world.db.generations.filter((r) => r.bonus_credits_used === 1)).toHaveLength(1);
  });

  it("a split spend that half succeeds gives back the half it took", async () => {
    h.allowance.mockResolvedValue({ ...onBonus, consumeBonus: 1, consumePurchased: 1 });
    const core = await import("@/lib/generations/core");
    vi.spyOn(core, "consumePurchasedCredits").mockResolvedValue(false);
    expect(await call()).toEqual({ error: "Insufficient credits for that request.", status: 402 });
    expect(h.pipeline).not.toHaveBeenCalled();
    expect(world.db.released).toEqual([["add_bonus_credits", 1]]);
  });
});
