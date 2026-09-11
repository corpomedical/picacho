import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { costOfAstraUsageUsd } from "../../../src/lib/astra/prices.ts";
import { buildAstraRequestBody } from "../../../src/lib/generations/providers/astra.ts";
import { photoBuildRequest } from "../../../src/lib/sets/astra-request.ts";
import { matchShotRequest } from "../../../src/lib/sets/match-shot.ts";
import { SET_MATCH_DEADLINE_MS, SET_MATCH_POLL_MS, SET_PHOTO_BUILD_EFFORT } from "../../../src/lib/sets/set-config.ts";
import { startBuild, startPhotoBuild } from "./build-flow.mts";
import { evalSafetyId, matchAstraRequest, miniMatchBody } from "./builders.mts";
import type { LedgerInput } from "./ledger.mts";
import { NetGuard, type MeterRecord } from "./net-guard.mts";
import { PhotoStore } from "./photos.mts";
import { makePriceBook, type ExternalPrices, type PriceBook } from "./prices.mts";
import { SpendGuard } from "./spend-guard.mts";
import { astraBackgroundAttempt, astraMatchAttempt, miniAttempt, miniMatchAttempt, sonnetAttempt, UNKNOWN_FLAG, unanswered, waitFor, type TransportEnv } from "./transports.mts";

// A request that went out and got no answer may be running, and billing:
// it is booked, never released, and never sent again. A definite refusal
// (an HTTP status) releases its money. The provider is a scripted fetch
// behind the real net guard: nothing leaves the process.

const EMPTY: ExternalPrices = { models: { "claude-sonnet-5": null, "gpt-5.4-mini": null }, images: { "flux-2-pro-edit": null, "seedream-v4-edit": null }, judgementCeilings: {} };
const book = makePriceBook({ external: EMPTY, gptImageUsd: 0.17 });

let dir: string;
let prevKey: string | undefined;
let prevFetch: typeof fetch;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "astra-transport-"));
  prevKey = process.env.OPENAI_API_KEY;
  prevFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-key-not-real";
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = prevKey;
  globalThis.fetch = prevFetch;
});

function env(provider: (url: string, init?: RequestInit) => Promise<Response>, o: { part?: string; book?: PriceBook } = {}) {
  const calls: string[] = [];
  const net = new NetGuard({
    mode: "live",
    realFetch: (async (u: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(u));
      return provider(String(u), init);
    }) as typeof fetch,
  });
  globalThis.fetch = net.fetch;
  const events: LedgerInput[] = [];
  const guard = new SpendGuard({ maxUsd: 10, sink: (e) => events.push(e) });
  const e: TransportEnv = { part: o.part ?? "d", book: o.book ?? book, guard, net, answersDir: dir, stopping: () => false, interrupted: () => false, inflight: new Set() };
  return { e, guard, events, calls, net };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("a request with no answer", () => {
  it("an Astra submit that drops is booked at the worst case, flagged, and not resent", async () => {
    const { e, guard, events, calls } = env(async () => {
      throw new TypeError("socket hang up");
    });
    const a = await astraBackgroundAttempt(e, startBuild("dv-x-r1", "a busy night market"), "low");
    expect(a.r).toMatchObject({ state: "submit-failed", kind: "unavailable" });
    expect(a.meta).toMatchObject({ billedUsd: book.astraFirstWorstUsd, costFlag: UNKNOWN_FLAG });
    expect(calls).toHaveLength(1);
    expect(guard.outstandingUsd).toBe(0);
    expect(guard.settledUsd).toBeCloseTo(book.astraFirstWorstUsd, 12);
    expect(events.some((x) => x.ev === "release")).toBe(false);
  });

  it("an Astra submit refused with a status releases its money", async () => {
    const { e, guard, calls } = env(async () => new Response(JSON.stringify({ error: { code: "unsupported_parameter", message: "no" } }), { status: 400, headers: { "content-type": "application/json" } }));
    const a = await astraBackgroundAttempt(e, startBuild("dv-y-r1", "a quiet library"), "low");
    expect(a.r).toMatchObject({ state: "submit-failed", kind: "bad_request" });
    expect(calls).toHaveLength(1);
    expect(guard.settledUsd).toBe(0);
    expect(guard.outstandingUsd).toBe(0);
  });

  it("an unpriced baseline POST that drops leaves a ledger line and is not resent", async () => {
    const { e, guard, events, calls } = env(async () => {
      throw new TypeError("socket hang up");
    });
    const a = await miniAttempt(e, startBuild("mn-x-r1", "a quiet library"));
    expect(a.r).toMatchObject({ state: "submit-failed", kind: "unavailable" });
    expect(calls).toHaveLength(1);
    expect(guard.unpricedMeterEvents).toBe(1);
    expect(events.find((x) => x.ev === "meter")).toMatchObject({ host: "api.openai.com", usd: null });
  });

  it("reads the answer state and the server's wait", () => {
    expect(unanswered({ status: -1 })).toBe(true);
    expect(unanswered({ status: 200 })).toBe(true);
    expect(unanswered({ status: 503 })).toBe(false);
    expect(unanswered({ status: null })).toBe(false);
    expect(waitFor("7", 5000)).toBe(7000);
    expect(waitFor("120", 5000)).toBe(30_000);
    expect(waitFor(null, 5000)).toBe(5000);
    expect(waitFor("soon", 15_000)).toBe(15_000);
  });
});

