import { describe, expect, it } from "vitest";
import { COST_BASIS_USD_PER_CREDIT } from "../generations/providers/video-models";
import {
  heartbeatAllowed,
  LIVE_CLIENT_OPEN_TIMEOUT_MS,
  LIVE_COST_BASIS_USD_PER_CREDIT,
  LIVE_OPEN_TIMEOUT_MS,
  liveOpeningInFlight,
  LIVE_ENDPOINT,
  LIVE_LENGTHS,
  LIVE_MIN_BILLED_SECONDS,
  liveConfigureMessage,
  keptDirections,
  liveCreditsFor,
  liveRefundSplit,
  newLiveMeter,
  readLiveMeter,
  liveRefundCredits,
  liveTakeAbandoned,
  liveUsedSeconds,
  readRelayCall,
} from "./live";
import { liveAllowed } from "./enabled";

describe("live prices", () => {
  it("uses the catalogue's own credit basis", () => {
    expect(LIVE_COST_BASIS_USD_PER_CREDIT).toBe(COST_BASIS_USD_PER_CREDIT);
  });

  it("prices each length at fal's $0.08/s over $0.28, rounded up", () => {
    // $2.40 / 0.28 = 8.57, $4.80 / 0.28 = 17.14, $9.60 / 0.28 = 34.29
    expect(LIVE_LENGTHS.map(liveCreditsFor)).toEqual([9, 18, 35]);
  });

  it("never charges under fal's $1.20 session minimum", () => {
    expect(LIVE_MIN_BILLED_SECONDS).toBe(15);
    // $1.20 / 0.28 = 4.29 → 5, for 1 s as for 15 s
    expect(liveCreditsFor(1)).toBe(5);
    expect(liveCreditsFor(15)).toBe(5);
  });

  it("never sells a length for less than fal bills it", () => {
    for (const seconds of LIVE_LENGTHS) {
      expect(liveCreditsFor(seconds) * LIVE_COST_BASIS_USD_PER_CREDIT).toBeGreaterThanOrEqual(seconds * 0.08);
    }
  });
});

describe("the meter", () => {
  const t0 = 1_000_000;

  it("forwards a heartbeat only while the lease it buys ends inside the paid length", () => {
    // Each beat buys 5 s: the last one forwarded is at paid − 5 s.
    expect(heartbeatAllowed(t0, 30, t0 + 25_000)).toBe(true);
    expect(heartbeatAllowed(t0, 30, t0 + 25_001)).toBe(false);
  });

  it("charges nothing for a take that never opened", () => {
    expect(liveUsedSeconds({ paidSeconds: 60, startedAtMs: null, lastBeatAtMs: null, stoppedAtMs: null })).toBe(0);
    expect(liveRefundCredits(18, 0)).toBe(18);
  });

  it("charges fal's minimum for a take settled while its session was still opening", () => {
    const used = liveUsedSeconds({ paidSeconds: 60, startedAtMs: null, lastBeatAtMs: null, stoppedAtMs: t0, openingAtMs: t0 - 20_000 });
    expect(used).toBe(15);
    // 18 paid, 5 kept (fal's $1.20), 13 back
    expect(liveRefundCredits(18, used)).toBe(13);
  });

  it("knows when a /session may still be waiting on fal", () => {
    expect(liveOpeningInFlight(null, t0)).toBe(false);
    expect(liveOpeningInFlight(t0, t0 + LIVE_OPEN_TIMEOUT_MS + 9_999)).toBe(true);
    expect(liveOpeningInFlight(t0, t0 + LIVE_OPEN_TIMEOUT_MS + 10_000)).toBe(false);
    // The browser waits longer than the relay, so it never abandons a session the relay may still open.
    expect(LIVE_CLIENT_OPEN_TIMEOUT_MS).toBeGreaterThan(LIVE_OPEN_TIMEOUT_MS);
  });

  it("stopping early charges the seconds up to Stop, floored at fal's minimum", () => {
    const used = liveUsedSeconds({ paidSeconds: 60, startedAtMs: t0, lastBeatAtMs: t0 + 20_000, stoppedAtMs: t0 + 21_300 });
    expect(used).toBe(22);
    // 22 s = $1.76 → 7 credits; 18 paid → 11 back
    expect(liveRefundCredits(18, used)).toBe(11);
    expect(liveUsedSeconds({ paidSeconds: 60, startedAtMs: t0, lastBeatAtMs: t0, stoppedAtMs: t0 + 3000 })).toBe(15);
  });

  it("a Stop claimed after the last beat's lease cannot stretch the charge window past it — nor shrink it before a beat we forwarded", () => {
    // Lease ends at the last beat + 5 s: the earlier of that and Stop wins.
    expect(liveUsedSeconds({ paidSeconds: 120, startedAtMs: t0, lastBeatAtMs: t0 + 50_000, stoppedAtMs: t0 + 90_000 })).toBe(55);
  });

  it("a take that ran to the end keeps everything it paid", () => {
    const used = liveUsedSeconds({ paidSeconds: 30, startedAtMs: t0, lastBeatAtMs: t0 + 39_000, stoppedAtMs: null });
    expect(used).toBe(30);
    expect(liveRefundCredits(9, used)).toBe(0);
  });

  it("settles an abandoned take only once no session can still be opening or running", () => {
    // 100 s open timeout + 30 paid + 15 (three refused beats) + 120 margin = 265 s
    expect(liveTakeAbandoned(t0, 30, t0 + 265_000)).toBe(false);
    expect(liveTakeAbandoned(t0, 30, t0 + 265_001)).toBe(true);
  });
});

