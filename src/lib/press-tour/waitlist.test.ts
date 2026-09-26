import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WAITLIST_FAILED, WAITLIST_TABLE, readWaitlistFor, setWaitlistFor } from "./waitlist";
import { CAMPAIGN_SAVE_FAILED } from "./campaign-messages";

// "Tell me when <network> opens" (waitlist.ts): one row per person per
// network, the person's own, written by the service role; a switch that
// starts off; nothing sent from here.

type Row = { user_id: string; network: string };

function fakeDb(rows: Row[], fail = false) {
  const calls: string[] = [];
  const table = () => {
    let filters: [string, string][] = [];
    const q = {
      select() {
        return q;
      },
      eq(col: string, val: string) {
        filters.push([col, val]);
        return q;
      },
      limit() {
        calls.push(`select ${filters.map(([c, v]) => `${c}=${v}`).join(",")}`);
        const data = rows.filter((r) => filters.every(([c, v]) => (r as Record<string, string>)[c] === v));
        filters = [];
        return Promise.resolve(fail ? { data: null, error: { message: "down" } } : { data, error: null });
      },
      upsert(row: Row) {
        calls.push(`upsert ${row.user_id}/${row.network}`);
        if (!fail && !rows.some((r) => r.user_id === row.user_id && r.network === row.network)) rows.push(row);
        return Promise.resolve({ error: fail ? { message: "down" } : null });
      },
      delete() {
        const del = {
          eq(col: string, val: string) {
            filters.push([col, val]);
            if (filters.length < 2) return del;
            calls.push(`delete ${filters.map(([c, v]) => `${c}=${v}`).join(",")}`);
            const keep = rows.filter((r) => !filters.every(([c, v]) => (r as Record<string, string>)[c] === v));
            rows.splice(0, rows.length, ...keep);
            filters = [];
            return Promise.resolve({ error: null });
          },
        };
        return del;
      },
    };
    return q;
  };
  return { db: { from: (name: string) => (name === WAITLIST_TABLE ? table() : null) } as unknown as SupabaseClient, calls };
}

const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";

describe("the waitlist", () => {
  it("reads only the person's own networks, in the networks' order", async () => {
    const { db } = fakeDb([
      { user_id: ME, network: "threads" },
      { user_id: ME, network: "instagram" },
      { user_id: THEM, network: "tiktok" },
    ]);
    expect(await readWaitlistFor(db, ME)).toEqual({ ok: true, networks: ["instagram", "threads"] });
  });

  it("puts the person on a list and takes them off it, touching only their own row", async () => {
    const rows: Row[] = [{ user_id: THEM, network: "instagram" }];
    const { db, calls } = fakeDb(rows);
    expect(await setWaitlistFor(db, ME, { network: "instagram", on: true })).toEqual({ ok: true, networks: ["instagram"] });
    expect(await setWaitlistFor(db, ME, { network: "instagram", on: false })).toEqual({ ok: true, networks: [] });
    expect(rows).toEqual([{ user_id: THEM, network: "instagram" }]);
    expect(calls).toContain(`delete user_id=${ME},network=instagram`);
  });

  it("refuses anything but a network and a yes or no, and says so plainly when the list is down", async () => {
    const { db } = fakeDb([]);
    expect(await setWaitlistFor(db, ME, { network: "myspace", on: true })).toEqual({ ok: false, error: WAITLIST_FAILED });
    expect(await setWaitlistFor(db, ME, { network: "instagram", on: "yes" })).toEqual({ ok: false, error: WAITLIST_FAILED });
    const down = fakeDb([], true).db;
    expect(await readWaitlistFor(down, ME)).toEqual({ ok: false, error: WAITLIST_FAILED });
    expect(await setWaitlistFor(down, ME, { network: "instagram", on: true })).toEqual({ ok: false, error: WAITLIST_FAILED });
    // One sentence, already translated in four languages.
    expect(WAITLIST_FAILED).toBe(CAMPAIGN_SAVE_FAILED);
  });

  it("keeps the table the service role's alone: RLS on, no policies, nothing for people", () => {
    const sql = readFileSync(join(__dirname, "..", "..", "..", "supabase", "pending", "press-tour-08-waitlist.sql"), "utf8");
    expect(sql).toContain("create table if not exists public.press_network_waitlist");
    expect(sql).toContain("alter table public.press_network_waitlist enable row level security;");
    expect(sql).toContain("revoke all on table public.press_network_waitlist from public, anon, authenticated;");
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toContain("on delete cascade");
    expect(sql).toContain("check (network in ('x', 'tiktok', 'instagram', 'threads'))");
  });
});
