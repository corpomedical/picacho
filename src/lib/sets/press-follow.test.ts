import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PRESS_CUT_OFF_AFTER_MS,
  PRESS_FOLLOW_GRACE_MS,
  PRESS_POLL_MS,
  PRESS_STILL_GOING_ANSWERS,
  SET_REQUEST_CEILING_MS,
  cutOff,
  followPress,
  lostAnswer,
  newPressId,
  pressReadOf,
  stillGoingAnswer,
  type PressFollowed,
  type PressRead,
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

  it("says nothing started only when the last read, past the ceiling, finds nothing", async () => {
    const r = rig<string>(() => ({ state: "none" }), 10_000);
    expect(await followPress({ sentAt: 0, ...r })).toEqual({ kind: "never-started" });
    // 10 s, 14 s … 330 s: every 4 s, the last one exactly at the deadline, none after it.
    expect(r.readsAt).toHaveLength(81);
    expect(r.readsAt[r.readsAt.length - 1]).toBe(DEADLINE);
    expect(r.readsAt.filter((t) => t >= DEADLINE)).toHaveLength(1);
    expect(DEADLINE).toBe(330_000);
  });

  it("says History when the press is still running at the deadline", async () => {
    const r = rig<string>(() => ({ state: "running" }), 10_000);
    expect(await followPress({ sentAt: 0, ...r })).toEqual({ kind: "still-going" });
    expect(r.readsAt[r.readsAt.length - 1]).toBe(DEADLINE);
  });

  it("never takes a failed read for 'nothing started'", async () => {
    const r = rig<string>((now) => (now < DEADLINE ? { state: "none" } : null), 10_000);
    expect(await followPress({ sentAt: 0, ...r })).toEqual({ kind: "still-going" });
    // Failed reads before the deadline are asked again, too.
    const flaky = rig<string>((_, n) => (n % 2 === 0 ? null : { state: "running" }), 10_000);
    expect(await followPress({ sentAt: 0, ...flaky })).toEqual({ kind: "still-going" });
    expect(flaky.readsAt).toHaveLength(81);
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
      [null, { kind: "still-going" }],
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
  const words = { neverStarted: "nothing was charged", stillGoing: "History" };
  it("is the answer that landed, or a sentence in its place", () => {
    const landed = { error: null, generationId: "g" };
    expect(lostAnswer({ kind: "landed", result: landed }, words)).toBe(landed);
    expect(lostAnswer({ kind: "never-started" }, words)).toEqual({ error: "nothing was charged" });
    expect(lostAnswer({ kind: "still-going" }, words)).toEqual({ error: "History" });
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

describe("cutOff", () => {
  it("is a throw at the platform's ceiling, never a fast one or one before the send", () => {
    expect(cutOff(null, 1_000_000)).toBe(false);
    expect(cutOff(0, 269_999)).toBe(false);
    expect(cutOff(0, 270_000)).toBe(true);
    expect(PRESS_CUT_OFF_AFTER_MS).toBe(270_000);
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

  it("says running for a press still working, or one whose rows may still land", () => {
    expect(pressReadOf({ error: null, state: "running" }, "take")).toEqual({ state: "running" });
    const left: SetPressState = { error: null, state: "unanswered", still: { id: "a", status: "succeeded" }, take: { id: "b", status: "generating" } };
    expect(pressReadOf(left, "take")).toEqual({ state: "running" });
  });

  it("says nothing started only when the server found nothing under the press", () => {
    expect(pressReadOf({ error: null, state: "not-found" }, "shot")).toEqual({ state: "none" });
    // The ledger unreadable (its SQL not run yet): a failed read, never "nothing started".
    expect(pressReadOf({ error: null, state: "unknown" }, "shot")).toBeNull();
  });

  it("shows the server's sentence", () => {
    expect(pressReadOf({ error: SET_NOT_FOUND }, "take")).toEqual({ state: "error", error: SET_NOT_FOUND });
  });
});
