import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PRESS_STALE_MS,
  claimPress,
  clearSetPresses,
  filmBeatPressId,
  filmSiblingIds,
  finishPress,
  isPressAnswer,
  parseFilmBeat,
  parsePressId,
  pressClipId,
  pressLedgerId,
  readPress,
  renderPaidBefore,
  runPress,
} from "./press";
import { FILM_MAX_BEATS } from "./film";
import { SET_PRESS_RUNNING, SET_SAVE_FAILED } from "./messages";
import { recastTakeIds } from "../recast/repeat";

// One Helios press, delivered twice (operator, 2026-09-25: "GO ahead" on
// Cut 1). A resent shot or take must never run or charge twice: its first
// write is a claim row, a second delivery follows the first's answer, and
// every row the press reserves takes its id from the press.

const USER = "11111111-1111-4111-8111-111111111111";
const SET = "22222222-2222-4222-8222-222222222222";
const OTHER_SET = "33333333-3333-4333-8333-333333333333";
const PRESS = "44444444-4444-4444-8444-444444444444";
const UUID_V8 = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Answer = { data?: unknown; error?: { code?: string; message?: string } | null };
type Call = {
  table: string;
  op: "insert" | "select" | "update" | "delete" | "none";
  values?: unknown;
  cols?: string;
  filters: [string, string, unknown][];
  limit?: number;
  single?: boolean;
};

