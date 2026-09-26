// An in-memory Supabase for the campaign engine's tests (quote, planner,
// paint, campaign-machine, campaign-service). Test-only: nothing in the app
// imports it (campaign-machine.test.ts pins that).
//
// It holds what press-tour-03-campaigns.sql holds, in miniature: the
// press_campaigns guard (owner, send id and product fixed; a closed
// campaign stays closed; version, updated_at and stage_changed_at bumped on
// every update; a campaign's product must be the owner's confirmed one),
// reserve_generations (one transaction: a taken id fails the whole batch
// with 23505, the monthly portion checked against the window) and
// claim_press_campaigns (the working stages, the 6-minute lease, by id or
// oldest first). Relative imports only.

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Row = Record<string, unknown>;

export const USER_A = "11111111-1111-4111-8111-111111111111";
export const USER_B = "22222222-2222-4222-8222-222222222222";
export const PRODUCT_A = "33333333-3333-4333-8333-333333333333";
export const CHARACTER_A = "44444444-4444-4444-8444-444444444444";
export const PRODUCT_B = "55555555-5555-4555-8555-555555555555";
export const CHARACTER_B = "66666666-6666-4666-8666-666666666666";

const WORKING = ["painting", "checking_keyframes", "animating", "checking_shots", "assembling", "signing"];
const TERMINAL = ["failed", "cancelled", "expired"];

export type FakeClock = { now: Date };