describe("the relay's allow-list", () => {
  const ok = { app_id: LIVE_ENDPOINT, sdp: "v=0" };

  it("passes the three bridge calls for this app", () => {
    expect(readRelayCall("https://wma.fal.run/ice", "POST", { app_id: LIVE_ENDPOINT })).toEqual({ kind: "ice" });
    expect(readRelayCall("https://wma.fal.run/session", "POST", ok)).toEqual({ kind: "session" });
    expect(readRelayCall("https://wma.fal.run/session/heartbeat", "POST", { session_id: "s1" })).toEqual({
      kind: "heartbeat",
      sessionId: "s1",
    });
  });

  it("refuses any other app, host, path, method or shape", () => {
    expect(readRelayCall("https://wma.fal.run/session", "POST", { ...ok, app_id: "fal-ai/veo3" })).toBeNull();
    expect(readRelayCall("https://wma.fal.run/session", "GET", ok)).toBeNull();
    expect(readRelayCall("https://wma.fal.run/session?x=1", "POST", ok)).toBeNull();
    expect(readRelayCall("https://evil.example/session", "POST", ok)).toBeNull();
    expect(readRelayCall("http://wma.fal.run/session", "POST", ok)).toBeNull();
    expect(readRelayCall("https://user:pw@wma.fal.run/session", "POST", ok)).toBeNull();
    expect(readRelayCall("https://wma.fal.run/sessions", "POST", ok)).toBeNull();
    expect(readRelayCall("https://wma.fal.run/session", "POST", { app_id: LIVE_ENDPOINT })).toBeNull();
    expect(readRelayCall("https://wma.fal.run/session/heartbeat", "POST", {})).toBeNull();
    expect(readRelayCall(null, "POST", ok)).toBeNull();
    expect(readRelayCall("not a url", "POST", ok)).toBeNull();
  });

  it("refuses the client's fallback that runs the model endpoint itself", () => {
    expect(readRelayCall(`https://fal.run/${LIVE_ENDPOINT}/ice`, "POST", {})).toBeNull();
  });
});

describe("who may use Live", () => {
  it("admins always; paid plans only once live_paid_plans is on; free and suspended never", () => {
    expect(liveAllowed({ role: "admin", plan: "none" }, false).error).toBeNull();
    expect(liveAllowed({ plan: "studio" }, false).code).toBe("notOpen");
    expect(liveAllowed({ plan: "basic" }, true).error).toBeNull();
    expect(liveAllowed({ plan: "none" }, true).code).toBe("needsPlan");
    expect(liveAllowed({ plan: "elite", status: "suspended" }, true).code).toBe("suspended");
  });
});

describe("the meter column", () => {
  it("starts empty and priced, and reads back what it wrote", () => {
    const meter = newLiveMeter({ paidSeconds: 60, resolution: "480p", aspect: "1:1", from: null, withImage: true });
    expect(meter.paidCredits).toBe(18);
    expect(readLiveMeter(JSON.parse(JSON.stringify(meter)))).toEqual(meter);
  });

  it("refuses what is not a live take's", () => {
    expect(readLiveMeter(null)).toBeNull();
    expect(readLiveMeter({ v: 1, paidSeconds: 45, paidCredits: 9 })).toBeNull();
    expect(readLiveMeter({ source: "x" })).toBeNull();
  });

  it("keeps twenty directions of 300 characters, blanks dropped", () => {
    const kept = keptDirections(["  a  ", "", 7, "b".repeat(400), ...Array(30).fill("c")]);
    expect(kept[0]).toBe("a");
    expect(kept[1]).toHaveLength(300);
    expect(kept).toHaveLength(20);
  });
});

describe("where a refund comes back from", () => {
  it("purchased first, then bonus, then the month", () => {
    expect(liveRefundSplit({ refund: 11, creditsUsed: 18, purchasedUsed: 4, bonusUsed: 5 })).toEqual({
      creditsUsed: 7,
      purchasedUsed: 0,
      bonusUsed: 0,
      purchasedBack: 4,
      bonusBack: 5,
    });
    expect(liveRefundSplit({ refund: 3, creditsUsed: 18, purchasedUsed: 10, bonusUsed: 0 })).toEqual({
      creditsUsed: 15,
      purchasedUsed: 7,
      bonusUsed: 0,
      purchasedBack: 3,
      bonusBack: 0,
    });
  });

  it("never hands back more than was charged", () => {
    expect(liveRefundSplit({ refund: 50, creditsUsed: 9, purchasedUsed: 0, bonusUsed: 0 }).creditsUsed).toBe(0);
  });
});

describe("the opening message", () => {
  it("speaks fal's protocol version 1 and starts at prompt version 1", () => {
    expect(liveConfigureMessage({ prompt: "x".repeat(5000), resolution: "768p", aspect: "9:16", imageUrl: null })).toEqual({
      type: "configure",
      prompt: "x".repeat(4000),
      prompt_version: 1,
      protocol_version: 1,
      resolution: "768p",
      aspect_ratio: "9:16",
      image_url: null,
    });
  });
});
