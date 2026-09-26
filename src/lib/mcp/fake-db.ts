// An in-memory Supabase for the MCP and OAuth tests. TEST-ONLY: nothing in
// the app imports it (oauth.test.ts pins that).
//
// It speaks the slice of the query builder the MCP modules use: select /
// insert / update / upsert / delete, the filters eq, neq, is, in, gt, gte,
// lt, lte, order and limit, and maybeSingle / single / await; and rpc, for
// the functions a test hands in (`rpc` below). Each call is
// one statement, as it is in PostgREST, so a conditional UPDATE's returned
// rows are exactly the rows it changed: the property every "once" in
// oauth/store.ts relies on. Unique columns per table are enforced on insert
// (23505), and the one partial unique index (a live grant per account, app
// and resource) is too. Relative imports only.

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Row = Record<string, unknown>;

const PRIMARY_KEYS: Record<string, string> = {
  oauth_clients: "client_id",
  oauth_codes: "code_hash",
  oauth_tokens: "token_hash",
  oauth_revoked_families: "family_id",
  mcp_ui_nonces: "nonce_hash",
};

/** A database function a test stands in for: it reads and changes the tables directly. */
export type FakeRpc = (args: Record<string, unknown>, tables: Record<string, Row[]>) => { data: unknown; error: { message: string } | null };

export function fakeDb(seed: Record<string, Row[]> = {}, opts: { rpc?: Record<string, FakeRpc> } = {}) {
  const tables: Record<string, Row[]> = { ...seed };
  const log: string[] = [];
  let failNext: string | null = null;

  const keyOf = (table: string) => PRIMARY_KEYS[table] ?? "id";

  const uniqueViolation = (table: string, row: Row, ignore: Row | null): boolean => {
    const rows = tables[table] ?? [];
    const key = keyOf(table);
    if (rows.some((r) => r !== ignore && r[key] === row[key])) return true;
    if (table === "oauth_grants" && (row.revoked_at ?? null) === null) {
      return rows.some(
        (r) =>
          r !== ignore &&
          (r.revoked_at ?? null) === null &&
          r.user_id === row.user_id &&
          r.client_id === row.client_id &&
          r.resource === row.resource,
      );
    }
    return false;
  };

  const from = (table: string) => {
    let op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
    let payload: Row | Row[] | null = null;
    let returning = false;
    let limitN: number | null = null;
    let orderBy: { col: string; asc: boolean } | null = null;
    const filters: ((r: Row) => boolean)[] = [];

    const run = (): { data: unknown; error: { message: string; code?: string } | null } => {
      log.push(`${op} ${table}`);
      if (failNext === table) {
        failNext = null;
        return { data: null, error: { message: "database hiccup (test)" } };
      }
      const rows = (tables[table] ??= []);
      if (op === "insert" || op === "upsert") {
        const list = Array.isArray(payload) ? payload : [payload!];
        const out: Row[] = [];
        const staged: Row[] = [];
        for (const r of list) {
          const key = keyOf(table);
          const row: Row = { ...(key === "id" ? { id: randomUUID() } : {}), ...structuredClone(r) };
          if (op === "upsert") {
            const existing = rows.find((x) => x[key] === row[key]);
            if (existing) {
              Object.assign(existing, row);
              out.push({ ...existing });
              continue;
            }
          }
          if (uniqueViolation(table, row, null) || staged.some((s) => s[key] === row[key])) {
            return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } };
          }
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
        const out: Row[] = [];
        for (const r of matched) {
          const next = { ...r, ...(payload as Row) };
          if (uniqueViolation(table, next, r)) {
            return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } };
          }
          Object.assign(r, next);
          out.push({ ...r });
        }
        return { data: returning ? out : null, error: null };
      }
      if (op === "delete") {
        tables[table] = rows.filter((r) => !matched.includes(r));
        return { data: null, error: null };
      }
      let picked = [...matched];
      if (orderBy) {
        const { col, asc } = orderBy;
        picked.sort((a, b) => (String(a[col]) < String(b[col]) ? (asc ? -1 : 1) : String(a[col]) > String(b[col]) ? (asc ? 1 : -1) : 0));
      }
      if (limitN !== null) picked = picked.slice(0, limitN);
      return { data: picked.map((r) => structuredClone(r)), error: null };
    };

    const cmp = (col: string, test: (a: string, b: string) => boolean, v: unknown) =>
      filters.push((r) => r[col] !== null && r[col] !== undefined && test(String(r[col]), String(v)));

    const b = {
      select() {
        if (op !== "select") returning = true;
        return b;
      },
      insert(p: Row | Row[]) {
        op = "insert";
        payload = p;
        return b;
      },
      upsert(p: Row | Row[]) {
        op = "upsert";
        payload = p;
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
      gt(col: string, v: unknown) {
        cmp(col, (a, x) => a > x, v);
        return b;
      },
      gte(col: string, v: unknown) {
        cmp(col, (a, x) => a >= x, v);
        return b;
      },
      lt(col: string, v: unknown) {
        cmp(col, (a, x) => a < x, v);
        return b;
      },
      lte(col: string, v: unknown) {
        cmp(col, (a, x) => a <= x, v);
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

  const rpc = (name: string, args: Record<string, unknown> = {}) => {
    log.push(`rpc ${name}`);
    const fn = opts.rpc?.[name];
    if (!fn) return Promise.resolve({ data: null, error: { message: `function ${name} does not exist (test)` } });
    if (failNext === `rpc:${name}`) {
      failNext = null;
      return Promise.resolve({ data: null, error: { message: "database hiccup (test)" } });
    }
    return Promise.resolve(fn(args, tables));
  };

  const db = { from, rpc } as unknown as SupabaseClient;
  return {
    db,
    tables,
    log,
    /** The next statement against this table (or "rpc:<name>") fails (a database hiccup). */
    failNext(table: string) {
      failNext = table;
    },
  };
}