/** A client that records every call and answers each as the test says. */
function fakeDb(answer: (call: Call, calls: Call[]) => Answer | undefined) {
  const calls: Call[] = [];
  const db = {
    from: (table: string) => {
      const call: Call = { table, op: "none", filters: [] };
      calls.push(call);
      const settle = () => Promise.resolve({ data: null, error: null, ...(answer(call, calls) ?? {}) });
      const builder: Record<string, unknown> = {
        insert: (values: unknown) => ((call.op = "insert"), (call.values = values), builder),
        update: (values: unknown) => ((call.op = "update"), (call.values = values), builder),
        delete: () => ((call.op = "delete"), builder),
        select: (cols: string) => {
          if (call.op === "none") call.op = "select";
          call.cols = cols;
          return builder;
        },
        eq: (col: string, v: unknown) => (call.filters.push(["eq", col, v]), builder),
        lt: (col: string, v: unknown) => (call.filters.push(["lt", col, v]), builder),
        in: (col: string, v: unknown) => (call.filters.push(["in", col, v]), builder),
        limit: (n: number) => ((call.limit = n), builder),
        maybeSingle: () => ((call.single = true), settle()),
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => settle().then(resolve, reject),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

/** A clock that only moves when the follower sleeps. */
function clockOf(deadlineAt = 10_000) {
  let t = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    clock: {
      deadlineAt,
      intervalMs: 2_000,
      now: () => t,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        t += ms;
      },
    },
  };
}

const press = { id: PRESS, userId: USER, setId: SET, kind: "shot" as const };
const DUP = { code: "23505", message: "duplicate key value violates unique constraint" };
const ANSWER = { error: null, generationId: PRESS, succeeded: true };

afterEach(() => vi.restoreAllMocks());

describe("the ids", () => {
  it("takes a press id only as a UUID, lowercased", () => {
    expect(parsePressId(PRESS.toUpperCase())).toBe(PRESS);
    expect(parsePressId("9b2f7c1e-0d3a-4e5b-9c6d-7e8f9a0b1c2d")).toBe("9b2f7c1e-0d3a-4e5b-9c6d-7e8f9a0b1c2d");
    for (const junk of ["", "x", 7, null, undefined, {}, "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz", "44444444444444444444444444444444"]) {
      expect(parsePressId(junk), String(junk)).toBeNull();
    }
  });

  it("takes a film beat only as a whole number under the film's length", () => {
    expect(FILM_MAX_BEATS).toBe(3);
    for (const ok of [0, 1, 2]) expect(parseFilmBeat(ok)).toBe(ok);
    for (const junk of [3, -1, 1.5, "1", Number.NaN, null, undefined]) expect(parseFilmBeat(junk), String(junk)).toBeNull();
  });

  it("makes the clip's and a beat's ids from the press, the same every time, as version-8 UUIDs", () => {
    expect(pressClipId(PRESS)).toBe(pressClipId(PRESS));
    expect(filmBeatPressId(PRESS, 1)).toBe(filmBeatPressId(PRESS, 1));
    for (const id of [pressClipId(PRESS), filmBeatPressId(PRESS, 0), filmBeatPressId(PRESS, 2), pressClipId(filmBeatPressId(PRESS, 1))]) {
      expect(id).toMatch(UUID_V8);
    }
  });

  it("never gives two parts, beats or presses the same id, nor one of Recast's", () => {
    const other = "55555555-5555-4555-8555-555555555555";
    const ids = [PRESS, other];
    for (const p of [PRESS, other]) {
      ids.push(pressClipId(p));
      for (let b = 0; b < FILM_MAX_BEATS; b++) ids.push(filmBeatPressId(p, b), pressClipId(filmBeatPressId(p, b)));
    }
    expect(new Set(ids).size).toBe(ids.length);
    const recast = [...recastTakeIds(PRESS, 4), ...recastTakeIds(other, 4)];
    for (const id of ids.slice(2)) expect(recast).not.toContain(id);
  });

  it("claims a press under its own id, or its film beat's", () => {
    expect(pressLedgerId(null, null)).toBeNull();
    expect(pressLedgerId(null, 1)).toBeNull();
    expect(pressLedgerId(PRESS, null)).toBe(PRESS);
    expect(pressLedgerId(PRESS, 1)).toBe(filmBeatPressId(PRESS, 1));
  });

  it("lists the other beats' stills and clips, never the beat's own", () => {
    const sib = filmSiblingIds(PRESS, 1);
    expect(sib).toHaveLength(2 * (FILM_MAX_BEATS - 1));
    expect(sib).not.toContain(filmBeatPressId(PRESS, 1));
    expect(sib).not.toContain(pressClipId(filmBeatPressId(PRESS, 1)));
    expect(sib).toEqual([filmBeatPressId(PRESS, 0), pressClipId(filmBeatPressId(PRESS, 0)), filmBeatPressId(PRESS, 2), pressClipId(filmBeatPressId(PRESS, 2))]);
  });

  it("knows an answer when it sees one", () => {
    expect(isPressAnswer({ error: null })).toBe(true);
    expect(isPressAnswer({ error: "no" })).toBe(true);
    for (const junk of [null, "x", [], [{ error: null }], {}, { error: 7 }]) expect(isPressAnswer(junk), JSON.stringify(junk)).toBe(false);
  });
});

describe("claimPress", () => {
  it("claims nothing, and calls nothing, without an id", async () => {
    const { db, calls } = fakeDb(() => ({}));
    expect(await claimPress(db, { ...press, id: null }, clockOf().clock)).toEqual({ kind: "untracked" });
    expect(calls).toEqual([]);
  });

  it("claims a new press, then prunes only the person's own day-old rows", async () => {
    const { db, calls } = fakeDb(() => ({}));
    const { clock } = clockOf();
    const now = 1_800_000_000_000;
    expect(await claimPress(db, press, { ...clock, now: () => now })).toEqual({ kind: "claimed", id: PRESS });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ table: "location_set_presses", op: "insert", values: { id: PRESS, user_id: USER, set_id: SET, kind: "shot" } });
    expect(calls[1].op).toBe("delete");
    expect(calls[1].filters).toEqual([
      ["eq", "user_id", USER],
      ["lt", "created_at", new Date(now - 86_400_000).toISOString()],
    ]);
  });

  it("serves the press untracked, warning once, while the table is missing", async () => {
    vi.resetModules();
    const fresh = await import("./press");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const error of [{ code: "PGRST205", message: "Could not find the table in the schema cache" }, { code: "42P01", message: 'relation "location_set_presses" does not exist' }]) {
      const { db, calls } = fakeDb(() => ({ error }));
      expect(await fresh.claimPress(db, press, clockOf().clock)).toEqual({ kind: "untracked" });
      expect(calls).toHaveLength(1);
    }
    const missing = warn.mock.calls.filter((c) => String(c[0]).includes("helios-presses.sql"));
    expect(missing).toHaveLength(1);
  });

  it("serves the press untracked on any other failure but a duplicate", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db } = fakeDb(() => ({ error: { code: "23503", message: "violates foreign key constraint" } }));
    expect(await claimPress(db, press, clockOf().clock)).toEqual({ kind: "untracked" });
  });

  it("answers a second delivery with the first's stored answer, writing nothing", async () => {
    const { db, calls } = fakeDb((c) =>
      c.op === "insert" ? { error: DUP } : { data: { set_id: SET.toUpperCase(), kind: "shot", state: "done", result: ANSWER } },
    );
    expect(await claimPress(db, press, clockOf().clock)).toEqual({ kind: "repeat", answer: ANSWER });
    expect(calls.map((c) => c.op)).toEqual(["insert", "select"]);
  });

  it("follows a first delivery still running until it answers", async () => {
    const { clock, sleeps } = clockOf();
    const { db } = fakeDb((c) =>
      c.op === "insert"
        ? { error: DUP }
        : { data: { set_id: SET, kind: "shot", state: sleeps.length >= 2 ? "done" : "running", result: sleeps.length >= 2 ? ANSWER : null } },
    );
    expect(await claimPress(db, press, clock)).toEqual({ kind: "repeat", answer: ANSWER });
    expect(sleeps).toEqual([2_000, 2_000]);
  });

  it("says running when the first delivery outlives the clock", async () => {
    const { clock, sleeps } = clockOf(10_000);
    const { db } = fakeDb((c) => (c.op === "insert" ? { error: DUP } : { data: { set_id: SET, kind: "shot", state: "running", result: null } }));
    expect(await claimPress(db, press, clock)).toEqual({ kind: "running" });
    expect(sleeps.reduce((a, b) => a + b, 0)).toBe(10_000);
  });

  it("calls an id that is not this person's press on this set, of this kind, foreign", async () => {
    for (const row of [null, { set_id: OTHER_SET, kind: "shot", state: "done", result: ANSWER }, { set_id: SET, kind: "take", state: "done", result: ANSWER }]) {
      const { db, calls } = fakeDb((c) => (c.op === "insert" ? { error: DUP } : { data: row }));
      expect(await claimPress(db, press, clockOf().clock), JSON.stringify(row)).toEqual({ kind: "foreign" });
      expect(calls.filter((c) => c.op !== "select" && c.op !== "insert")).toEqual([]);
    }
  });

  it("keeps following through failed reads and malformed answers, and never runs the press again", async () => {
    const failing = fakeDb((c) => (c.op === "insert" ? { error: DUP } : { error: { message: "network down" } }));
    expect(await claimPress(failing.db, press, clockOf().clock)).toEqual({ kind: "running" });
    const malformed = fakeDb((c) => (c.op === "insert" ? { error: DUP } : { data: { set_id: SET, kind: "shot", state: "done", result: [1, 2] } }));
    expect(await claimPress(malformed.db, press, clockOf().clock)).toEqual({ kind: "running" });
  });

  it("reads only the person's own row, every time", async () => {
    const { clock } = clockOf();
    const { db, calls } = fakeDb((c) => (c.op === "insert" ? { error: DUP } : { data: { set_id: SET, kind: "shot", state: "running", result: null } }));
    await claimPress(db, press, clock);
    const selects = calls.filter((c) => c.op === "select");
    expect(selects.length).toBeGreaterThan(1);
    for (const s of selects) {
      expect(s.filters).toContainEqual(["eq", "user_id", USER]);
      expect(s.filters).toContainEqual(["eq", "id", PRESS]);
    }
  });
});

