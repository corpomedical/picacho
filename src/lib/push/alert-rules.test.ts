import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AttemptLog } from "../generations/pipeline";
import { RATE_HITS_LONGEST_WINDOW_SECONDS } from "../rate-hits";
import {
  ALERT_WINDOWS,
  FAILURE_BURST,
  actOnRenderFailure,
  balanceSiren,
  falBalanceAlert,
  jobFailedAlert,
  modelOffAlert,
  renderFailureAlert,
  sendOnce,
  wrapJob,
  type AdminPush,
  type Limiter,
} from "./alert-rules";

const attempt = (steps: AttemptLog["steps"], issues: string[] = []): AttemptLog => ({
  attempt: 1,
  passed: false,
  issues,
  compiledPrompt: "",
  steps,
});

// The fal lock of 2026-08-25, as the job runner logs it.
const FAL_LOCK = [
  attempt([
    {
      step: "generate",
      detail:
        'fal.ai (Seedance 2.0) error (403): {"detail":"User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing."}',
    },
  ]),
];
const PROVIDER_500 = [
  attempt([{ step: "generate", detail: 'fal.ai (Kling 2.1) error (500): {"message":"Internal server error"}' }]),
];
const LIKENESS_REFUSAL = [
  attempt([
    {
      step: "generate",
      detail:
        'fal.ai (Seedance 2.0) error (422): {"detail":[{"msg":"The images or videos provided may contain likenesses of real people"}]}',
    },
  ]),
];
const WRITTEN_OFF = [attempt([{ step: "generate", detail: "This render didn't finish in time and was stopped." }])];
const STOPPED = [attempt([{ step: "generate", detail: "Stopped." }], ["cancelled"])];

describe("renderFailureAlert", () => {
  it("sounds the siren when the provider account is out of money", () => {
    const v = renderFailureAlert({ fault: "provider_failed", attempts: FAL_LOCK, modelLabel: "Seedance 2.0" });
    expect(v.kind).toBe("balance");
    if (v.kind !== "balance") return;
    expect(v.push.title).toBe("🚨 Provider account locked — renders are failing");
    expect(v.push.body).toContain("User is locked");
    expect(v.push.body).toContain("every generation fails until the balance is topped up.");
    expect(v.push.path).toBe("#system");
  });

  it("counts a failure that broke, naming the model and the provider's words", () => {
    const v = renderFailureAlert({ fault: "provider_failed", attempts: PROVIDER_500, modelLabel: "Kling 2.1" });
    expect(v.kind).toBe("count");
    if (v.kind !== "count") return;
    expect(v.burst.title).toBe("Renders are failing");
    expect(v.burst.body).toBe(
      `${FAILURE_BURST} or more failed in 15 minutes. Latest: Kling 2.1: fal.ai (Kling 2.1) error (500): Internal server error`,
    );
  });

  it("counts a write-off by the stuck-render reaper, in its own words", () => {
    const v = renderFailureAlert({ fault: "provider_failed", attempts: WRITTEN_OFF, modelLabel: "Veo 3" });
    expect(v.kind).toBe("count");
    if (v.kind !== "count") return;
    expect(v.burst.body).toContain("Latest: Veo 3: This render didn't finish in time and was stopped.");
  });

  it("leaves refusals, stops and walk-aways off the phone", () => {
    expect(renderFailureAlert({ fault: "provider_failed", attempts: LIKENESS_REFUSAL, modelLabel: "x" }).kind).toBe("none");
    expect(renderFailureAlert({ fault: "provider_failed", attempts: STOPPED, modelLabel: "x" }).kind).toBe("none");
    expect(renderFailureAlert({ fault: "user_cancelled", attempts: PROVIDER_500, modelLabel: "x" }).kind).toBe("none");
    expect(renderFailureAlert({ fault: "abandoned", attempts: PROVIDER_500, modelLabel: "x" }).kind).toBe("none");
  });

  it("keeps a push short enough for a lock screen", () => {
    const long = [attempt([{ step: "generate", detail: `fal.ai (Kling 2.1) error (500): ${"x".repeat(900)}` }])];
    const v = renderFailureAlert({ fault: "our_error", attempts: long, modelLabel: "Kling 2.1" });
    if (v.kind !== "count") throw new Error("expected a count");
    expect(v.burst.body.length).toBeLessThanOrEqual(200);
  });
});

