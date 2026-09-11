import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAstraRequestBody } from "../../../src/lib/generations/providers/astra.ts";
import { photoBuildRequest } from "../../../src/lib/sets/astra-request.ts";
import { SET_PHOTO_BUILD_EFFORT } from "../../../src/lib/sets/set-config.ts";
import { startBuild, startPhotoBuild } from "./build-flow.mts";
import { evalSafetyId } from "./builders.mts";
import type { LedgerInput } from "./ledger.mts";
import { NetGuard } from "./net-guard.mts";
import { PhotoStore } from "./photos.mts";
import { makePriceBook, type ExternalPrices } from "./prices.mts";
import { SpendGuard } from "./spend-guard.mts";
import { astraBackgroundAttempt, miniAttempt, sonnetAttempt, UNKNOWN_FLAG, unanswered, waitFor, type TransportEnv } from "./transports.mts";

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

function env(provider: (url: string, init?: RequestInit) => Promise<Response>) {
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
  const e: TransportEnv = { part: "d", book, guard, net, answersDir: dir, stopping: () => false, interrupted: () => false, inflight: new Set() };
  return { e, guard, events, calls };
}

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
