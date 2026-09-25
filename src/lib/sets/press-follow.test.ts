import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PRESS_FOLLOW_GRACE_MS,
  PRESS_NONE_AFTER_MS,
  PRESS_NONE_READS,
  PRESS_POLL_MS,
  PRESS_READ_TIMEOUT_MS,
  PRESS_STALE_WITHIN_MS,
  PRESS_STILL_GOING_ANSWERS,
  SET_REQUEST_CEILING_MS,
  followPress,
  lateThrow,
  lostAnswer,
  newPressId,
  pressReadOf,
  stillGoingAnswer,
  type PressFollowed,
  type PressRead,
  type PressRows,
} from "./press-follow";
import { REPEAT_STILL_RUNNING } from "../generations/repeat-send";
import { PRESS_STALE_MS } from "./press";
import { SET_NOT_FOUND, SET_PRESS_RUNNING, SET_SHOOT_TOO_FAST } from "./messages";
import type { SetPressState } from "./press-actions";

// A paid press, named and followed by the page (2026-09-25, Cut 1 —
// operator: "GO ahead" on "never charge twice, and films that behave"). A
// dropped connection said "try again" while the render went on and was
// charged; people pressed again and paid again. Now each press has its own
// id, and a lost answer is read back by it until it lands, or until the
// platform's ceiling has surely passed.

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("newPressId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is a v4 UUID, fresh every time", () => {
    const ids = Array.from({ length: 200 }, () => newPressId());
    for (const id of ids) expect(id).toMatch(V4);
    expect(new Set(ids).size).toBe(200);
  });

  it("makes the same v4 where randomUUID is missing (an insecure context)", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: <T extends ArrayBufferView>(a: T) => real.getRandomValues(a as never) as T });
    expect(typeof (globalThis.crypto as { randomUUID?: unknown }).randomUUID).toBe("undefined");
    const ids = Array.from({ length: 50 }, () => newPressId());
    for (const id of ids) expect(id).toMatch(V4);
    expect(new Set(ids).size).toBe(50);
  });
});

type Step<T> = PressRead<T> | null;

/** A scripted read (by the clock), a clock that moves only when the follow sleeps, and what it asked for. */
function rig<T>(script: (now: number, n: number) => Step<T>, start = 0, alive: (reads: number) => boolean = () => true) {
  let clock = start;
  const sleeps: { ms: number; at: number }[] = [];
  const readsAt: number[] = [];
  return {
    read: async () => {
      readsAt.push(clock);
      return script(clock, readsAt.length);
    },
    alive: () => alive(readsAt.length),
    now: () => clock,
    sleep: async (ms: number) => {
      sleeps.push({ ms, at: clock });
      clock += ms;
    },
    sleeps,
    readsAt,
  };
}

const DEADLINE = SET_REQUEST_CEILING_MS + PRESS_FOLLOW_GRACE_MS;

