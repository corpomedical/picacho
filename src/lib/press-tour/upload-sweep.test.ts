import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  PRESS_UPLOADS_BUCKET,
  STAGED_UPLOAD_MAX_AGE_SECONDS,
  SWEEP_BATCH,
  SWEEP_MAX_BATCHES,
  isStagedUploadPath,
  sweepStaleUploads,
} from "./upload-sweep";

// The staged uploads nobody read, removed (review SEC-3). Against a fake
// service-role client: press_stale_uploads lists names oldest first (as the
// SQL does), and the Storage API's remove() takes them away.

const A = "11111111-1111-4111-8111-111111111111";
const staged = (n: number, user = A) => `${user}/uploads/dddddddd-0000-4000-8000-${String(n).padStart(12, "0")}/${n % 10}`;

function fakeAdmin(names: { name: string; createdAt: string }[], opts: { listError?: string; removeError?: string; rowShape?: boolean } = {}) {
  // Kept oldest first, as the SQL orders them; removal is one pass per call
  // (the flood below is 21,000 names).
  const store = [...names].sort((x, y) => x.createdAt.localeCompare(y.createdAt));
  const calls = { lists: [] as { before: string; limit: number }[], removed: [] as string[][], buckets: [] as string[] };
  const admin = {
    async rpc(fn: string, args: { p_before: string; p_limit: number }) {
      if (fn !== "press_stale_uploads") throw new Error(`unexpected rpc ${fn}`);
      calls.lists.push({ before: args.p_before, limit: args.p_limit });
      if (opts.listError) return { data: null, error: { message: opts.listError } };
      const rows: unknown[] = [];
      for (const o of store) {
        if (rows.length >= args.p_limit) break;
        if (o.createdAt < args.p_before) rows.push(opts.rowShape ? { press_stale_uploads: o.name } : o.name);
      }
      return { data: rows, error: null };
    },
    storage: {
      from(bucket: string) {
        return {
          async remove(paths: string[]) {
            calls.buckets.push(bucket);
            if (opts.removeError) return { data: null, error: { message: opts.removeError } };
            calls.removed.push(paths);
            const gone = new Set(paths);
            const kept = store.filter((o) => !gone.has(o.name));
            store.splice(0, store.length, ...kept);
            return { data: [], error: null };
          },
        };
      },
    },
  };
  return { admin: admin as unknown as SupabaseClient, store, calls };
}

const NOW = new Date("2026-09-26T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

describe("sweepStaleUploads", () => {
  it("removes the staged files older than the token's two hours plus a margin, and keeps younger ones", async () => {
    expect(STAGED_UPLOAD_MAX_AGE_SECONDS).toBeGreaterThan(2 * 60 * 60);
    const { admin, store, calls } = fakeAdmin([
      { name: staged(1), createdAt: hoursAgo(26) },
      { name: staged(2), createdAt: hoursAgo(3.5) },
      { name: staged(3), createdAt: hoursAgo(2.5) },
      { name: staged(4), createdAt: hoursAgo(0.1) },
    ]);
    expect(await sweepStaleUploads(admin, NOW)).toEqual({ removed: 2, done: true, error: null });
    expect(store.map((o) => o.name)).toEqual([staged(3), staged(4)]);
    expect(calls.lists[0]).toEqual({ before: hoursAgo(3), limit: SWEEP_BATCH });
    expect(new Set(calls.buckets)).toEqual(new Set([PRESS_UPLOADS_BUCKET]));
  });

  it("works through a backlog a batch at a time, and stops at its ceiling", async () => {
    const many = Array.from({ length: SWEEP_BATCH * 2 + 5 }, (_, i) => ({ name: staged(i), createdAt: hoursAgo(10 + i / 10_000) }));
    const { admin, store, calls } = fakeAdmin(many);
    expect(await sweepStaleUploads(admin, NOW)).toEqual({ removed: many.length, done: true, error: null });
    expect(store).toHaveLength(0);
    expect(calls.removed.map((b) => b.length)).toEqual([SWEEP_BATCH, SWEEP_BATCH, 5]);

    const flood = Array.from({ length: SWEEP_BATCH * (SWEEP_MAX_BATCHES + 1) }, (_, i) => ({ name: staged(i), createdAt: hoursAgo(10) }));
    const f = fakeAdmin(flood);
    expect(await sweepStaleUploads(f.admin, NOW)).toEqual({ removed: SWEEP_BATCH * SWEEP_MAX_BATCHES, done: false, error: null });
  });

  it("removes only paths of the staging shape", async () => {
    const { admin, calls } = fakeAdmin([
      { name: staged(1), createdAt: hoursAgo(5) },
      { name: `${A}/products/p/photo.jpg`, createdAt: hoursAgo(5) },
      { name: `../${A}/uploads/x/0`, createdAt: hoursAgo(5) },
    ]);
    expect(await sweepStaleUploads(admin, NOW)).toMatchObject({ removed: 1, error: null });
    expect(calls.removed).toEqual([[staged(1)]]);
    expect(isStagedUploadPath(staged(7))).toBe(true);
    expect(isStagedUploadPath(`${A}/uploads/not-a-batch/0`)).toBe(false);
    expect(isStagedUploadPath(null)).toBe(false);
  });

  it("reads the one-column row shape too", async () => {
    const { admin, store } = fakeAdmin([{ name: staged(1), createdAt: hoursAgo(5) }], { rowShape: true });
    expect(await sweepStaleUploads(admin, NOW)).toMatchObject({ removed: 1, done: true });
    expect(store).toHaveLength(0);
  });

  it("stops at the first error and says so, never throwing (before the SQL runs, the lister is missing)", async () => {
    const missing = fakeAdmin([{ name: staged(1), createdAt: hoursAgo(5) }], { listError: "Could not find the function public.press_stale_uploads" });
    expect(await sweepStaleUploads(missing.admin, NOW)).toEqual({ removed: 0, done: false, error: "Could not find the function public.press_stale_uploads" });
    const refused = fakeAdmin([{ name: staged(1), createdAt: hoursAgo(5) }], { removeError: "storage down" });
    expect(await sweepStaleUploads(refused.admin, NOW)).toEqual({ removed: 0, done: false, error: "storage down" });
  });
});