export function fakeDb(seed: Record<string, Row[]> = {}, clock: FakeClock = { now: new Date("2026-09-26T10:00:00.000Z") }) {
  const tables: Record<string, Row[]> = {
    profiles: [
      { id: USER_A, role: "admin", plan: "none", plan_status: null, status: null, bonus_credits: 0, purchased_credits: 0 },
      { id: USER_B, role: "user", plan: "growth", plan_status: "active", status: null, bonus_credits: 0, purchased_credits: 0 },
    ],
    products: [],
    brand_kits: [],
    character_profiles: [],
    character_likeness_consents: [],
    character_ad_consents: [],
    press_campaigns: [],
    generations: [],
    brand_rules: [],
    feature_flags: [],
    app_settings: [],
    api_rate_hits: [],
    ...seed,
  };
  const files = new Map<string, Buffer>();
  const log: string[] = [];
  const iso = () => clock.now.toISOString();
  let failNextUpdateOf: string | null = null;

  const guard = (table: string, op: "INSERT" | "UPDATE", row: Row, old: Row | null): string | null => {
    if (table !== "press_campaigns") return null;
    if (op === "UPDATE" && old) {
      if (row.user_id !== old.user_id) return "a campaign cannot change owner";
      if (row.send_id !== old.send_id) return "a campaign keeps the send id it was made with";
      if (row.product_id !== old.product_id) return "a campaign keeps its product";
      if (TERMINAL.includes(String(old.stage)) && row.stage !== old.stage) return "a closed campaign stays closed";
      row.version = Number(old.version ?? 0) + 1;
      row.updated_at = iso();
      if (row.stage !== old.stage) {
        row.stage_changed_at = iso();
        row.overdue_notified_at = null;
      }
      return null;
    }
    row.version = 0;
    row.stage_changed_at = iso();
    const product = tables.products.find((p) => p.id === row.product_id && p.user_id === row.user_id);
    if (!product || product.status !== "confirmed" || product.deleted_at) {
      return "a campaign's product must be one of the owner's own confirmed products";
    }
    if (tables.press_campaigns.some((c) => c.id === row.id || c.send_id === row.send_id)) {
      return "duplicate key value violates unique constraint";
    }
    return null;
  };

  const DEFAULTS: Record<string, Row> = {
    press_campaigns: {
      source: "door",
      brand_kit_id: null,
      trial_id: null,
      mcp_grant_id: null,
      platforms: [],
      aspect: "9:16",
      length_s: 15,
      goal: null,
      plan: null,
      quote: null,
      stills: [],
      stage: "draft",
      progress: null,
      locked_at: null,
      attempts: 0,
      version: 0,
      keyframe_ids: [],
      shot_ids: [],
      master_generation_id: null,
      renditions: null,
      product_verdict: null,
      reshoots_used: 0,
      cost_usd: 0,
      credits_charged: 0,
      credits_refunded: 0,
      error: null,
      expires_at: null,
      overdue_notified_at: null,
      deleted_at: null,
    },
  };

  const from = (table: string) => {
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row | Row[] | null = null;
    let returning = false;
    let counting = false;
    let limitN: number | null = null;
    let orderBy: { col: string; asc: boolean } | null = null;
    const filters: ((r: Row) => boolean)[] = [];
    const run = (): { data: unknown; count?: number; error: { message: string; code?: string } | null } => {
      log.push(`${op} ${table}`);
      const rows = (tables[table] ??= []);
      if (op === "insert") {
        const out: Row[] = [];
        const list = Array.isArray(payload) ? payload : [payload!];
        const staged: Row[] = [];
        for (const r of list) {
          const row: Row = { id: randomUUID(), created_at: iso(), updated_at: iso(), ...(DEFAULTS[table] ?? {}), ...r };
          const err = guard(table, "INSERT", row, null);
          if (err) return { data: null, error: { message: err, code: err.startsWith("duplicate") ? "23505" : "P0001" } };
          staged.push(row);
        }
        for (const row of staged) {
          rows.push(row);
          out.push({ ...row });
        }
        return { data: returning ? out : null, error: null };
      }
      const matched = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        if (failNextUpdateOf === table) {
          failNextUpdateOf = null;
          return { data: null, error: { message: "update failed (test)" } };
        }
        const out: Row[] = [];
        for (const r of matched) {
          const next = { ...r, ...(payload as Row) };
          const err = guard(table, "UPDATE", next, r);
          if (err) return { data: null, error: { message: err } };
          Object.assign(r, next);
          out.push({ ...r });
        }
        return { data: returning ? out : null, error: null };
      }
      if (op === "delete") {
        tables[table] = rows.filter((r) => !matched.includes(r));
        return { data: null, error: null };
      }
      if (counting) return { data: null, count: matched.length, error: null };
      let picked = [...matched];
      if (orderBy) {
        const { col, asc } = orderBy;
        picked.sort((a, b) => (String(a[col]) < String(b[col]) ? (asc ? -1 : 1) : String(a[col]) > String(b[col]) ? (asc ? 1 : -1) : 0));
      }
      if (limitN !== null) picked = picked.slice(0, limitN);
      return { data: picked.map((r) => structuredClone(r)), error: null };
    };
    const b = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        if (op !== "select") returning = true;
        if (opts?.count) counting = true;
        return b;
      },
      insert(p: Row | Row[]) {
        op = "insert";
        payload = structuredClone(p);
        return b;
      },
      update(p: Row) {
        op = "update";
        payload = structuredClone(p);
        return b;
      },
      delete() {
        op = "delete";
        return b;
      },
      eq(col: string, v: unknown) {
        filters.push((r) => r[col] === v);
        return b;
      },
      neq(col: string, v: unknown) {
        filters.push((r) => r[col] !== v);
        return b;
      },
      in(col: string, vs: unknown[]) {
        filters.push((r) => vs.includes(r[col]));
        return b;
      },
      is(col: string, v: unknown) {
        filters.push((r) => (r[col] ?? null) === v);
        return b;
      },
      lt(col: string, v: string) {
        filters.push((r) => r[col] !== null && r[col] !== undefined && String(r[col]) < v);
        return b;
      },
      gte(col: string, v: string) {
        filters.push((r) => String(r[col]) >= v);
        return b;
      },
      or() {
        return b;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderBy = { col, asc: opts?.ascending !== false };
        return b;
      },
      limit(n: number) {
        limitN = n;
        return b;
      },
      maybeSingle() {
        const res = run();
        if (res.error) return Promise.resolve({ data: null, error: res.error });
        return Promise.resolve({ data: Array.isArray(res.data) ? (res.data[0] ?? null) : res.data, error: null });
      },
      single() {
        const res = run();
        if (res.error) return Promise.resolve(res);
        const list = res.data as Row[] | null;
        return Promise.resolve(list && list.length === 1 ? { data: list[0], error: null } : { data: null, error: { message: "expected one row" } });
      },
      then(ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) {
        return Promise.resolve(run()).then(ok, bad);
      },
    };
    return b;
  };

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    log.push(`rpc ${fn}`);
    if (fn === "reserve_generations") {
      const userId = String(args.p_user_id);
      const since = String(args.p_since);
      const used = tables.generations
        .filter((g) => g.user_id === userId && String(g.created_at) >= since)
        .reduce((sum, g) => sum + (g.credits_used === null || g.credits_used === undefined ? 1 : Number(g.credits_used)), 0);
      if (Number(args.p_monthly_portion) > Math.max(0, Number(args.p_limit) - used)) return { data: null, error: null };
      const list: Row[] = (args.p_rows as Row[]).map((r) => ({
        status: "generating",
        attempts: 0,
        pipeline_log: [],
        credits_used: 0,
        purchased_credits_used: 0,
        bonus_credits_used: 0,
        free_generation_used: false,
        created_at: iso(),
        updated_at: iso(),
        ...structuredClone(r),
        user_id: userId,
      }));
      if (list.some((r) => tables.generations.some((g) => g.id === r.id)) || new Set(list.map((r) => r.id)).size !== list.length) {
        return { data: null, error: { message: 'duplicate key value violates unique constraint "generations_pkey"', code: "23505" } };
      }
      tables.generations.push(...list);
      return { data: list.map((r) => r.id), error: null };
    }
    if (fn === "claim_press_campaigns") {
      const limit = Math.min(25, Math.max(1, Number(args.p_limit) || 1));
      const staleBefore = new Date(clock.now.getTime() - 6 * 60_000).toISOString();
      const due = tables.press_campaigns
        .filter(
          (c) =>
            !c.deleted_at &&
            WORKING.includes(String(c.stage)) &&
            (c.locked_at === null || c.locked_at === undefined || String(c.locked_at) < staleBefore) &&
            (args.p_campaign === null || args.p_campaign === undefined || c.id === args.p_campaign),
        )
        .sort((a, b) => (String(a.updated_at) < String(b.updated_at) ? -1 : 1))
        .slice(0, limit);
      const out = due.map((c) => {
        c.locked_at = iso();
        c.attempts = Number(c.attempts ?? 0) + 1;
        c.version = Number(c.version ?? 0) + 1;
        c.updated_at = iso();
        return { id: c.id, user_id: c.user_id, stage: c.stage, version: c.version, locked_at: c.locked_at };
      });
      return { data: out, error: null };
    }
    return { data: null, error: { message: `no such function ${fn}`, code: "PGRST202" } };
  };

  const storage = {
    from(bucketName: string) {
      const key = (p: string) => `${bucketName}/${p}`;
      return {
        async upload(path: string, data: Buffer) {
          log.push(`upload ${bucketName}/${path}`);
          files.set(key(path), Buffer.from(data));
          return { data: { path }, error: null };
        },
        async download(path: string) {
          const f = files.get(key(path));
          return f ? { data: new Blob([new Uint8Array(f)]), error: null } : { data: null, error: { message: "Object not found" } };
        },
        async remove(paths: string[]) {
          for (const p of paths) {
            log.push(`remove ${bucketName}/${p}`);
            files.delete(key(p));
          }
          return { data: [], error: null };
        },
        async createSignedUrl(path: string) {
          return { data: { signedUrl: `https://storage.test/${key(path)}?token=t` }, error: null };
        },
        async createSignedUrls(paths: string[]) {
          return { data: paths.map((p) => ({ path: p, signedUrl: `https://storage.test/${key(p)}?token=t`, error: null })), error: null };
        },
      };
    },
  };

  const db = { from, rpc, storage } as unknown as SupabaseClient;
  return {
    db,
    tables,
    files,
    log,
    clock,
    /** The next update of this table fails (a database hiccup). */
    failNextUpdate(table: string) {
      failNextUpdateOf = table;
    },
  };
}