// A limiter with the table's semantics: counts only when under max.
function fakeLimiter(fail = false) {
  const hits = new Map<string, number>();
  const calls: string[] = [];
  const limit: Limiter = async (key, _window, max) => {
    calls.push(`${key}/${max}`);
    if (fail) return null;
    const n = hits.get(key) ?? 0;
    if (n >= max) return false;
    hits.set(key, n + 1);
    return true;
  };
  return { limit, calls };
}

function fakeSender() {
  const sent: AdminPush[] = [];
  return { send: async (p: AdminPush) => void sent.push(p), sent };
}

describe("actOnRenderFailure", () => {
  it("sends the siren once per window", async () => {
    const { limit } = fakeLimiter();
    const { send, sent } = fakeSender();
    const v = renderFailureAlert({ fault: "provider_failed", attempts: FAL_LOCK, modelLabel: "Seedance 2.0" });
    expect(await actOnRenderFailure(limit, send, v)).toBe("siren");
    expect(await actOnRenderFailure(limit, send, v)).toBe("siren-damped");
    expect(sent).toHaveLength(1);
  });

  it("counts two failures quietly, alerts on the third, then damps", async () => {
    const { limit, calls } = fakeLimiter();
    const { send, sent } = fakeSender();
    const v = renderFailureAlert({ fault: "provider_failed", attempts: PROVIDER_500, modelLabel: "Kling 2.1" });
    const outcomes = [];
    for (let i = 0; i < 5; i++) outcomes.push(await actOnRenderFailure(limit, send, v));
    expect(outcomes).toEqual(["counted", "counted", "burst", "burst-damped", "burst-damped"]);
    expect(sent).toHaveLength(1);
    expect(calls[0]).toBe(`render-failures/${FAILURE_BURST - 1}`);
  });

  it("alerts when the limiter itself fails, rather than going quiet", async () => {
    const { limit } = fakeLimiter(true);
    const { send, sent } = fakeSender();
    const broke = renderFailureAlert({ fault: "provider_failed", attempts: PROVIDER_500, modelLabel: "Kling 2.1" });
    expect(await actOnRenderFailure(limit, send, broke)).toBe("burst");
    const lock = renderFailureAlert({ fault: "provider_failed", attempts: FAL_LOCK, modelLabel: "Seedance 2.0" });
    expect(await actOnRenderFailure(limit, send, lock)).toBe("siren");
    expect(sent).toHaveLength(2);
  });

  it("does nothing, and asks nothing, for a refusal", async () => {
    const { limit, calls } = fakeLimiter();
    const { send, sent } = fakeSender();
    const v = renderFailureAlert({ fault: "provider_failed", attempts: LIKENESS_REFUSAL, modelLabel: "x" });
    expect(await actOnRenderFailure(limit, send, v)).toBe("none");
    expect(calls).toEqual([]);
    expect(sent).toEqual([]);
  });
});

describe("sendOnce", () => {
  it("sends the first time in a window and not the second", async () => {
    const { limit } = fakeLimiter();
    const { send, sent } = fakeSender();
    const push = jobFailedAlert("prune", "It answered 500.");
    expect(await sendOnce(limit, send, "job:prune", ALERT_WINDOWS.jobFailed, push)).toBe(true);
    expect(await sendOnce(limit, send, "job:prune", ALERT_WINDOWS.jobFailed, push)).toBe(false);
    expect(await sendOnce(limit, send, "job:drip", ALERT_WINDOWS.jobFailed, push)).toBe(true);
    expect(sent).toHaveLength(2);
  });
});

