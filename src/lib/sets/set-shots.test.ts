import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normaliseSetFilm } from "./film";
import { SET_SHOTS_LIMIT } from "./set-config";
import { readSetShotIds } from "./set-shots";

// Which shots a set's page loads (2026-09-16): an older film kept its clip
// ids but lost its reel, because the page loaded only the newest shots. The
// film's own shots are loaded however old — and only when they really are
// this set's shots, whatever the saved film says.

vi.spyOn(console, "warn").mockImplementation(() => {});

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "99999999-9999-4999-8999-999999999999";
const SET = "22222222-2222-4222-8222-222222222222";
const OTHER_SET = "88888888-8888-4888-8888-888888888888";
const gid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Row = { set_id: string; generation_id: string; user_id: string; created_at: string };

/** location_set_shots as PostgREST would answer it: eq and in filter, order sorts, limit cuts. */
function fakeDb(rows: Row[], failPinned = false) {
  const reads: { filters: [string, string, unknown][]; limit: number | null }[] = [];
  const db = {
    from: (table: string) => {
      expect(table).toBe("location_set_shots");
      const read = { filters: [] as [string, string, unknown][], limit: null as number | null, desc: false };
      reads.push(read);
      const builder = {
        select: () => builder,
        eq: (col: string, v: unknown) => (read.filters.push([col, "eq", v]), builder),
        in: (col: string, v: unknown) => (read.filters.push([col, "in", v]), builder),
        order: (_col: string, o: { ascending: boolean }) => ((read.desc = !o.ascending), builder),
        limit: (n: number) => ((read.limit = n), builder),
        then: (resolve: (v: unknown) => void) => {
          const pinned = read.filters.some(([, op]) => op === "in");
          if (pinned && failPinned) return resolve({ data: null, error: { message: "boom" } });
          let out = rows.filter((r) =>
            read.filters.every(([col, op, v]) =>
              op === "eq" ? r[col as keyof Row] === v : (v as string[]).includes(r[col as keyof Row]),
            ),
          );
          out = [...out].sort((a, b) => (read.desc ? b.created_at.localeCompare(a.created_at) : a.created_at.localeCompare(b.created_at)));
          if (read.limit !== null) out = out.slice(0, read.limit);
          resolve({ data: out.map((r) => ({ generation_id: r.generation_id, created_at: r.created_at })), error: null });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { db, reads };
}

/** `count` shots in this set, shot n at minute n (so the highest n is the newest). */
const shotsOf = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({
    set_id: SET,
    generation_id: gid(i + 1),
    user_id: USER,
    created_at: new Date(Date.UTC(2026, 8, 1, 0, i + 1)).toISOString(),
  }));

const filmOf = (startId: string | null, clips: (string | null)[]) =>
  normaliseSetFilm({ startId, beats: clips.map(() => ({ end: { position: [1, 2, 3], target: [0, 1, 0], fovDeg: 40 } })), clips });

describe("readSetShotIds", () => {
  it("reads the newest shots, newest first, and nothing more when the film is among them or there is none", async () => {
    const rows = shotsOf(3);
    const none = fakeDb(rows);
    expect(await readSetShotIds(none.db, SET, USER, null)).toEqual([gid(3), gid(2), gid(1)]);
    expect(none.reads).toHaveLength(1);
    const inside = fakeDb(rows);
    expect(await readSetShotIds(inside.db, SET, USER, filmOf(gid(1), [gid(2), gid(3)]))).toEqual([gid(3), gid(2), gid(1)]);
    expect(inside.reads).toHaveLength(1);
  });

  it("loads an older film's opening still and clips after the newest shots", async () => {
    const rows = shotsOf(SET_SHOTS_LIMIT + 10);
    const f = fakeDb(rows);
    const ids = await readSetShotIds(f.db, SET, USER, filmOf(gid(1), [gid(3), gid(2)]));
    expect(ids).toHaveLength(SET_SHOTS_LIMIT + 3);
    expect(ids[0]).toBe(gid(SET_SHOTS_LIMIT + 10));
    // After the newest, newest first among themselves.
    expect(ids.slice(SET_SHOTS_LIMIT)).toEqual([gid(3), gid(2), gid(1)]);
    // Asked only for what the newest did not already hold.
    expect(f.reads[1].filters).toContainEqual(["generation_id", "in", [gid(1), gid(3), gid(2)]]);
  });

  it("reads the film's shots through this set and this person only: a saved id that is not theirs names nothing", async () => {
    const rows: Row[] = [
      ...shotsOf(SET_SHOTS_LIMIT + 2),
      { set_id: OTHER_SET, generation_id: gid(900), user_id: USER, created_at: "2026-08-01T00:00:00.000Z" },
      { set_id: SET, generation_id: gid(901), user_id: OTHER_USER, created_at: "2026-08-01T00:00:00.000Z" },
    ];
    const f = fakeDb(rows);
    const ids = await readSetShotIds(f.db, SET, USER, filmOf(gid(1), [gid(900), gid(901)]));
    expect(ids).not.toContain(gid(900));
    expect(ids).not.toContain(gid(901));
    expect(ids.at(-1)).toBe(gid(1));
    expect(f.reads[1].filters).toEqual(
      expect.arrayContaining([
        ["set_id", "eq", SET],
        ["user_id", "eq", USER],
      ]),
    );
  });

  it("opens with the newest shots when the film's read fails", async () => {
    const rows = shotsOf(SET_SHOTS_LIMIT + 2);
    const f = fakeDb(rows, true);
    const ids = await readSetShotIds(f.db, SET, USER, filmOf(gid(1), [gid(2)]));
    expect(ids).toHaveLength(SET_SHOTS_LIMIT);
  });
});
