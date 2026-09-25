import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  pruneRateHits,
  RATE_HITS_KEEP_DAYS,
  RATE_HITS_LONGEST_WINDOW_SECONDS,
  RATE_HITS_PRUNE_BATCH,
  RATE_HITS_PRUNE_MAX_BATCHES,
  removeUserRateHits,
} from "./rate-hits";

// The limiter's rows, kept no longer than they are needed (2026-09-16). The
// limiter pruned only the bucket it was asked about, so a feature a person
// never used again kept their rows for good, and deleting an account left
// every one of its rows behind (the table has no foreign key).

type Row = { id: number; user_id: string; created_at: string };
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-16T12:00:00.000Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

/**
 * api_rate_hits as PostgREST answers it, for the calls these sweeps make.
 *
 * Rows are held in id order, as the table's key keeps them, and a statement
 * walks them from the lowest id: the select stops at its first match, the
 * delete where its id bound ends. Every filter is still applied to every row
 * walked; the walk only skips rows the id bound already refuses. A full scan
 * per statement made the batch test (210,000 rows, 85 statements) take ~2 s
 * in a full run and time out at 5 s when the machine was busy (2026-09-22).
 */
function fakeTable(rows: Row[], fail: { select?: string; delete?: string; throws?: boolean } = {}) {
  expect(rows.every((r, i) => i === 0 || r.id > rows[i - 1].id), "rows in id order").toBe(true);
  const statements: string[] = [];
  const client = {
    from(table: string) {
      expect(table).toBe("api_rate_hits");
      if (fail.throws) throw new Error("network down");
      const filters: ((r: Row) => boolean)[] = [];
      let idBelow = Infinity;
      let limit = Infinity;
      let mode: "select" | "delete" = "select";
      let counted = false;
      const matches = (r: Row) => filters.every((f) => f(r));
      const run = () => {
        if (mode === "select") {
          statements.push("select");
          if (fail.select) return { data: null, error: { message: fail.select } };
          // The sweep asks for the one oldest id.
          expect(limit).toBe(1);
          const oldest = rows.find(matches);
          return { data: oldest ? [{ id: oldest.id }] : [], error: null };
        }
        statements.push("delete");
        if (fail.delete) return { error: { message: fail.delete }, count: null };
        // Removed in place, order kept.
        let kept = 0;
        let walked = 0;
        for (; walked < rows.length && rows[walked].id < idBelow; walked++) if (!matches(rows[walked])) rows[kept++] = rows[walked];
        const removed = walked - kept;
        rows.splice(kept, removed);
        return { error: null, count: counted ? removed : null };
      };
      const builder = {
        select: (columns: string) => {
          expect(columns).toBe("id");
          return builder;
        },
        delete: (opts?: { count?: string }) => {
          mode = "delete";
          counted = opts?.count === "exact";
          return builder;
        },
        eq: (column: keyof Row, value: string) => {
          filters.push((r) => r[column] === value);
          return builder;
        },
        lt: (column: keyof Row, value: string | number) => {
          filters.push((r) => r[column] < value);
          if (column === "id") idBelow = Math.min(idBelow, Number(value));
          return builder;
        },
        order: (column: string, opts: { ascending: boolean }) => {
          expect([column, opts.ascending]).toEqual(["id", true]);
          return builder;
        },
        limit: (n: number) => {
          limit = n;
          return builder;
        },
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, statements };
}

let warned: string[];
beforeEach(() => {
  warned = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => void warned.push(args.join(" ")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("removeUserRateHits", () => {
  it("removes every row of the deleted account, and nobody else's", async () => {
    const rows: Row[] = [
      { id: 1, user_id: "gone", created_at: ago(1) },
      { id: 2, user_id: "stays", created_at: ago(1) },
      { id: 3, user_id: "gone", created_at: ago(90) },
    ];
    await removeUserRateHits(fakeTable(rows).client, "gone");
    expect(rows.map((r) => r.id)).toEqual([2]);
  });

  it("never throws, and says when it could not", async () => {
    await expect(removeUserRateHits(fakeTable([], { delete: "permission denied" }).client, "gone")).resolves.toBeUndefined();
    await expect(removeUserRateHits(fakeTable([], { throws: true }).client, "gone")).resolves.toBeUndefined();
    expect(warned).toHaveLength(2);
    expect(warned[0]).toContain("permission denied");
  });
});

describe("pruneRateHits", () => {
  it("removes what is older than the keep, oldest first, and nothing younger", async () => {
    const rows: Row[] = [
      { id: 1, user_id: "a", created_at: ago(400) },
      { id: 2, user_id: "b", created_at: ago(RATE_HITS_KEEP_DAYS + 0.01) },
      // Ids and times can cross by a moment (concurrent inserts): a younger row with a lower id stays.
      { id: 3, user_id: "c", created_at: ago(RATE_HITS_KEEP_DAYS - 0.01) },
      { id: 4, user_id: "d", created_at: ago(RATE_HITS_KEEP_DAYS + 0.02) },
      { id: 5, user_id: "e", created_at: ago(0) },
    ];
    const { client } = fakeTable(rows);
    expect(await pruneRateHits(client, NOW)).toEqual({ removed: 3, done: true, error: null });
    expect(rows.map((r) => r.id)).toEqual([3, 5]);
  });

  it("works a batch of ids at a time, and leaves the rest to the next run", async () => {
    const total = RATE_HITS_PRUNE_BATCH * (RATE_HITS_PRUNE_MAX_BATCHES + 2);
    const old = ago(100);
    const rows: Row[] = Array.from({ length: total }, (_, i) => ({ id: i + 1, user_id: "a", created_at: old }));
    const { client, statements } = fakeTable(rows);
    const first = await pruneRateHits(client, NOW);
    expect(first).toEqual({ removed: RATE_HITS_PRUNE_BATCH * RATE_HITS_PRUNE_MAX_BATCHES, done: false, error: null });
    expect(statements.filter((s) => s === "delete")).toHaveLength(RATE_HITS_PRUNE_MAX_BATCHES);
    expect(await pruneRateHits(client, NOW)).toEqual({ removed: RATE_HITS_PRUNE_BATCH * 2, done: true, error: null });
    expect(rows).toEqual([]);
  });

  it("stops at the first error, saying what it removed, and never throws", async () => {
    const rows: Row[] = [{ id: 1, user_id: "a", created_at: ago(100) }];
    expect(await pruneRateHits(fakeTable(rows, { select: "timeout" }).client, NOW)).toEqual({ removed: 0, done: false, error: "timeout" });
    expect(await pruneRateHits(fakeTable(rows, { delete: "timeout" }).client, NOW)).toEqual({ removed: 0, done: false, error: "timeout" });
    expect(await pruneRateHits(fakeTable(rows, { throws: true }).client, NOW)).toEqual({ removed: 0, done: false, error: "network down" });
    expect(rows).toHaveLength(1);
  });

  it("keeps twice the longest window any limiter counts over", () => {
    expect(RATE_HITS_KEEP_DAYS * 24 * 60 * 60).toBeGreaterThanOrEqual(2 * RATE_HITS_LONGEST_WINDOW_SECONDS);
  });
});

// Every call of the limiter, and the window it counts over: a window longer
// than RATE_HITS_LONGEST_WINDOW_SECONDS would count rows the daily prune
// has already taken, so a new long window has to be decided here.
describe("every limiter's window", () => {
  const root = join(__dirname, "..");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p);
    }
  };
  walk(root);

  /** The call's arguments, split at the top level. */
  const argsAt = (source: string, open: number): string[] => {
    const args: string[] = [];
    let depth = 0;
    let start = open + 1;
    for (let i = open; i < source.length; i++) {
      const c = source[i];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") {
        depth--;
        if (depth === 0) {
          args.push(source.slice(start, i));
          return args.map((a) => a.trim()).filter(Boolean);
        }
      } else if (c === "," && depth === 1) {
        args.push(source.slice(start, i));
        start = i + 1;
      }
    }
    throw new Error("unclosed call");
  };

  /** Seconds, "monthly" for the month of Astra changes, or null for a window this scan cannot read. */
  const seconds = (file: string, source: string, expr: string): number | "monthly" | null => {
    if (/^\d+(\s*\*\s*\d+)*$/.test(expr)) return expr.split("*").reduce((n, x) => n * Number(x.trim()), 1);
    if (/^[A-Z][A-Z0-9_]*$/.test(expr)) {
      const def = source.match(new RegExp(`const ${expr}\\s*=\\s*([^;]+);`));
      return def ? seconds(file, source, def[1].trim()) : null;
    }
    if (expr === "windowSeconds" && file.endsWith(join("sets", "editor-actions.ts"))) return "monthly";
    return null;
  };

  it("is at most the longest window the prune keeps for", () => {
    const calls: { where: string; window: number | "monthly" | null }[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!/import \{[^}]*\brateLimited\b[^}]*\} from "@\/lib\/rate-limit"/.test(source)) continue;
      for (const m of source.matchAll(/\brateLimited\(/g)) {
        const at = m.index ?? 0;
        const args = argsAt(source, at + "rateLimited".length);
        calls.push({ where: `${file.slice(root.length + 1)}:${source.slice(0, at).split("\n").length}`, window: seconds(file, source, args[2]) });
      }
    }
    expect(calls.length).toBeGreaterThan(30);
    expect(calls.filter((c) => c.window === null).map((c) => c.where)).toEqual([]);
    expect(calls.filter((c) => typeof c.window === "number" && c.window > RATE_HITS_LONGEST_WINDOW_SECONDS).map((c) => c.where)).toEqual([]);
    // The month's Astra changes and the month's Astra tries (2026-09-25), both from monthlyWindowStart.
    expect(calls.filter((c) => c.window === "monthly")).toHaveLength(2);
  });

  it("counts the month of Astra changes from the billing month's start, no further back", () => {
    const edits = readFileSync(join(root, "lib", "sets", "editor-actions.ts"), "utf8");
    expect(edits).toContain("const since = monthlyWindowStart(access.periodStart).getTime();");
    expect(edits).toContain("const windowSeconds = Math.max(1, Math.ceil((new Date().getTime() - since) / 1000));");
    // The page's count of the same rows reads the same window.
    expect(readFileSync(join(root, "lib", "sets", "data.ts"), "utf8")).toContain("monthlyWindowStart(periodStart)");
  });
});

