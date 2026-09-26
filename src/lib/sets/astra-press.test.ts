import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  astraPressEndScope,
  astraPressMarkScope,
  astraPressScope,
  claimAstraPress,
  claimAstraPressGiveBack,
  endAstraPress,
  giveBackAstraEdit,
  markAstraPressReserved,
  parseAstraPressId,
  pressStateOf,
  readAstraPress,
  refundLostAstraPress,
} from "./astra-press";
import { SET_EDIT_FOLLOW_CAP_MS, SET_EDIT_PRESS_LIFETIME_MS, SET_EDIT_PRESS_WINDOW_SECONDS, SET_EDIT_TRIES_MONTH_SCOPE, SET_EDITS_MONTH_SCOPE } from "./set-config";
import { RATE_HITS_LONGEST_WINDOW_SECONDS } from "../rate-hits";

// One Astra job per press (2026-09-25, Cut 1 — operator: "GO ahead", never
// charge twice). A browser's silent resend of an edit ran a whole second
// Astra job; now the first delivery claims the press in the limiter's own
// table, a repeat is told so, the first always leaves an end marker, and a
// press that did not save gives its month's change back.

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const PRESS = "3f2a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b";
const NOW = Date.parse("2026-09-25T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

type Row = { id: number; user_id: string; scope: string; created_at: string };

/**
 * api_rate_hits and api_rate_check as the service client answers them.
 * rpc(api_rate_check) is the real function's count-then-insert: within the
 * window, under max, it inserts and says true; at max it says false.
 */
function fakeDb(
  rows: Row[],
  fail: { rpc?: string; rpcThrows?: boolean; rpcNull?: boolean; select?: string; delete?: string; throws?: boolean; steal?: number } = {},
) {
  const rpcCalls: Record<string, unknown>[] = [];
  const statements: string[] = [];
  let nextId = Math.max(0, ...rows.map((r) => r.id)) + 1;
  let steals = fail.steal ?? 0;
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      expect(name).toBe("api_rate_check");
      rpcCalls.push(args);
      if (fail.rpcThrows) throw new Error("network down");
      if (fail.rpc) return { data: null, error: { message: fail.rpc } };
      if (fail.rpcNull) return { data: null, error: null };
      const since = NOW - Number(args.p_window_seconds) * 1000;
      const used = rows.filter((r) => r.user_id === args.p_user_id && r.scope === args.p_scope && Date.parse(r.created_at) >= since).length;
      if (used >= Number(args.p_max)) return { data: false, error: null };
      rows.push({ id: nextId++, user_id: String(args.p_user_id), scope: String(args.p_scope), created_at: new Date(NOW).toISOString() });
      return { data: true, error: null };
    },
    from(table: string) {
      expect(table).toBe("api_rate_hits");
      if (fail.throws) throw new Error("network down");
      const filters: ((r: Row) => boolean)[] = [];
      let mode: "select" | "delete" = "select";
      let columns = "";
      let counted = false;
      let desc = false;
      let limit = Infinity;
      const run = () => {
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (mode === "select") {
          statements.push("select");
          if (fail.select) return { data: null, error: { message: fail.select } };
          const ordered = desc ? [...hit].sort((a, b) => b.id - a.id) : hit;
          const cols = columns.split(",").map((c) => c.trim()) as (keyof Row)[];
          return { data: ordered.slice(0, limit).map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))), error: null };
        }
        statements.push("delete");
        if (fail.delete) return { error: { message: fail.delete }, count: null };
        // A concurrent give-back takes the row first.
        if (steals > 0) {
          steals--;
          for (const r of hit) rows.splice(rows.indexOf(r), 1);
          return { error: null, count: counted ? 0 : null };
        }
        for (const r of hit) rows.splice(rows.indexOf(r), 1);
        return { error: null, count: counted ? hit.length : null };
      };
      const builder = {
        select: (c: string) => ((columns = c), builder),
        delete: (opts?: { count?: string }) => {
          mode = "delete";
          counted = opts?.count === "exact";
          return builder;
        },
        eq: (column: keyof Row, value: unknown) => (filters.push((r) => r[column] === value), builder),
        in: (column: keyof Row, values: unknown[]) => (filters.push((r) => values.includes(r[column])), builder),
        order: (column: string, opts: { ascending: boolean }) => {
          expect(column).toBe("id");
          desc = !opts.ascending;
          return builder;
        },
        limit: (n: number) => ((limit = n), builder),
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
      };
      return builder;
    },
  };
  return { db: client as unknown as SupabaseClient, rpcCalls, statements, rows };
}