describe("followPress", () => {
  it("hands over an answer that is already there, without waiting", async () => {
    const r = rig<string>(() => ({ state: "done", result: "the still" }), 10_000);
    expect(await followPress({ sentAt: 0, ...r })).toEqual({ kind: "landed", result: "the still" });
    expect(r.readsAt).toHaveLength(1);
    expect(r.sleeps).toHaveLength(0);
  });

  it("reads every 4 s until the answer lands", async () => {
    const r = rig<string>((_, n) => (n < 3 ? { state: "running" } : { state: "done", result: "the take" }), 10_000);
    expect(await followPress({ sentAt: 0, ...r })).toEqual({ kind: "landed", result: "the take" });
    expect(r.readsAt).toHaveLength(3);
    expect(r.sleeps.map((s) => s.ms)).toEqual([PRESS_POLL_MS, PRESS_POLL_MS]);
    expect(PRESS_POLL_MS).toBe(4_000);
  });

  it("says nothing started once reads in a row find nothing a minute after the send (review, 2026-09-25)", async () => {
    const r = rig<string>(() => ({ state: "none" }), 10_000);
    expect(await followPress({ sentAt: 0, ...r })).toEqual({ kind: "never-started" });
    // 10 s, 14 s … 58 s find nothing, but a delivery may still be on its way; 62 s is past the minute.
    expect(r.readsAt[r.readsAt.length - 1]).toBe(62_000);
    expect(PRESS_NONE_AFTER_MS).toBe(60_000);
    expect(PRESS_NONE_READS).toBe(2);
    expect(DEADLINE).toBe(330_000);
  });

  it("needs the reads in a row: one that shows the press at work starts the count again", async () => {
    // Nothing, then running (a slow cold start claimed it), then nothing is not "never started" at once.
    const r = rig<string>((now) => (now === 62_000 ? { state: "running" } : now < 100_000 ? { state: "none" } : { state: "done", result: "x" }), 10_000);
    expect(await followPress({ sentAt: 0, ...r })).toEqual({ kind: "never-started" });
    expect(r.readsAt[r.readsAt.length - 1]).toBe(70_000);
  });

  it("says nothing started at once when the server says the press is over with nothing under it", async () => {
    const r = rig<string>(() => ({ state: "none", final: true }), 5_000);
    expect(await followPress({ sentAt: 0, ...r })).toEqual({ kind: "never-started" });
    expect(r.readsAt).toHaveLength(1);
  });

  it("says History when the press is still running at the deadline", async () => {
    const r = rig<string>(() => ({ state: "running" }), 10_000);
    expect(await followPress({ sentAt: 0, ...r })).toEqual({ kind: "still-going" });
    expect(r.readsAt[r.readsAt.length - 1]).toBe(DEADLINE);
  });

  it("never takes a failed read for 'nothing started', nor for 'still going' (review, 2026-09-25)", async () => {
    // Offline the whole time: nothing is known, and it says so.
    const offline = rig<string>(() => null, 10_000);
    expect(await followPress({ sentAt: 0, ...offline })).toEqual({ kind: "unchecked" });
    expect(offline.readsAt[offline.readsAt.length - 1]).toBe(DEADLINE);
    // Nothing found early, then every read failed: still not known.
    const early = rig<string>((now) => (now < PRESS_NONE_AFTER_MS ? { state: "none" } : null), 10_000);
    expect(await followPress({ sentAt: 0, ...early })).toEqual({ kind: "unchecked" });
    // Failed reads between reads that show it at work are asked again, too.
    const flaky = rig<string>((_, n) => (n % 2 === 0 ? null : { state: "running" }), 10_000);
    expect(await followPress({ sentAt: 0, ...flaky })).toEqual({ kind: "still-going" });
    expect(flaky.readsAt).toHaveLength(81);
  });

  it("ends at once on rows the server calls final, and keeps rows that may still change for the deadline", async () => {
    const rows: PressRows = { still: { id: "s", status: "succeeded", resultUrl: "/s", viewUrl: "/s-big", posterUrl: null }, take: null };
    const final = rig<string>(() => ({ state: "rows", rows, final: true }), 10_000);
    expect(await followPress({ sentAt: 0, ...final })).toEqual({ kind: "rows", rows });
    expect(final.readsAt).toHaveLength(1);
    // Rows, then reads that fail: what History had is said at the deadline, never "nothing started".
    const open = rig<string>((_, n) => (n === 1 ? { state: "rows", rows, final: false } : null), 10_000);
    expect(await followPress({ sentAt: 0, ...open })).toEqual({ kind: "rows", rows });
    expect(open.readsAt[open.readsAt.length - 1]).toBe(DEADLINE);
  });

  it("tells the page once when a read shows the press at work", async () => {
    const seen: number[] = [];
    const r = rig<string>((_, n) => (n < 2 ? null : n < 5 ? { state: "running" } : { state: "done", result: "x" }), 10_000);
    expect(await followPress({ sentAt: 0, ...r, onRunning: () => seen.push(r.readsAt.length) })).toEqual({ kind: "landed", result: "x" });
    expect(seen).toEqual([2]);
  });

  it("takes a read that hangs as failed, so the deadline is kept", async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      const clock = { t: 10_000 };
      const followed = followPress<string>({
        sentAt: 0,
        read: () => (++n === 1 ? new Promise<PressRead<string> | null>(() => {}) : Promise.resolve({ state: "done", result: "late" })),
        alive: () => true,
        now: () => clock.t,
        sleep: async (ms) => {
          clock.t += ms;
        },
      });
      await vi.advanceTimersByTimeAsync(PRESS_READ_TIMEOUT_MS);
      expect(await followed).toEqual({ kind: "landed", result: "late" });
      expect(n).toBe(2);
      expect(PRESS_READ_TIMEOUT_MS).toBe(20_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes a read that throws as failed", async () => {
    const r = rig<string>((_, n) => {
      if (n === 1) throw new Error("offline");
      return { state: "done", result: "x" };
    }, 10_000);
    expect(await followPress({ sentAt: 0, ...r })).toEqual({ kind: "landed", result: "x" });
  });

  it("stops at once on a sentence to show", async () => {
    const r = rig<string>(() => ({ state: "error", error: SET_NOT_FOUND }), 10_000);
    expect(await followPress({ sentAt: 0, ...r })).toEqual({ kind: "error", error: SET_NOT_FOUND });
    expect(r.readsAt).toHaveLength(1);
  });

  it("stops quietly when the page has gone, before a read or after one", async () => {
    const gone = rig<string>(() => ({ state: "running" }), 10_000, () => false);
    expect(await followPress({ sentAt: 0, ...gone })).toEqual({ kind: "left" });
    expect(gone.readsAt).toHaveLength(0);
    // Gone while the second read was out: its answer is not handed over.
    const later = rig<string>((_, n) => (n < 2 ? { state: "running" } : { state: "done", result: "x" }), 10_000, (reads) => reads < 2);
    expect(await followPress({ sentAt: 0, ...later })).toEqual({ kind: "left" });
    expect(later.readsAt).toHaveLength(2);
  });

  it("reads once when it starts past the deadline, and gives that read's verdict", async () => {
    for (const [step, verdict] of [
      [{ state: "none" }, { kind: "never-started" }],
      [{ state: "running" }, { kind: "still-going" }],
      [null, { kind: "unchecked" }],
      [{ state: "done", result: "late" }, { kind: "landed", result: "late" }],
    ] as [Step<string>, PressFollowed<string>][]) {
      const r = rig<string>(() => step, 400_000);
      expect(await followPress({ sentAt: 0, ...r })).toEqual(verdict);
      expect(r.readsAt).toHaveLength(1);
      expect(r.sleeps).toHaveLength(0);
    }
  });

  it("never sleeps past the deadline", async () => {
    // Sent at 0, first read at 1 s: the reads fall 1 s short of the deadline, so the last sleep is 1 s.
    const r = rig<string>(() => ({ state: "running" }), 1_000);
    await followPress({ sentAt: 0, ...r });
    for (const s of r.sleeps) expect(s.ms).toBeLessThanOrEqual(DEADLINE - s.at);
    expect(r.sleeps[r.sleeps.length - 1].ms).toBe(1_000);
    expect(r.readsAt[r.readsAt.length - 1]).toBe(DEADLINE);
  });
});

