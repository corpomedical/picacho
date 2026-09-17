import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseRecceRead, RECCE_FRAME_COUNT, sampleTimes } from "./recce-read";
import { recceColumns, readSetRecce } from "./recce-store";

// The Recce's stored read (board K cut 1, 2026-09-17): written with the
// reserve, read back fail-open, and — the promise the SQL-first order rests
// on — the column named nowhere else in src/.

const USER = "11111111-1111-4111-8111-111111111111";
const SET = "22222222-2222-4222-8222-222222222222";

const read = parseRecceRead(
  JSON.stringify({
    shots: [{ from_s: 0, to_s: 10, place: "A ballroom.", camera: { height: "eye", size: "wide", words: "Follows." } }],
    person: { who: "someone", pose: "walk", start: { x: 0, z: 4 }, end: { x: 1, z: 12 } },
    light: "Warm.",
    place_frame: 0,
    confidence: "high",
  }),
  RECCE_FRAME_COUNT,
  10,
)!;

function fakeDb(result: { data: unknown; error: { code?: string; message: string } | null }): SupabaseClient {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    maybeSingle: async () => result,
  };
  return { from: () => chain } as unknown as SupabaseClient;
}

describe("recceColumns", () => {
  it("writes the versioned read beside the reserve", () => {
    const times = sampleTimes(10, RECCE_FRAME_COUNT);
    const cols = recceColumns(read, 10, times);
    expect(cols.recce_read.v).toBe(1);
    expect(cols.recce_read.seconds).toBe(10);
    expect(cols.recce_read.times).toEqual(times);
    expect(cols.recce_read.read.shots[0].place).toBe("A ballroom.");
  });
});

describe("readSetRecce", () => {
  it("hands back a stored read", async () => {
    const stored = recceColumns(read, 10, sampleTimes(10, 12)).recce_read;
    const got = await readSetRecce(fakeDb({ data: { recce_read: stored }, error: null }), SET, USER);
    expect(got?.read.person?.end.z).toBe(12);
  });

  it("reads every failure as no read", async () => {
    expect(await readSetRecce(fakeDb({ data: null, error: { code: "42703", message: "no column" } }), SET, USER)).toBeNull();
    expect(await readSetRecce(fakeDb({ data: { recce_read: null }, error: null }), SET, USER)).toBeNull();
    expect(await readSetRecce(fakeDb({ data: { recce_read: { v: 2 } }, error: null }), SET, USER)).toBeNull();
    expect(await readSetRecce(fakeDb({ data: { recce_read: "text" }, error: null }), SET, USER)).toBeNull();
  });

  it("names the recce column nowhere in src/ but recce-store.ts (and tests)", () => {
    // No other query can then name a column that may not exist: the list,
    // the set page, the poll and the delete all stay as they were.
    const SRC = join(__dirname, "..", "..");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) return walk(p);
        return /\.(ts|tsx)$/.test(name) ? [p] : [];
      });
    const offenders = walk(SRC)
      .filter((f) => !f.endsWith(join("sets", "recce-store.ts")) && !/\.test\.tsx?$/.test(f))
      .filter((f) => readFileSync(f, "utf8").includes("recce_read"))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