describe("finishPress", () => {
  it("stores the answer on the running row of this person's press", async () => {
    const { db, calls } = fakeDb(() => ({}));
    expect(await finishPress(db, { id: PRESS, userId: USER }, ANSWER)).toBe(true);
    expect(calls).toHaveLength(1);
    const values = calls[0].values as { state: string; result: unknown; finished_at: string };
    expect(calls[0].op).toBe("update");
    expect(values.state).toBe("done");
    expect(values.result).toEqual(ANSWER);
    expect(Number.isNaN(Date.parse(values.finished_at))).toBe(false);
    expect(calls[0].filters).toEqual([
      ["eq", "id", PRESS],
      ["eq", "user_id", USER],
      ["eq", "state", "running"],
    ]);
  });

  it("says false and never throws when the write fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await finishPress(fakeDb(() => ({ error: { message: "boom" } })).db, { id: PRESS, userId: USER }, ANSWER)).toBe(false);
    const throwing = { from: () => { throw new Error("down"); } } as unknown as SupabaseClient;
    expect(await finishPress(throwing, { id: PRESS, userId: USER }, ANSWER)).toBe(false);
  });
});

describe("runPress", () => {
  const work = () => {
    const fn = vi.fn(async () => ({ error: null, done: true }));
    return fn;
  };

  it("runs a claimed press once and stores its answer", async () => {
    const { db, calls } = fakeDb(() => ({}));
    const fn = work();
    expect(await runPress(db, press, clockOf().clock, fn)).toEqual({ error: null, done: true });
    expect(fn).toHaveBeenCalledTimes(1);
    const finish = calls.find((c) => c.op === "update");
    expect(finish?.values).toMatchObject({ state: "done", result: { error: null, done: true } });
  });

  it("answers a repeat with the stored answer, never running it", async () => {
    const { db } = fakeDb((c) => (c.op === "insert" ? { error: DUP } : { data: { set_id: SET, kind: "shot", state: "done", result: ANSWER } }));
    const fn = work();
    expect(await runPress(db, press, clockOf().clock, fn)).toEqual(ANSWER);
    expect(fn).not.toHaveBeenCalled();
  });

  it("says still rendering, or can't save, and runs nothing, for a running or foreign press", async () => {
    const running = fakeDb((c) => (c.op === "insert" ? { error: DUP } : { data: { set_id: SET, kind: "shot", state: "running", result: null } }));
    const fn = work();
    expect(await runPress(running.db, press, clockOf().clock, fn)).toEqual({ error: SET_PRESS_RUNNING });
    const foreign = fakeDb((c) => (c.op === "insert" ? { error: DUP } : { data: null }));
    expect(await runPress(foreign.db, press, clockOf().clock, fn)).toEqual({ error: SET_SAVE_FAILED });
    expect(fn).not.toHaveBeenCalled();
  });

  it("runs an untracked press once and stores nothing", async () => {
    const { db, calls } = fakeDb(() => ({}));
    const fn = work();
    expect(await runPress(db, { ...press, id: null }, clockOf().clock, fn)).toEqual({ error: null, done: true });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
  });

  it("rethrows a press that throws, and stores no answer for it", async () => {
    const { db, calls } = fakeDb(() => ({}));
    await expect(runPress(db, press, clockOf().clock, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("says a caller's own sentences when it gives them", async () => {
    const running = fakeDb((c) => (c.op === "insert" ? { error: DUP } : { data: { set_id: SET, kind: "shot", state: "running", result: null } }));
    expect(await runPress(running.db, press, clockOf().clock, work(), { running: "R", foreign: "F" })).toEqual({ error: "R" });
    const foreign = fakeDb((c) => (c.op === "insert" ? { error: DUP } : { data: null }));
    expect(await runPress(foreign.db, press, clockOf().clock, work(), { running: "R", foreign: "F" })).toEqual({ error: "F" });
  });
});

describe("readPress", () => {
  it("reads the person's own row on this set, and maps it", async () => {
    const { db, calls } = fakeDb(() => ({ data: { kind: "take", state: "done", result: ANSWER, created_at: "2026-09-25T10:00:00Z" } }));
    expect(await readPress(db, { id: PRESS, userId: USER, setId: SET })).toEqual({
      missing: false,
      row: { kind: "take", state: "done", result: ANSWER, createdAt: "2026-09-25T10:00:00Z" },
    });
    expect(calls[0].filters).toEqual([
      ["eq", "id", PRESS],
      ["eq", "user_id", USER],
      ["eq", "set_id", SET],
    ]);
    expect(await readPress(fakeDb(() => ({ data: null })).db, { id: PRESS, userId: USER, setId: SET })).toEqual({ missing: false, row: null });
  });

  it("says missing when the ledger can't be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await readPress(fakeDb(() => ({ error: { code: "PGRST205", message: "schema cache" } })).db, { id: PRESS, userId: USER, setId: SET })).toEqual({ missing: true });
    expect(await readPress(fakeDb(() => ({ error: { message: "timeout" } })).db, { id: PRESS, userId: USER, setId: SET })).toEqual({ missing: true });
  });
});

describe("renderPaidBefore", () => {
  const render = { pressId: PRESS, beat: 1 };

  it("looks for the Render's other beats' rows among the person's own", async () => {
    const { db, calls } = fakeDb(() => ({ data: [{ id: "x" }] }));
    expect(await renderPaidBefore(db, USER, render)).toBe(true);
    expect(calls[0]).toMatchObject({ table: "generations", op: "select", cols: "id", limit: 1 });
    expect(calls[0].filters).toEqual([
      ["eq", "user_id", USER],
      ["in", "id", filmSiblingIds(PRESS, 1)],
    ]);
  });

  it("says no when there are none, and when the read fails (the beat is counted)", async () => {
    expect(await renderPaidBefore(fakeDb(() => ({ data: [] })).db, USER, render)).toBe(false);
    expect(await renderPaidBefore(fakeDb(() => ({ error: { message: "down" } })).db, USER, render)).toBe(false);
  });
});

describe("clearSetPresses", () => {
  it("deletes the set's presses, the person's own", async () => {
    const { db, calls } = fakeDb(() => ({}));
    await clearSetPresses(db, SET, USER);
    expect(calls[0].op).toBe("delete");
    expect(calls[0].filters).toEqual([
      ["eq", "set_id", SET],
      ["eq", "user_id", USER],
    ]);
  });

  it("ignores a missing table quietly", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(clearSetPresses(fakeDb(() => ({ error: { code: "42P01", message: "does not exist" } })).db, SET, USER)).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("the table", () => {
  it("is named only in press.ts", () => {
    const root = join(__dirname, "..", "..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && readFileSync(p, "utf8").includes("location_set_presses")) hits.push(p);
      }
    };
    walk(root);
    expect(hits.map((p) => p.slice(root.length + 1))).toEqual(["lib/sets/press.ts"]);
  });

  it("is created by its pending SQL, server-only, and checked by verify-db", () => {
    const sql = readFileSync(join(__dirname, "../../../supabase/pending/helios-presses.sql"), "utf8");
    expect(sql).toContain("create table if not exists public.location_set_presses (");
    expect(sql).toContain("id uuid primary key,");
    expect(sql).toContain("kind text not null check (kind in ('shot','take','edit')),");
    expect(sql).toContain("alter table public.location_set_presses enable row level security;");
    expect(sql).toMatch(/revoke all on public\.location_set_presses from public, anon, authenticated;/);
    expect(sql).toContain("RUN THIS BEFORE PUSHING THE CODE");
    const verify = readFileSync(join(__dirname, "../../../scripts/verify-db.mjs"), "utf8");
    expect(verify).toContain('location_set_presses: ["id", "user_id", "set_id", "kind", "state", "result", "created_at", "finished_at"],');
  });

  it("a follower gives up a little after the platform's own ceiling", () => {
    expect(PRESS_STALE_MS).toBe(330_000);
  });
});
