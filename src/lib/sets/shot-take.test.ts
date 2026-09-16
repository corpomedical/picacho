import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normaliseShotTake, readShotTakes, recordShotTake, takeSourceOf, type ShotTake } from "./shot-take";

// A take keeps what it was rendered from (2026-09-16), so a clip that failed
// on an earlier visit can be rendered again between the same two stills.
// Until helios-take-frames.sql runs the column does not exist — so only
// shot-take.ts may name it, each time in a statement of its own whose
// failure is ignored.

vi.spyOn(console, "warn").mockImplementation(() => {});

const START = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const END = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PERSON = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SET = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const TAKE = "33333333-3333-4333-8333-333333333333";

const kept: ShotTake = { start: START, end: END, engine: "veo", direction: "She turns to the door.", film: false };

describe("normaliseShotTake", () => {
  it("keeps two still ids, a known engine, a clean direction and the film mark", () => {
    expect(
      normaliseShotTake({ start: START.toUpperCase(), end: END, engine: "omni", direction: "  She   turns.\u0000 ", film: true, extra: 1 }),
    ).toEqual({ start: START, end: END, engine: "omni", direction: "She turns.", film: true });
    // The film mark is true only when it says so.
    expect(normaliseShotTake({ ...kept, film: "yes" })?.film).toBe(false);
    // A direction is held to the shot's own length, and may be empty.
    expect(normaliseShotTake({ ...kept, direction: "x".repeat(400) })?.direction).toHaveLength(300);
    expect(normaliseShotTake({ ...kept, direction: 7 })?.direction).toBe("");
  });

  it("keeps nothing without both stills or with an engine a take does not have", () => {
    expect(normaliseShotTake({ ...kept, start: "not-an-id" })).toBeNull();
    expect(normaliseShotTake({ ...kept, end: undefined })).toBeNull();
    expect(normaliseShotTake({ ...kept, engine: "kling" })).toBeNull();
    for (const junk of [null, 7, "take", [kept]]) expect(normaliseShotTake(junk)).toBeNull();
  });
});