/** A confirmed product card for USER_A (the columns card-service writes). */
export function confirmedProduct(over: Row = {}): Row {
  return {
    id: PRODUCT_A,
    user_id: USER_A,
    name: "Solstad Cold Brew",
    brand_kit_id: null,
    source_url: null,
    category: "liquid",
    dna: { name: "Solstad Cold Brew", brand: "Solstad", category: "liquid", shape: ["slim can"], material: "aluminium", colours: ["black"], marks: [] },
    dna_photos: [`${USER_A}/products/${PRODUCT_A}/front.jpg`, `${USER_A}/products/${PRODUCT_A}/side.jpg`, `${USER_A}/products/${PRODUCT_A}/back.jpg`],
    label_strings: ["SOLSTAD"],
    no_readable_text: false,
    image_paths: [`${USER_A}/products/${PRODUCT_A}/front.jpg`, `${USER_A}/products/${PRODUCT_A}/side.jpg`, `${USER_A}/products/${PRODUCT_A}/back.jpg`],
    logo_path: null,
    logo_box: null,
    palette: ["#101010"],
    angles: [
      { path: `${USER_A}/products/${PRODUCT_A}/front.jpg`, view: "front" },
      { path: `${USER_A}/products/${PRODUCT_A}/side.jpg`, view: "side" },
      { path: `${USER_A}/products/${PRODUCT_A}/back.jpg`, view: "back" },
    ],
    lock_refs: null,
    photos_hash: "3-abc",
    status: "confirmed",
    confirmed_at: "2026-09-25T10:00:00.000Z",
    created_at: "2026-09-25T09:00:00.000Z",
    updated_at: "2026-09-25T10:00:00.000Z",
    deleted_at: null,
    ...over,
  };
}

/** USER_A's character with one photo. */
export function character(over: Row = {}): Row {
  return {
    id: CHARACTER_A,
    user_id: USER_A,
    name: "Eva",
    reference_image_urls: [`${USER_A}/eva-1.jpg`],
    traits: { hair: "dark bob" },
    ...over,
  };
}

/** The ad-use attestation for CHARACTER_A's current photos. */
export function adConsent(photosHashValue: string, over: Row = {}): Row {
  return {
    id: randomUUID(),
    user_id: USER_A,
    character_id: CHARACTER_A,
    answer: "me",
    ads_ok: true,
    photos_hash: photosHashValue,
    notice_version: "2026-09-26",
    locale: "en",
    method: "checkbox",
    place: "door",
    consented_at: "2026-09-26T09:00:00.000Z",
    ...over,
  };
}