let warned: string[];
beforeEach(() => {
  warned = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => void warned.push(args.join(" ")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseAstraPressId", () => {
  it("takes a UUID, lowercased, and nothing else", () => {
    expect(parseAstraPressId(PRESS.toUpperCase())).toBe(PRESS);
    for (const bad of ["x", "", 42, null, undefined, `${PRESS}0`, `${PRESS} drop`, { id: PRESS }]) expect(parseAstraPressId(bad), String(bad)).toBeNull();
  });
});

describe("claimAstraPress", () => {
  it("asks the limiter for a one-shot row under the press's own scope, and only that", async () => {
    const { db, rpcCalls } = fakeDb([]);
    expect(await claimAstraPress(db, USER, PRESS)).toBe("first");
    expect(rpcCalls).toEqual([{ p_user_id: USER, p_window_seconds: SET_EDIT_PRESS_WINDOW_SECONDS, p_max: 1, p_scope: `set-astra-press:${PRESS}` }]);
    expect(astraPressScope(PRESS)).toBe(`set-astra-press:${PRESS}`);
  });

  it("is the first delivery once, and a repeat after that — for this person's press only", async () => {
    const { db } = fakeDb([]);
    expect(await claimAstraPress(db, USER, PRESS)).toBe("first");
    expect(await claimAstraPress(db, USER, PRESS)).toBe("repeat");
    expect(await claimAstraPress(db, USER, PRESS)).toBe("repeat");
    // Another person's press of the same id is their own.
    expect(await claimAstraPress(db, OTHER, PRESS)).toBe("first");
  });

  it("two deliveries at once: exactly one is the first", async () => {
    const { db } = fakeDb([]);
    const both = await Promise.all([claimAstraPress(db, USER, PRESS), claimAstraPress(db, USER, PRESS)]);
    expect(both.sort()).toEqual(["first", "repeat"]);
  });

  it("is unavailable, never a repeat, when the limiter can't be asked", async () => {
    expect(await claimAstraPress(fakeDb([], { rpc: "timeout" }).db, USER, PRESS)).toBe("unavailable");
    expect(await claimAstraPress(fakeDb([], { rpcThrows: true }).db, USER, PRESS)).toBe("unavailable");
    expect(await claimAstraPress(fakeDb([], { rpcNull: true }).db, USER, PRESS)).toBe("unavailable");
    expect(warned).toHaveLength(3);
  });

  it("never falls back to the legacy 3-argument call, whose one shared bucket would make every press a repeat", async () => {
    const { db, rpcCalls } = fakeDb([], { rpc: "Could not find the function public.api_rate_check" });
    await claimAstraPress(db, USER, PRESS);
    await endAstraPress(db, USER, PRESS, "saved");
    expect(rpcCalls.length).toBe(2);
    expect(rpcCalls.every((c) => typeof c.p_scope === "string" && (c.p_scope as string).includes(PRESS))).toBe(true);
  });

  it("counts within a window the prune keeps", () => {
    expect(SET_EDIT_PRESS_WINDOW_SECONDS).toBeLessThanOrEqual(RATE_HITS_LONGEST_WINDOW_SECONDS);
    // Longer than a delivery can live, so a late resend is still a repeat.
    expect(SET_EDIT_PRESS_WINDOW_SECONDS * 1000).toBeGreaterThan(SET_EDIT_PRESS_LIFETIME_MS);
  });
});

describe("endAstraPress", () => {
  it("leaves one marker, saved or not, however often it is said", async () => {
    const { db, rpcCalls, rows } = fakeDb([]);
    await endAstraPress(db, USER, PRESS, "saved");
    await endAstraPress(db, USER, PRESS, "saved");
    await endAstraPress(db, USER, PRESS, "unsaved");
    expect(rpcCalls.map((c) => [c.p_scope, c.p_max])).toEqual([
      [`set-astra-press-saved:${PRESS}`, 1],
      [`set-astra-press-saved:${PRESS}`, 1],
      [`set-astra-press-unsaved:${PRESS}`, 1],
    ]);
    expect(rows.map((r) => r.scope)).toEqual([astraPressEndScope(PRESS, "saved"), astraPressEndScope(PRESS, "unsaved")]);
  });

  it("never throws, and says when it could not", async () => {
    await expect(endAstraPress(fakeDb([], { rpc: "timeout" }).db, USER, PRESS, "saved")).resolves.toBe(false);
    await expect(endAstraPress(fakeDb([], { rpcThrows: true }).db, USER, PRESS, "unsaved")).resolves.toBe(false);
    await expect(endAstraPress(fakeDb([], { rpcNull: true }).db, USER, PRESS, "unsaved")).resolves.toBe(false);
    expect(warned).toHaveLength(2);
    expect(warned[0]).toContain("timeout");
  });

  // Helios Cut 4, step A5: a "saved" written the moment the change saved is not written again.
  it("says the marker is there, whether this call wrote it or one before it did", async () => {
    const { db } = fakeDb([]);
    expect(await endAstraPress(db, USER, PRESS, "saved")).toBe(true);
    expect(await endAstraPress(db, USER, PRESS, "saved")).toBe(true);
  });
});

// A press the platform stopped (Helios Cut 4, step A5, 2026-09-26 — the
// owner's decision D12): its change comes back once, whoever gives it —
// the press itself or the page's read-back (critic item 13).
describe("a press's marks: its change reserved, and given back once", () => {
  it("leaves one 'reserved' row per press, in the press's window", async () => {
    const { db, rpcCalls, rows } = fakeDb([]);
    expect(await markAstraPressReserved(db, USER, PRESS)).toBe(true);
    expect(await markAstraPressReserved(db, USER, PRESS)).toBe(true);
    expect(rpcCalls[0]).toEqual({ p_user_id: USER, p_window_seconds: SET_EDIT_PRESS_WINDOW_SECONDS, p_max: 1, p_scope: `set-astra-press-reserved:${PRESS}` });
    expect(rows.map((r) => r.scope)).toEqual([astraPressMarkScope(PRESS, "reserved")]);
    expect(await markAstraPressReserved(fakeDb([], { rpc: "timeout" }).db, USER, PRESS)).toBe(false);
  });

  it("lets exactly one give-back claim a press's change, even two at once", async () => {
    const { db, rpcCalls } = fakeDb([]);
    const both = await Promise.all([claimAstraPressGiveBack(db, USER, PRESS), claimAstraPressGiveBack(db, USER, PRESS)]);
    expect(both.sort()).toEqual(["first", "repeat"]);
    expect(rpcCalls.every((c) => c.p_scope === `set-astra-press-given:${PRESS}` && c.p_max === 1 && c.p_window_seconds === SET_EDIT_PRESS_WINDOW_SECONDS)).toBe(true);
    expect(await claimAstraPressGiveBack(db, OTHER, PRESS)).toBe("first");
    // Never "first" when the limiter can't be asked: nothing is given then.
    expect(await claimAstraPressGiveBack(fakeDb([], { rpcThrows: true }).db, USER, PRESS)).toBe("unavailable");
  });
});

describe("refundLostAstraPress", () => {
  const row = (id: number, scope: string, age: number, user = USER): Row => ({ id, user_id: user, scope, created_at: ago(age) });
  const LOST = SET_EDIT_PRESS_LIFETIME_MS + 5_000;
  /** A press the platform stopped after its change was reserved: the month's rows, its claim and its "reserved" marker. */
  const stopped = (...more: Row[]) => [
    row(1, SET_EDITS_MONTH_SCOPE, 900_000),
    row(2, SET_EDITS_MONTH_SCOPE, LOST),
    row(3, SET_EDIT_TRIES_MONTH_SCOPE, LOST),
    row(4, astraPressScope(PRESS), LOST),
    row(5, astraPressMarkScope(PRESS, "reserved"), LOST - 1_000),
    ...more,
  ];
  const monthRows = (rows: Row[]) => rows.filter((r) => r.scope === SET_EDITS_MONTH_SCOPE).length;

  it("gives a stopped press's reserved change back once, and never its try", async () => {
    const rows = stopped();
    const { db } = fakeDb(rows);
    expect(await refundLostAstraPress(db, USER, PRESS, NOW)).toBe(true);
    expect(monthRows(rows)).toBe(1);
    // The try may have been billed (critic item 1): it stays counted.
    expect(rows.filter((r) => r.scope === SET_EDIT_TRIES_MONTH_SCOPE)).toHaveLength(1);
    expect(rows.some((r) => r.scope === astraPressMarkScope(PRESS, "given"))).toBe(true);
    // Read again: nothing more.
    expect(await refundLostAstraPress(db, USER, PRESS, NOW)).toBe(false);
    expect(monthRows(rows)).toBe(1);
    // The press still reads lost (no end marker is invented): the page judges it by the saved copy.
    expect(await readAstraPress(db, USER, PRESS, NOW)).toBe("lost");
  });

  it("gives once when two read-backs ask at the same moment", async () => {
    const rows = stopped();
    const { db } = fakeDb(rows);
    const both = await Promise.all([refundLostAstraPress(db, USER, PRESS, NOW), refundLostAstraPress(db, USER, PRESS, NOW)]);
    expect(both.sort()).toEqual([false, true]);
    expect(monthRows(rows)).toBe(1);
  });

  // Critic item 13: the press gave its change back, then the platform stopped
  // it before its "unsaved" marker — it reads "lost", and must not be given twice.
  it("gives nothing for a press whose own give-back already claimed it", async () => {
    const rows = stopped(row(6, astraPressMarkScope(PRESS, "given"), LOST - 2_000));
    const { db } = fakeDb(rows);
    expect(await readAstraPress(db, USER, PRESS, NOW)).toBe("lost");
    expect(await refundLostAstraPress(db, USER, PRESS, NOW)).toBe(false);
    expect(monthRows(rows)).toBe(2);
  });

  it("gives nothing for a press that ended, is still running, reserved nothing, or is past its window", async () => {
    const none = async (rows: Row[], why: string) => {
      const before = monthRows(rows);
      expect(await refundLostAstraPress(fakeDb(rows).db, USER, PRESS, NOW), why).toBe(false);
      expect(monthRows(rows), why).toBe(before);
    };
    await none(stopped(row(6, astraPressEndScope(PRESS, "saved"), LOST - 3_000)), "saved");
    await none(stopped(row(6, astraPressEndScope(PRESS, "unsaved"), LOST - 3_000)), "unsaved");
    await none([row(1, SET_EDITS_MONTH_SCOPE, 60_000), row(4, astraPressScope(PRESS), 60_000), row(5, astraPressMarkScope(PRESS, "reserved"), 59_000)], "running");
    // An admin's press, or one stopped before its change was taken: nothing was reserved.
    await none([row(1, SET_EDITS_MONTH_SCOPE, 900_000), row(4, astraPressScope(PRESS), LOST)], "not reserved");
    const old = SET_EDIT_PRESS_WINDOW_SECONDS * 1000 + 1_000;
    await none([row(1, SET_EDITS_MONTH_SCOPE, old), row(4, astraPressScope(PRESS), old), row(5, astraPressMarkScope(PRESS, "reserved"), old)], "too old");
    // Another person's marks never count for this one.
    await none([row(1, SET_EDITS_MONTH_SCOPE, 900_000), row(4, astraPressScope(PRESS), LOST), row(5, astraPressMarkScope(PRESS, "reserved"), LOST, OTHER)], "another's mark");
  });

  it("gives nothing when the rows can't be read or the give-back can't be claimed", async () => {
    const unread = stopped();
    expect(await refundLostAstraPress(fakeDb(unread, { select: "timeout" }).db, USER, PRESS, NOW)).toBe(false);
    const unclaimed = stopped();
    expect(await refundLostAstraPress(fakeDb(unclaimed, { rpc: "timeout" }).db, USER, PRESS, NOW)).toBe(false);
    expect(monthRows(unread)).toBe(2);
    expect(monthRows(unclaimed)).toBe(2);
  });

  it("keeps every mark inside the window the prune keeps", () => {
    expect(SET_EDIT_PRESS_WINDOW_SECONDS).toBeLessThanOrEqual(RATE_HITS_LONGEST_WINDOW_SECONDS);
    // A stopped press is found long before its window ends: the page follows it for SET_EDIT_FOLLOW_CAP_MS at most.
    expect(SET_EDIT_PRESS_WINDOW_SECONDS * 1000).toBeGreaterThan(SET_EDIT_PRESS_LIFETIME_MS + SET_EDIT_FOLLOW_CAP_MS);
  });
});

describe("where a press stands", () => {
  const row = (id: number, scope: string, age: number, user = USER): Row => ({ id, user_id: user, scope, created_at: ago(age) });

  it("none, running, lost, saved and unsaved", () => {
    expect(pressStateOf([], PRESS, NOW)).toBe("none");
    expect(pressStateOf([row(1, astraPressScope(PRESS), 5_000)], PRESS, NOW)).toBe("running");
    expect(pressStateOf([row(1, astraPressScope(PRESS), SET_EDIT_PRESS_LIFETIME_MS - 1)], PRESS, NOW)).toBe("running");
    expect(pressStateOf([row(1, astraPressScope(PRESS), SET_EDIT_PRESS_LIFETIME_MS + 1)], PRESS, NOW)).toBe("lost");
    expect(pressStateOf([row(1, astraPressScope(PRESS), 5_000), row(2, astraPressEndScope(PRESS, "saved"), 1_000)], PRESS, NOW)).toBe("saved");
    expect(pressStateOf([row(1, astraPressScope(PRESS), 5_000), row(2, astraPressEndScope(PRESS, "unsaved"), 1_000)], PRESS, NOW)).toBe("unsaved");
    // An old claim that did end is not lost.
    expect(pressStateOf([row(1, astraPressScope(PRESS), 900_000), row(2, astraPressEndScope(PRESS, "saved"), 800_000)], PRESS, NOW)).toBe("saved");
  });

  it("saved wins over unsaved", () => {
    const both = [row(1, astraPressEndScope(PRESS, "unsaved"), 1_000), row(2, astraPressEndScope(PRESS, "saved"), 1_000)];
    expect(pressStateOf(both, PRESS, NOW)).toBe("saved");
  });

  it("reads only this person's rows of this press", async () => {
    const other = "4f2a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b";
    const { db } = fakeDb([
      row(1, astraPressScope(PRESS), 5_000),
      row(2, astraPressEndScope(PRESS, "saved"), 1_000, OTHER),
      row(3, astraPressEndScope(other, "saved"), 1_000),
      row(4, SET_EDITS_MONTH_SCOPE, 1_000),
    ]);
    expect(await readAstraPress(db, USER, PRESS, NOW)).toBe("running");
    expect(await readAstraPress(db, OTHER, PRESS, NOW)).toBe("saved");
    expect(await readAstraPress(db, USER, "5f2a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b", NOW)).toBe("none");
  });

  it("follows a whole press: claimed, then ended", async () => {
    const { db } = fakeDb([]);
    expect(await readAstraPress(db, USER, PRESS, NOW)).toBe("none");
    await claimAstraPress(db, USER, PRESS);
    expect(await readAstraPress(db, USER, PRESS, NOW)).toBe("running");
    await endAstraPress(db, USER, PRESS, "unsaved");
    expect(await readAstraPress(db, USER, PRESS, NOW)).toBe("unsaved");
  });

  it("is unread, never none, when the rows can't be read", async () => {
    expect(await readAstraPress(fakeDb([], { select: "timeout" }).db, USER, PRESS, NOW)).toBe("unread");
    expect(await readAstraPress(fakeDb([], { throws: true }).db, USER, PRESS, NOW)).toBe("unread");
    expect(warned).toHaveLength(2);
  });
});

describe("giveBackAstraEdit", () => {
  const month = (id: number, user = USER, scope = SET_EDITS_MONTH_SCOPE): Row => ({ id, user_id: user, scope, created_at: ago(60_000) });

  it("removes exactly one row: the newest of this person's month of changes", async () => {
    const rows = [month(1), month(2), month(3, OTHER), month(4, USER, SET_EDIT_TRIES_MONTH_SCOPE), month(5, USER, "set-astra-edit"), month(6, OTHER)];
    const { db } = fakeDb(rows);
    expect(await giveBackAstraEdit(db, USER)).toBe(true);
    expect(rows.map((r) => r.id)).toEqual([1, 3, 4, 5, 6]);
  });

  // Helios Cut 4, step A2 (2026-09-26): a try OpenAI never billed comes back too, from its own bucket.
  it("removes the newest of this person's month of tries when asked for that bucket, and never a change", async () => {
    const rows = [month(1), month(2, USER, SET_EDIT_TRIES_MONTH_SCOPE), month(3, USER, SET_EDIT_TRIES_MONTH_SCOPE), month(4, OTHER, SET_EDIT_TRIES_MONTH_SCOPE)];
    const { db } = fakeDb(rows);
    expect(await giveBackAstraEdit(db, USER, SET_EDIT_TRIES_MONTH_SCOPE)).toBe(true);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 4]);
    // Nothing in the bucket: nothing given, and the month's change untouched.
    const none = [month(1)];
    expect(await giveBackAstraEdit(fakeDb(none).db, USER, SET_EDIT_TRIES_MONTH_SCOPE)).toBe(false);
    expect(none).toHaveLength(1);
  });

  it("gives nothing back when there is nothing to give", async () => {
    const rows = [month(1, OTHER), month(2, USER, SET_EDIT_TRIES_MONTH_SCOPE)];
    const { db } = fakeDb(rows);
    expect(await giveBackAstraEdit(db, USER)).toBe(false);
    expect(rows).toHaveLength(2);
  });

  it("looks once more when another give-back took the row first, and stops there", async () => {
    const rows = [month(1), month(2)];
    const once = fakeDb(rows, { steal: 1 });
    expect(await giveBackAstraEdit(once.db, USER)).toBe(true);
    expect(once.statements).toEqual(["select", "delete", "select", "delete"]);
    expect(rows).toEqual([]);

    const always = fakeDb([month(1), month(2), month(3)], { steal: 5 });
    expect(await giveBackAstraEdit(always.db, USER)).toBe(false);
    expect(always.statements).toEqual(["select", "delete", "select", "delete"]);
  });

  it("never throws: an error or a throw gives nothing back, and says so", async () => {
    expect(await giveBackAstraEdit(fakeDb([month(1)], { select: "timeout" }).db, USER)).toBe(false);
    expect(await giveBackAstraEdit(fakeDb([month(1)], { delete: "permission denied" }).db, USER)).toBe(false);
    expect(await giveBackAstraEdit(fakeDb([month(1)], { throws: true }).db, USER)).toBe(false);
    expect(warned).toHaveLength(3);
    expect(warned[1]).toContain("permission denied");
  });
});