describe("takeSourceOf", () => {
  const finished = new Set([START, END]);
  const canShoot = (id: string) => id === PERSON;

  it("offers a take of its own between two finished stills, with its person", () => {
    expect(takeSourceOf(kept, PERSON, canShoot, finished)).toEqual({
      start: START,
      end: END,
      characterId: PERSON,
      direction: "She turns to the door.",
      engine: "veo",
    });
  });

  it("offers nothing for a film's beat, a still that is gone, or a person who cannot be shot", () => {
    expect(takeSourceOf(undefined, PERSON, canShoot, finished)).toBeNull();
    expect(takeSourceOf({ ...kept, film: true }, PERSON, canShoot, finished)).toBeNull();
    expect(takeSourceOf(kept, PERSON, canShoot, new Set([START]))).toBeNull();
    expect(takeSourceOf(kept, PERSON, canShoot, new Set([END]))).toBeNull();
    // A person deleted (the row's id set to null) or left without a photo.
    expect(takeSourceOf(kept, null, canShoot, finished)).toBeNull();
    expect(takeSourceOf(kept, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", canShoot, finished)).toBeNull();
  });
});

/** A service-role client whose update answers as told, recording what was asked. */
function fakeAdmin(answer: { data?: unknown; error?: { message: string } | null; throws?: boolean }) {
  const calls: { table: string; values: unknown; filters: [string, unknown][] }[] = [];
  const admin = {
    from: (table: string) => {
      const call = { table, values: undefined as unknown, filters: [] as [string, unknown][] };
      calls.push(call);
      const builder = {
        update: (values: unknown) => ((call.values = values), builder),
        eq: (col: string, v: unknown) => (call.filters.push([col, v]), builder),
        select: () => {
          if (answer.throws) throw new Error("network down");
          return Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { admin, calls };
}

describe("recordShotTake", () => {
  const key = { setId: SET, generationId: TAKE, userId: USER };

  it("writes the take, cleaned, onto its own row only", async () => {
    const { admin, calls } = fakeAdmin({ data: [{ generation_id: TAKE }] });
    expect(await recordShotTake(admin, key, { ...kept, direction: "  She turns  to the door. " })).toBe(true);
    expect(calls).toEqual([
      {
        table: "location_set_shots",
        values: { take: kept },
        filters: [
          ["set_id", SET],
          ["generation_id", TAKE],
          ["user_id", USER],
        ],
      },
    ]);
  });

  it("says false — and never throws — before the column exists, when no row matched, or when the call fails", async () => {
    const missing = fakeAdmin({ error: { message: 'column "take" of relation "location_set_shots" does not exist' } });
    expect(await recordShotTake(missing.admin, key, kept)).toBe(false);
    expect(await recordShotTake(fakeAdmin({ data: [] }).admin, key, kept)).toBe(false);
    expect(await recordShotTake(fakeAdmin({ throws: true }).admin, key, kept)).toBe(false);
  });

  it("writes nothing that would not read back", async () => {
    const { admin, calls } = fakeAdmin({ data: [{ generation_id: TAKE }] });
    expect(await recordShotTake(admin, key, { ...kept, end: "" })).toBe(false);
    expect(calls).toEqual([]);
  });
});

/** location_set_shots for a read: the rows given, or the error given. */
function fakeReader(rows: Record<string, unknown>[], error: { message: string } | null = null) {
  const reads: { select: string; filters: [string, string, unknown][] }[] = [];
  const db = {
    from: (table: string) => {
      expect(table).toBe("location_set_shots");
      const read = { select: "", filters: [] as [string, string, unknown][] };
      reads.push(read);
      const builder = {
        select: (cols: string) => ((read.select = cols), builder),
        eq: (col: string, v: unknown) => (read.filters.push([col, "eq", v]), builder),
        in: (col: string, v: unknown) => (read.filters.push([col, "in", v]), builder),
        then: (resolve: (v: unknown) => void) => resolve(error ? { data: null, error } : { data: rows, error: null }),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { db, reads };
}

describe("readShotTakes", () => {
  it("reads the named takes of this set, through the one door", async () => {
    const { db, reads } = fakeReader([
      { generation_id: TAKE, take: kept },
      { generation_id: "44444444-4444-4444-8444-444444444444", take: { ...kept, engine: "sora" } },
      { generation_id: "55555555-5555-4555-8555-555555555555", take: null },
    ]);
    const takes = await readShotTakes(db, SET, USER, [TAKE]);
    expect([...takes.entries()]).toEqual([[TAKE, kept]]);
    expect(reads).toEqual([
      {
        select: "generation_id, take",
        filters: [
          ["set_id", "eq", SET],
          ["user_id", "eq", USER],
          ["generation_id", "in", [TAKE]],
        ],
      },
    ]);
  });

  it("asks nothing for no takes, and reads a failure — the column missing — as nothing kept", async () => {
    const none = fakeReader([{ generation_id: TAKE, take: kept }]);
    expect((await readShotTakes(none.db, SET, USER, [])).size).toBe(0);
    expect(none.reads).toEqual([]);
    const missing = fakeReader([], { message: "column location_set_shots.take does not exist" });
    expect((await readShotTakes(missing.db, SET, USER, [TAKE])).size).toBe(0);
  });
});

describe("the column is named in one place", () => {
  // Whatever else names it in a statement — a select list, or a write's
  // values — fails that whole statement until the SQL has run.
  const namesTheColumn = (text: string) =>
    /\.select\(\s*["'`][^"'`]*\btake\b[^"'`]*["'`]/.test(text) || /\.(update|insert|upsert)\(\s*\{([^}]*,)?\s*take\s*[:,}]/.test(text);

  it("is caught wherever a statement names it", () => {
    expect(namesTheColumn('.select("generation_id, take")')).toBe(true);
    expect(namesTheColumn(".update({ take: kept })")).toBe(true);
    expect(namesTheColumn(".insert({ set_id: setId, take })")).toBe(true);
    expect(namesTheColumn(".insert({ set_id: setId, take: t })")).toBe(true);
    expect(namesTheColumn('.insert({ kind: "take", status: take })')).toBe(false);
    expect(namesTheColumn('kind: "take"')).toBe(false);
  });

  it("only shot-take.ts names location_set_shots.take, and only through its constant", () => {
    const root = join(__dirname, "../..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") && namesTheColumn(readFileSync(p, "utf8"))) hits.push(p);
      }
    };
    walk(root);
    expect(hits.map((p) => p.slice(root.length + 1))).toEqual([]);
    const own = readFileSync(join(__dirname, "shot-take.ts"), "utf8");
    expect(own).toContain('const COLUMN = "take";');
    expect(own).toContain(".update({ [COLUMN]: kept })");
    expect(own).toContain(".select(`generation_id, ${COLUMN}`)");
  });
});