describe("lostAnswer", () => {
  const words = { neverStarted: "nothing was charged", stillGoing: "History", unchecked: "couldn't confirm", inHistory: "in History" };
  it("is the answer that landed, or a sentence in its place", () => {
    const landed = { error: null, generationId: "g" };
    expect(lostAnswer({ kind: "landed", result: landed }, words)).toBe(landed);
    expect(lostAnswer({ kind: "never-started" }, words)).toEqual({ error: "nothing was charged" });
    expect(lostAnswer({ kind: "still-going" }, words)).toEqual({ error: "History" });
    expect(lostAnswer({ kind: "unchecked" }, words)).toEqual({ error: "couldn't confirm" });
    expect(lostAnswer({ kind: "rows", rows: { still: null, take: null } }, words)).toEqual({ error: "in History" });
    expect(lostAnswer({ kind: "error", error: SET_NOT_FOUND }, words)).toEqual({ error: SET_NOT_FOUND });
    // The page has gone: nothing is said.
    expect(lostAnswer({ kind: "left" }, words)).toEqual({ error: "" });
  });
});

describe("stillGoingAnswer", () => {
  it("knows the server's 'still rendering' answers, word for word", () => {
    // The copy of repeat-send.ts's sentence (that module is server-only) is the sentence itself.
    expect(stillGoingAnswer(REPEAT_STILL_RUNNING)).toBe(true);
    expect(PRESS_STILL_GOING_ANSWERS).toContain(REPEAT_STILL_RUNNING);
    // A resend that met the first delivery's claim row (press.ts runPress).
    expect(stillGoingAnswer(SET_PRESS_RUNNING)).toBe(true);
  });

  it("takes nothing else for one", () => {
    expect(stillGoingAnswer(null)).toBe(false);
    expect(stillGoingAnswer(undefined)).toBe(false);
    expect(stillGoingAnswer("")).toBe(false);
    expect(stillGoingAnswer(SET_SHOOT_TOO_FAST)).toBe(false);
  });
});