describe("wrapJob", () => {
  const run = (res: Response | Error) => async () => {
    if (res instanceof Error) throw res;
    return res;
  };
  const request = new Request("https://picacho.ai/api/cron/reconcile");

  it("reports a 5xx with the job's own error, and passes the answer through intact", async () => {
    const failed: string[] = [];
    const GET = wrapJob("reconcile", run(Response.json({ error: "query failed" }, { status: 500 })), async (j, m) => {
      failed.push(`${j}: ${m}`);
    });
    const res = await GET(request);
    expect(failed).toEqual(["reconcile: It answered 500: query failed."]);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "query failed" });
  });

  it("reports a 5xx that is not JSON by its status", async () => {
    const failed: string[] = [];
    const GET = wrapJob("reels", run(new Response("boom", { status: 502 })), async (j, m) => void failed.push(m));
    await GET(request);
    expect(failed).toEqual(["It answered 502."]);
  });

  it("stays quiet for a caller without the secret, and for a good run", async () => {
    const failed: string[] = [];
    const onFail = async (_j: string, m: string) => void failed.push(m);
    await wrapJob("prune", run(Response.json({ error: "unauthorized" }, { status: 401 })), onFail)(request);
    await wrapJob("prune", run(Response.json({ ok: true })), onFail)(request);
    expect(failed).toEqual([]);
  });

  it("reports a throw, then throws it on", async () => {
    const failed: string[] = [];
    const GET = wrapJob("sets", run(new Error("socket hang up")), async (_j, m) => void failed.push(m));
    await expect(GET(request)).rejects.toThrow("socket hang up");
    expect(failed).toEqual(["socket hang up"]);
  });

  it("wraps every cron in vercel.json, under its own name", () => {
    const root = join(__dirname, "..", "..", "..");
    const crons = (JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as { crons: { path: string }[] }).crons;
    expect(crons.length).toBeGreaterThan(0);
    for (const { path } of crons) {
      const job = path.replace("/api/cron/", "");
      const route = readFileSync(join(root, "src", "app", "api", "cron", job, "route.ts"), "utf8");
      expect(route, job).toContain(`export const GET = withJobAlert("${job}", run);`);
      expect(route, job).not.toContain("export async function GET");
    }
  });
});

describe("modelOffAlert", () => {
  it("says when the trial render comes and what broke", () => {
    const now = Date.parse("2026-09-26T02:00:00Z");
    const push = modelOffAlert({
      modelLabel: "Seedance 2.0",
      lastError: "fal.ai (Seedance 2.0) error (500): upstream timeout",
      retryAfter: "2026-09-26T02:10:00Z",
      now,
    });
    expect(push.title).toBe("Seedance 2.0 switched off");
    expect(push.body).toContain("It gets one trial render in 10 min.");
    expect(push.body).toContain("Last error: fal.ai (Seedance 2.0) error (500): upstream timeout");
    expect(push.path).toBe("#system");
  });

  it("copes with no trial time and no recorded error", () => {
    const push = modelOffAlert({ modelLabel: "Veo 3", lastError: null, retryAfter: null, now: 0 });
    expect(push.body).toContain("It stays off until a trial render works.");
    expect(push.body).toContain("Last error: none recorded");
  });
});

describe("falBalanceAlert", () => {
  it("draws Admin → AI Providers' two lines: under one render, under ten", () => {
    expect(falBalanceAlert({ balanceUsd: 5, worstRenderUsd: 9 })?.level).toBe("critical");
    const low = falBalanceAlert({ balanceUsd: 50, worstRenderUsd: 9 });
    expect(low?.level).toBe("low");
    expect(low?.push.body).toBe("$50.00 left, about 5 of the priciest renders ($9.00 each). Top up at fal.ai → Billing.");
    expect(falBalanceAlert({ balanceUsd: 90, worstRenderUsd: 9 })).toBeNull();
  });

  it("says nothing it cannot know", () => {
    expect(falBalanceAlert({ balanceUsd: Number.NaN, worstRenderUsd: 9 })).toBeNull();
    expect(falBalanceAlert({ balanceUsd: 5, worstRenderUsd: 0 })).toBeNull();
  });

  it("is the same threshold the admin page draws", () => {
    const page = readFileSync(join(__dirname, "..", "..", "app", "admin", "providers", "page.tsx"), "utf8");
    expect(page).toContain("balance.balanceUsd < worstRenderUsd;");
    expect(page).toContain("balance.balanceUsd < worstRenderUsd * 10;");
  });
});

describe("the windows", () => {
  it("stay inside what the daily prune keeps", () => {
    for (const [name, seconds] of Object.entries(ALERT_WINDOWS)) {
      expect(seconds, name).toBeGreaterThan(0);
      expect(seconds, name).toBeLessThanOrEqual(RATE_HITS_LONGEST_WINDOW_SECONDS);
    }
    expect(FAILURE_BURST).toBeGreaterThanOrEqual(2);
  });

  it("keep the in-request siren's words", () => {
    expect(balanceSiren("fal: User is locked").title).toBe("🚨 Provider account locked — renders are failing");
  });
});