describe("the sweeps are wired", () => {
  const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");

  it("removes a deleted account's rows on both deletion paths, once the account is gone", () => {
    for (const [file, gone] of [
      ["src/lib/profile/actions.ts", "const { error } = await admin.auth.admin.deleteUser(userId);"],
      ["src/lib/admin/actions.ts", "const { error } = await admin.auth.admin.deleteUser(userId);"],
    ]) {
      const source = read(file);
      const deleted = source.indexOf(gone);
      const swept = source.indexOf("await removeUserRateHits(admin, userId);");
      expect(deleted, file).toBeGreaterThan(-1);
      expect(swept, file).toBeGreaterThan(deleted);
      // After the failure check that stops a deletion that did not happen.
      expect(source.slice(deleted, swept), file).toMatch(/if \(error\) \{[\s\S]*?redirect\(/);
    }
  });

  it("runs the prune daily, behind the cron secret", () => {
    const crons = (JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] }).crons;
    const prune = crons.find((c) => c.path === "/api/cron/prune");
    expect(prune?.schedule).toMatch(/^\d+ \d+ \* \* \*$/);
    const route = read("src/app/api/cron/prune/route.ts");
    expect(route).toContain('if (!secret || auth !== `Bearer ${secret}`) {');
    expect(route.indexOf("return NextResponse.json({ error: \"unauthorized\" }, { status: 401 });")).toBeLessThan(route.indexOf("pruneRateHits("));
  });
});