describe("lateThrow", () => {
  it("is a throw too late to be a deploy, never a fast one or one before the send", () => {
    expect(lateThrow(null, 1_000_000)).toBe(false);
    expect(lateThrow(0, 19_999)).toBe(false);
    // A function that crashed a minute in is followed, not reloaded over (review, 2026-09-25).
    expect(lateThrow(0, 20_000)).toBe(true);
    expect(lateThrow(0, 60_000)).toBe(true);
    expect(PRESS_STALE_WITHIN_MS).toBe(20_000);
  });
});

describe("the page's clock and the server's", () => {
  it("counts the set page's own ceiling", () => {
    const page = readFileSync(join(__dirname, "../../app/app/sets/[id]/page.tsx"), "utf8");
    const m = /export const maxDuration = (\d+);/.exec(page);
    expect(m).not.toBeNull();
    expect(SET_REQUEST_CEILING_MS).toBe(1000 * Number(m![1]));
  });

  it("stops following when the server stops calling a press running", () => {
    expect(SET_REQUEST_CEILING_MS + PRESS_FOLLOW_GRACE_MS).toBe(PRESS_STALE_MS);
  });
});

describe("pressReadOf (press-actions.ts readSetPress, read by the follow)", () => {
  const shot = { error: null, generationId: "g", succeeded: true } as never;
  it("hands over the press's own answer, refusals included", () => {
    expect(pressReadOf({ error: null, state: "answered", kind: "shot", answer: shot }, "shot")).toEqual({ state: "done", result: shot });
    const refused = { error: SET_SHOOT_TOO_FAST };
    expect(pressReadOf({ error: null, state: "answered", kind: "shot", answer: refused }, "shot")).toEqual({ state: "done", result: refused });
    // Another kind's answer is not this press's: asked again.
    expect(pressReadOf({ error: null, state: "answered", kind: "take", answer: refused }, "shot")).toBeNull();
  });

  it("says running for a press still working", () => {
    expect(pressReadOf({ error: null, state: "running" }, "take")).toEqual({ state: "running" });
  });

  it("hands over the rows a press left, final when its request is over or they are settled", () => {
    const row = (id: string, status: string) => ({ id, status, resultUrl: null, viewUrl: null, posterUrl: null });
    const still = row("a", "succeeded");
    const clip = row("b", "generating");
    const left = (s: typeof still | null, t: typeof clip | null, ended: boolean): SetPressState => ({ error: null, state: "unanswered", still: s, take: t, ended });
    // The request is over: nothing more will come.
    expect(pressReadOf(left(still, null, true), "take")).toEqual({ state: "rows", rows: { still, take: null }, final: true });
    // Not known to be over (no ledger): a take is settled once its clip is reserved, or its end still failed…
    expect(pressReadOf(left(still, clip, false), "take")).toMatchObject({ final: true });
    expect(pressReadOf(left(row("a", "failed"), null, false), "take")).toMatchObject({ final: true });
    // …but its end still alone may still be followed by its clip.
    expect(pressReadOf(left(still, null, false), "take")).toMatchObject({ state: "rows", final: false });
    // A shot is settled once its still has finished.
    expect(pressReadOf(left(still, null, false), "shot")).toMatchObject({ final: true });
    expect(pressReadOf(left(row("a", "generating"), null, false), "shot")).toMatchObject({ final: false });
  });

  it("says nothing started only when the server found nothing under the press, for good when it is over", () => {
    expect(pressReadOf({ error: null, state: "not-found", ended: false }, "shot")).toEqual({ state: "none", final: false });
    expect(pressReadOf({ error: null, state: "not-found", ended: true }, "shot")).toEqual({ state: "none", final: true });
    // Neither the ledger nor History could say: a failed read, never "nothing started".
    expect(pressReadOf({ error: null, state: "unknown" }, "shot")).toBeNull();
  });

  it("shows the server's sentence", () => {
    expect(pressReadOf({ error: SET_NOT_FOUND }, "take")).toEqual({ state: "error", error: SET_NOT_FOUND });
  });
});
