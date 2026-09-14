import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readShotWords, recordShotWords, SHOT_WORDS_STORED_MAX_CHARS } from "./shot-words-store";

// The person's words with each Set shot (Astra chat, 2026-09-14). Until
// set-shot-words.sql runs, the column does not exist and PostgREST fails
// any statement that names it — so shots must work exactly as before, and
// every read of it must come back as "no words", never as a failure.

vi.spyOn(console, "warn").mockImplementation(() => {});

const USER = "11111111-1111-4111-8111-111111111111";
const SET = "22222222-2222-4222-8222-222222222222";
const G1 = "33333333-3333-4333-8333-333333333333";
const G2 = "44444444-4444-4444-8444-444444444444";
const SHOT = { setId: SET, generationId: G1, userId: USER };

/** A PostgREST stand-in: every filter returns the builder and is recorded; awaiting it returns the answer. */
function fakeDb(answer: () => Promise<{ data: unknown; error: { code?: string; message: string } | null }>) {
  const calls: { m: string; args: unknown[] }[] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "update"]) {
    builder[m] = (...args: unknown[]) => (calls.push({ m, args }), builder);
  }
  builder.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => answer().then(resolve, reject);
  const db = { from: (t: string) => (calls.push({ m: "from", args: [t] }), builder) } as unknown as SupabaseClient;
  return { db, calls };
}

describe("recordShotWords", () => {
  it("writes the words onto the shot's own row, in an update of its own, trimmed and cut to what the column keeps", async () => {
    const f = fakeDb(async () => ({ data: [{ generation_id: G1 }], error: null }));
    expect(await recordShotWords(f.db, SHOT, "  from behind, 50 mm  ")).toBe(true);
    expect(f.calls).toEqual([
      { m: "from", args: ["location_set_shots"] },
      { m: "update", args: [{ words: "from behind, 50 mm" }] },
      { m: "eq", args: ["set_id", SET] },
      { m: "eq", args: ["generation_id", G1] },
      { m: "eq", args: ["user_id", USER] },
      { m: "select", args: ["generation_id"] },
    ]);
    const long = fakeDb(async () => ({ data: [{ generation_id: G1 }], error: null }));
    await recordShotWords(long.db, SHOT, "x".repeat(SHOT_WORDS_STORED_MAX_CHARS + 50));
    expect((long.calls[1].args[0] as { words: string }).words.length).toBe(SHOT_WORDS_STORED_MAX_CHARS);
  });

  it("writes nothing for empty words", async () => {
    const f = fakeDb(async () => {
      throw new Error("not called");
    });
    expect(await recordShotWords(f.db, SHOT, "   ")).toBe(false);
    expect(f.calls).toEqual([]);
  });

  it("before set-shot-words.sql, or on any failure, says false and never throws", async () => {
    const missing = fakeDb(async () => ({ data: null, error: { code: "PGRST204", message: "Could not find the 'words' column" } }));
    expect(await recordShotWords(missing.db, SHOT, "shoot")).toBe(false);
    const none = fakeDb(async () => ({ data: [], error: null }));
    expect(await recordShotWords(none.db, SHOT, "shoot")).toBe(false);
    const throws = fakeDb(async () => {
      throw new Error("network");
    });
    expect(await recordShotWords(throws.db, SHOT, "shoot")).toBe(false);
  });
});

describe("readShotWords", () => {
  it("reads the set's own shots' words, keeping only real text", async () => {
    const f = fakeDb(async () => ({
      data: [
        { generation_id: G1, words: "from behind" },
        { generation_id: G2, words: null },
        { generation_id: "55555555-5555-4555-8555-555555555555", words: "   " },
        { generation_id: 42, words: "shoot" },
      ],
      error: null,
    }));
    const got = await readShotWords(f.db, SET, USER, [G1, G2]);
    expect([...got.entries()]).toEqual([[G1, "from behind"]]);
    expect(f.calls).toContainEqual({ m: "select", args: ["generation_id, words"] });
    expect(f.calls).toContainEqual({ m: "eq", args: ["set_id", SET] });
    expect(f.calls).toContainEqual({ m: "eq", args: ["user_id", USER] });
    expect(f.calls).toContainEqual({ m: "in", args: ["generation_id", [G1, G2]] });
  });

  it("fails open: the column missing, any other failure, or a throw is no words at all", async () => {
    for (const error of [
      { code: "42703", message: "column location_set_shots.words does not exist" },
      { code: "PGRST000", message: "Could not connect with the database" },
    ]) {
      expect((await readShotWords(fakeDb(async () => ({ data: null, error })).db, SET, USER)).size).toBe(0);
    }
    const throws = fakeDb(async () => {
      throw new Error("network");
    });
    expect((await readShotWords(throws.db, SET, USER, [G1])).size).toBe(0);
  });

  it("asks nothing for no shots", async () => {
    const f = fakeDb(async () => {
      throw new Error("not called");
    });
    expect((await readShotWords(f.db, SET, USER, [])).size).toBe(0);
    expect(f.calls).toEqual([]);
  });
});

describe("no other query names the column", () => {
  const SRC = join(__dirname, "..", "..");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return walk(p);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
    });

  it("every other statement on location_set_shots names only the columns every version has", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (file.endsWith(join("sets", "shot-words-store.ts"))) continue;
      const source = readFileSync(file, "utf8");
      for (const m of source.matchAll(/\.from\(\s*["']location_set_shots["']\s*\)/g)) {
        const rest = source.slice(m.index ?? 0);
        const end = rest.search(/;|\n\s*\n/);
        const statement = rest.slice(0, end < 0 ? undefined : end);
        if (/\bwords\b/.test(statement)) offenders.push(`${relative(SRC, file)}: ${statement.slice(0, 120)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