// A photo build goes to Astra only, in background only, as the product
// sends it: the photo inline, the photo caps' worst case reserved first.
describe("a photo build in background", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 7, 7, 7]);
  const sha256 = createHash("sha256").update(jpeg).digest("hex");
  const dataUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  const withPhoto = (e: TransportEnv) => {
    const store = new PhotoStore();
    store.add({ photoId: "pp-01", jpeg, dataUrl, width: 1024, height: 768, sha256 });
    e.photos = store;
  };

  it("sends the product's photo request, reserved and booked at the photo caps' worst case", async () => {
    const bodies: string[] = [];
    const { e, guard, events, calls } = env(async (_u, init) => {
      bodies.push(String(init?.body));
      throw new TypeError("socket hang up");
    });
    withPhoto(e);
    const a = await astraBackgroundAttempt(e, startPhotoBuild("dp-pp-01-r1", { photoId: "pp-01", notes: "", sha256 }), SET_PHOTO_BUILD_EFFORT);
    expect(calls).toEqual(["https://api.openai.com/v1/responses"]);
    expect(bodies[0]).toBe(JSON.stringify(buildAstraRequestBody(photoBuildRequest(dataUrl, "", evalSafetyId("d")))));
    expect(events.find((x) => x.ev === "reserve")).toMatchObject({ kind: "astra", worstUsd: book.astraPhotoFirstWorstUsd });
    expect(a.meta).toMatchObject({ transport: "background", billedUsd: book.astraPhotoFirstWorstUsd, standardUsd: book.astraPhotoFirstWorstUsd, costFlag: UNKNOWN_FLAG });
    expect(guard.settledUsd).toBeCloseTo(book.astraPhotoFirstWorstUsd, 12);
  });

  it("sends and reserves nothing when the photo no longer hashes to what the build sent", async () => {
    const { e, events, calls } = env(async () => new Response("{}"));
    withPhoto(e);
    await expect(astraBackgroundAttempt(e, startPhotoBuild("dp-pp-01-r1", { photoId: "pp-01", notes: "", sha256: "0".repeat(64) }), "low")).rejects.toThrow(/nothing is resent/);
    expect(calls).toEqual([]);
    expect(events).toEqual([]);
  });

  it("a baseline never gets a photo build", async () => {
    const { e, calls } = env(async () => new Response("{}"));
    withPhoto(e);
    const s = startPhotoBuild("mn-pp-01-r1", { photoId: "pp-01", notes: "", sha256 });
    await expect(miniAttempt(e, s)).rejects.toThrow(/Astra only/);
    await expect(sonnetAttempt(e, s, "format")).rejects.toThrow(/Astra only/);
    expect(calls).toEqual([]);
  });
});

// Part E: one read of a picture's camera, no build around it, on the same
// rails. The clock's pauses pass at once, so the product's 2.5 s polls and
// 270 s deadline run in no time.
describe("a Match-this-shot read", () => {
  const dataUrl = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6]).toString("base64")}`;
  const answer = JSON.stringify({ subject_found: true, camera_height_m: 1.5, pitch_deg: -4, vertical_fov_deg: 41, subject_distance_m: 3, subject_x: 0.5, framing: "full", confidence: "high" });
  const usage = { input_tokens: 2000, input_tokens_details: { cached_tokens: 600, cache_write_tokens: 0 }, output_tokens: 900 };
  const completed = (id: string) => ({ id, status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: answer }] }], usage });
  const fakeClock = () => {
    let t = 0;
    return { now: () => t, pause: async (ms: number) => void (t += ms) };
  };
  const NEUTRAL = { inputPerMTok: 1, cachedInputPerMTok: null, cacheWritePerMTok: null, outputPerMTok: 10, source: "https://example.test/prices", readOn: "2026-01-01" };

  it("on Astra: the product's request in background, reserved at the match caps' worst case, polled as the product polls, settled from usage", async () => {
    const bodies: string[] = [];
    let polls = 0;
    const clock = fakeClock();
    const { e, guard, events, calls } = env(
      async (_u, init) => {
        if (init?.method === "POST") {
          bodies.push(String(init.body));
          return json({ id: "resp_match0001" });
        }
        polls += 1;
        return json(polls < 3 ? { id: "resp_match0001", status: "in_progress" } : completed("resp_match0001"));
      },
      { part: "e" },
    );
    const a = await astraMatchAttempt(e, "e-astra-mt-01-r1", matchAstraRequest(dataUrl, "e"), clock);
    expect(bodies).toEqual([JSON.stringify(buildAstraRequestBody(matchShotRequest(dataUrl, evalSafetyId("e"))))]);
    expect(events.find((x) => x.ev === "reserve")).toMatchObject({ kind: "astra", worstUsd: book.astraMatchWorstUsd });
    expect(a.r).toMatchObject({ state: "done", text: answer });
    expect(a.timedOut).toBeUndefined();
    expect(a.meta.standardUsd).toBeCloseTo(costOfAstraUsageUsd(usage), 12);
    expect(a.meta.latencyMs).toBe(3 * SET_MATCH_POLL_MS);
    expect(guard.outstandingUsd).toBe(0);
    expect(calls.some((c) => c.endsWith("/cancel"))).toBe(false);
    expect(readFileSync(join(dir, "e-astra-mt-01-r1.txt"), "utf8")).toBe(answer);
    expect(e.inflight.size).toBe(0);
  });

  it("on Astra: a read still working at the product's deadline is cancelled, flagged timed out, and settled from what it used", async () => {
    let cancelled = false;
    let polls = 0;
    const { e, guard, calls } = env(
      async (u, init) => {
        if (init?.method === "POST" && u.endsWith("/cancel")) {
          cancelled = true;
          return json({});
        }
        if (init?.method === "POST") return json({ id: "resp_match0002" });
        polls += 1;
        return json(cancelled ? { id: "resp_match0002", status: "cancelled", usage } : { id: "resp_match0002", status: "in_progress" });
      },
      { part: "e" },
    );
    const a = await astraMatchAttempt(e, "e-astra-mt-01-r2", matchAstraRequest(dataUrl, "e"), fakeClock());
    expect(a.timedOut).toBe(true);
    expect(a.r).toMatchObject({ state: "failed", kind: "cancelled" });
    expect(calls.filter((c) => c.endsWith("/cancel"))).toHaveLength(1);
    // No poll starts once one more pause would pass the deadline (pollUntilDeadline); then one look after the cancel.
    const inTime = Math.ceil(SET_MATCH_DEADLINE_MS / SET_MATCH_POLL_MS) - 1;
    expect(polls).toBe(inTime + 1);
    expect(guard.settledUsd).toBeCloseTo(costOfAstraUsageUsd(usage), 12);
  });

  // pollAstraJob reads a dropped poll or a 5xx as "working", as the product
  // must. Only OpenAI's own word makes a read still reading at the deadline.
  it("on Astra: polls unanswered until the deadline are no timeout — the read is unanswered (missing), settled at the worst case, never resent", async () => {
    let polls = 0;
    const { e, guard, calls } = env(
      async (u, init) => {
        if (init?.method === "POST" && !u.endsWith("/cancel")) return json({ id: "resp_match0004" });
        // The first poll answers; then the wire goes, the cancel and the look with it.
        if (init?.method !== "POST" && polls++ === 0) return json({ id: "resp_match0004", status: "in_progress" });
        throw new TypeError("fetch failed");
      },
      { part: "e" },
    );
    const a = await astraMatchAttempt(e, "e-astra-mt-01-r4", matchAstraRequest(dataUrl, "e"), fakeClock());
    expect(a.timedOut).toBeUndefined();
    expect(a.unanswered).toBe(true);
    expect(a.r).toMatchObject({ state: "failed", kind: "failed", detail: expect.stringMatching(/no answer from OpenAI to the polls before the 270 s deadline/) });
    expect(a.meta).toMatchObject({ billedUsd: book.astraMatchWorstUsd, costFlag: expect.stringMatching(/^unanswered at the deadline/) });
    expect(guard.settledUsd).toBeCloseTo(book.astraMatchWorstUsd, 12);
    expect(calls.filter((c) => c.endsWith("/cancel"))).toHaveLength(1);
    expect(calls.filter((c) => c === "https://api.openai.com/v1/responses")).toHaveLength(1);
  });

  it("on Astra: 5xx polls and a look that finds it finished — its answer came at a moment nobody saw: unanswered, settled from its usage", async () => {
    let cancelled = false;
    const { e, guard } = env(
      async (u, init) => {
        if (init?.method === "POST" && u.endsWith("/cancel")) {
          cancelled = true;
          return json({});
        }
        if (init?.method === "POST") return json({ id: "resp_match0005" });
        return cancelled ? json(completed("resp_match0005")) : json({ error: { code: "server_error" } }, 503);
      },
      { part: "e" },
    );
    const a = await astraMatchAttempt(e, "e-astra-mt-01-r5", matchAstraRequest(dataUrl, "e"), fakeClock());
    expect(a).toMatchObject({ unanswered: true, r: { state: "failed", kind: "failed" } });
    expect(a.timedOut).toBeUndefined();
    expect(guard.settledUsd).toBeCloseTo(costOfAstraUsageUsd(usage), 12);
  });

  it("on Astra: 5xx polls, and a look that finds the cancel stopped it — OpenAI's word that it was still reading: timed out", async () => {
    let cancelled = false;
    const { e } = env(
      async (u, init) => {
        if (init?.method === "POST" && u.endsWith("/cancel")) {
          cancelled = true;
          return json({});
        }
        if (init?.method === "POST") return json({ id: "resp_match0006" });
        return cancelled ? json({ id: "resp_match0006", status: "cancelled", usage }) : json({ error: { code: "server_error" } }, 502);
      },
      { part: "e" },
    );
    const a = await astraMatchAttempt(e, "e-astra-mt-01-r6", matchAstraRequest(dataUrl, "e"), fakeClock());
    expect(a).toMatchObject({ timedOut: true, r: { state: "failed", kind: "cancelled" } });
    expect(a.unanswered).toBeUndefined();
  });

  it("on Astra: heard working at the last poll, finished before the cancel landed — the product had given up on it: timed out", async () => {
    let cancelled = false;
    const { e, guard } = env(
      async (u, init) => {
        if (init?.method === "POST" && u.endsWith("/cancel")) {
          cancelled = true;
          return json({});
        }
        if (init?.method === "POST") return json({ id: "resp_match0007" });
        return json(cancelled ? completed("resp_match0007") : { id: "resp_match0007", status: "in_progress" });
      },
      { part: "e" },
    );
    const a = await astraMatchAttempt(e, "e-astra-mt-01-r7", matchAstraRequest(dataUrl, "e"), fakeClock());
    expect(a).toMatchObject({ timedOut: true, r: { state: "failed", kind: "cancelled" } });
    expect(guard.settledUsd).toBeCloseTo(costOfAstraUsageUsd(usage), 12);
  });

  it("on gpt-5.4-mini: its one call still open, unanswered, at the product's deadline is still reading (timed out, as on Astra), booked and never resent; one dropped before is not", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let signal: AbortSignal | null = null;
      const hung = env(
        (_u, init) =>
          new Promise<Response>((_, reject) => {
            signal = init?.signal ?? null;
            signal?.addEventListener("abort", () => reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })));
          }),
        { part: "e" },
      );
      const pending = miniMatchAttempt(hung.e, "e-mini-mt-01-r3", dataUrl);
      await vi.advanceTimersByTimeAsync(SET_MATCH_DEADLINE_MS - 1);
      expect((signal as AbortSignal | null)?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const a = await pending;
      expect(a.timedOut).toBe(true);
      expect(a.r).toMatchObject({ state: "submit-failed", kind: "unavailable", detail: expect.stringMatching(/^still reading after 270 s/) });
      expect(hung.calls).toHaveLength(1);
      expect(hung.guard.unpricedMeterEvents).toBe(1);
    } finally {
      vi.useRealTimers();
    }
    const dropped = env(async () => {
      throw new TypeError("socket hang up");
    });
    const b = await miniMatchAttempt(dropped.e, "e-mini-mt-01-r4", dataUrl);
    expect(b.r).toMatchObject({ state: "submit-failed", kind: "unavailable" });
    expect(b.timedOut).toBeUndefined();
  });

  it("on Astra: a 429 releases its money and is sent again under a fresh reservation; a submit with no answer is booked at the worst case, never resent", async () => {
    let submits = 0;
    const retried = env(
      async (_u, init) => {
        if (init?.method !== "POST") return json(completed("resp_match0003"));
        submits += 1;
        return submits === 1 ? json({ error: { code: "rate_limit_exceeded" } }, 429, { "retry-after": "0.01" }) : json({ id: "resp_match0003" });
      },
      { part: "e" },
    );
    const a = await astraMatchAttempt(retried.e, "e-astra-mt-01-r3", matchAstraRequest(dataUrl, "e"), fakeClock());
    expect(a.r.state).toBe("done");
    expect(submits).toBe(2);
    expect(retried.events.map((x) => x.ev)).toEqual(["reserve", "release", "reserve", "settle"]);

    const dropped = env(async () => {
      throw new TypeError("socket hang up");
    });
    const b = await astraMatchAttempt(dropped.e, "e-astra-mt-02-r1", matchAstraRequest(dataUrl, "e"), fakeClock());
    expect(b.r).toMatchObject({ state: "submit-failed", kind: "unavailable" });
    expect(b.meta).toMatchObject({ billedUsd: book.astraMatchWorstUsd, costFlag: UNKNOWN_FLAG });
    expect(dropped.calls).toHaveLength(1);
  });

  it("on gpt-5.4-mini: the same instructions, schema and input as one Responses call, metered while unpriced", async () => {
    const bodies: string[] = [];
    const metered: MeterRecord[] = [];
    const { e, events, net } = env(
      async (_u, init) => {
        bodies.push(String(init?.body));
        return json({ ...completed("resp_mini00001"), model: "gpt-5.4-mini" });
      },
      { part: "e" },
    );
    net.onMeter = (m) => metered.push(m);
    const a = await miniMatchAttempt(e, "e-mini-mt-01-r1", dataUrl);
    expect(bodies).toEqual([JSON.stringify(miniMatchBody(dataUrl, "e"))]);
    expect(a.r).toMatchObject({ state: "done", text: answer });
    expect(events.filter((x) => x.ev === "reserve")).toEqual([]);
    expect(metered.map((m) => [m.model, m.ctx.tag])).toEqual([["gpt-5.4-mini", "mini-5.4-match"]]);
  });

  it("on gpt-5.4-mini, once priced: reserved at the match bound, settled from its own usage", async () => {
    const priced = makePriceBook({ external: { ...EMPTY, models: { ...EMPTY.models, "gpt-5.4-mini": NEUTRAL } }, gptImageUsd: 0.17 });
    const { e, events, guard } = env(async () => json({ ...completed("resp_mini00002"), model: "gpt-5.4-mini" }), { part: "e", book: priced });
    const a = await miniMatchAttempt(e, "e-mini-mt-01-r2", dataUrl);
    expect(events.find((x) => x.ev === "reserve")).toMatchObject({ kind: "mini-5.4", worstUsd: priced.matchBaselineWorstUsd("gpt-5.4-mini") });
    // 1,400 fresh + 600 cached (no cached rate: the full input rate) at $1/1M, 900 out at $10/1M.
    expect(a.meta.standardUsd).toBeCloseTo((2000 * 1 + 900 * 10) / 1e6, 12);
    expect(guard.settledUsd).toBeCloseTo((2000 * 1 + 900 * 10) / 1e6, 12);
  });
});
