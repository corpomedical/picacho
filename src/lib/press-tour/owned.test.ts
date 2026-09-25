import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MAX_IDS_PER_KIND,
  NOT_YOURS,
  NotOwnedError,
  OWNED_TABLES,
  OWNERSHIP_UNAVAILABLE,
  assertOwned,
  checkOwned,
  pathOwned,
} from "./owned";

// assertOwned (critique #8): every id a request names is the caller's own
// before anything is read, written or spent. The fake below filters rows the
// way PostgREST would, so these are statements about which rows pass, not
// about which methods were called.

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Row = Record<string, unknown>;
type Call = { table: string; ops: string[] };

function fakeDb(tables: Record<string, Row[]>, opts: { failing?: string[]; throwing?: string[] } = {}) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      let rows = [...(tables[table] ?? [])];
      const builder = {
        select(cols: string) {
          call.ops.push(`select ${cols}`);
          return builder;
        },
        eq(col: string, v: unknown) {
          call.ops.push(`eq ${col}`);
          rows = rows.filter((r) => r[col] === v);
          return builder;
        },
        in(col: string, vs: unknown[]) {
          call.ops.push(`in ${col}`);
          rows = rows.filter((r) => vs.includes(r[col]));
          return builder;
        },
        is(col: string, v: null) {
          call.ops.push(`is ${col}`);
          rows = rows.filter((r) => (r[col] ?? null) === v);
          return builder;
        },
        then(ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) {
          if (opts.throwing?.includes(table)) return Promise.reject(new Error("socket hang up")).then(ok, bad);
          if (opts.failing?.includes(table) || !(table in tables)) {
            return Promise.resolve({ data: null, error: { message: `relation "public.${table}" does not exist` } }).then(ok, bad);
          }
          return Promise.resolve({ data: rows.map((r) => ({ id: r.id })), error: null }).then(ok, bad);
        },
      };
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

const world = () =>
  fakeDb({
    products: [
      { id: id(1), user_id: A, deleted_at: null },
      { id: id(2), user_id: B, deleted_at: null },
      { id: id(3), user_id: A, deleted_at: "2026-09-25T10:00:00Z" },
    ],
    brand_kits: [
      { id: id(10), user_id: A, deleted_at: null },
      { id: id(11), user_id: B, deleted_at: null },
    ],
    character_profiles: [
      { id: id(20), user_id: A },
      { id: id(21), user_id: A },
      { id: id(22), user_id: B },
    ],
    generations: [
      { id: id(30), user_id: A, deleted_at: null },
      { id: id(31), user_id: A, deleted_at: "2026-09-25T10:00:00Z" },
    ],
  });

describe("the caller's own rows pass", () => {
  it("one of each kind, and several characters", async () => {
    const { db } = world();
    await expect(
      assertOwned(A, { product: id(1), brandKit: id(10), character: [id(20), id(21)], generation: id(30) }, db),
    ).resolves.toBeUndefined();
    expect(await checkOwned(A, { product: id(1) }, db)).toEqual({ ok: true, error: null, code: null, kind: null });
  });

  it("nothing named is nothing to check, and costs no read", async () => {
    const { db, calls } = world();
    await expect(assertOwned(A, {}, db)).resolves.toBeUndefined();
    await expect(assertOwned(A, { product: null, character: [null, undefined], paths: null }, db)).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("ids are compared case-blind, and repeats are asked once", async () => {
    const { db, calls } = world();
    await expect(assertOwned(A.toUpperCase(), { character: [id(20).toUpperCase(), id(20)] }, db)).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("filters by owner, and by deleted_at only where rows are soft-deleted", async () => {
    const { db, calls } = world();
    await assertOwned(A, { product: id(1), character: id(20) }, db);
    const byTable = Object.fromEntries(calls.map((c) => [c.table, c.ops]));
    expect(byTable.products).toEqual(["select id", "eq user_id", "in id", "is deleted_at"]);
    expect(byTable.character_profiles).toEqual(["select id", "eq user_id", "in id"]);
  });
});

describe("anything else is refused, the same way whether it exists or not", () => {
  it("another person's product, kit or character", async () => {
    const { db } = world();
    for (const refs of [{ product: id(2) }, { brandKit: id(11) }, { character: [id(20), id(22)] }]) {
      const err = await assertOwned(A, refs, db).catch((e) => e);
      expect(err).toBeInstanceOf(NotOwnedError);
      expect(err.message).toBe(NOT_YOURS);
      expect(err.code).toBe("notFound");
    }
    expect(await checkOwned(A, { brandKit: id(11) }, db)).toMatchObject({ ok: false, code: "notFound", kind: "brandKit" });
  });

  it("an id nobody has gets the same answer as someone else's", async () => {
    const { db } = world();
    const theirs = await checkOwned(A, { product: id(2) }, db);
    const nobody = await checkOwned(A, { product: id(999) }, db);
    expect(nobody).toEqual(theirs);
  });

  it("a deleted product or generation is no longer anyone's to use", async () => {
    const { db } = world();
    expect((await checkOwned(A, { product: id(3) }, db)).code).toBe("notFound");
    expect((await checkOwned(A, { generation: id(31) }, db)).code).toBe("notFound");
  });

  it("one foreign id among the caller's own refuses the whole request", async () => {
    const { db } = world();
    expect(await checkOwned(A, { product: id(1), character: [id(20), id(22)], generation: id(30) }, db)).toMatchObject({
      ok: false,
      kind: "character",
    });
  });

  it("an id that is not a uuid is refused without a read (a model or a host may send anything)", async () => {
    const { db, calls } = world();
    for (const bad of ["ad-1", "", "1", `${id(1)} `, "*", `${id(1)},${id(2)}`]) {
      expect((await checkOwned(A, { product: bad }, db)).code, bad).toBe("notFound");
    }
    expect((await checkOwned(A, { character: [id(20), 42 as unknown as string] }, db)).code).toBe("notFound");
    expect(calls).toHaveLength(0);
  });

  it("a caller that is not a uuid owns nothing", async () => {
    const { db, calls } = world();
    for (const who of ["", "admin", "11111111-1111-4111-8111-11111111111", null as unknown as string]) {
      expect(await checkOwned(who, { product: id(1) }, db)).toMatchObject({ ok: false, kind: "user" });
    }
    expect(calls).toHaveLength(0);
  });

  it(`more than ${MAX_IDS_PER_KIND} ids of one kind are refused without a read`, async () => {
    const { db, calls } = world();
    const many = Array.from({ length: MAX_IDS_PER_KIND + 1 }, (_, i) => id(1000 + i));
    expect((await checkOwned(A, { character: many }, db)).code).toBe("notFound");
    expect(calls).toHaveLength(0);
  });
});

describe("a failed read is never a yes", () => {
  it("an error or a thrown read refuses as unavailable", async () => {
    const failing = fakeDb({ products: [{ id: id(1), user_id: A, deleted_at: null }] }, { failing: ["products"] });
    const err = await assertOwned(A, { product: id(1) }, failing.db).catch((e) => e);
    expect(err).toBeInstanceOf(NotOwnedError);
    expect(err).toMatchObject({ code: "unavailable", kind: "product", message: OWNERSHIP_UNAVAILABLE });

    const throwing = fakeDb({ products: [{ id: id(1), user_id: A, deleted_at: null }] }, { throwing: ["products"] });
    expect(await checkOwned(A, { product: id(1) }, throwing.db)).toMatchObject({ ok: false, code: "unavailable" });
  });

  it("a table whose SQL has not run yet (campaigns, connections) fails closed", async () => {
    const { db } = world();
    expect(await checkOwned(A, { campaign: id(40) }, db)).toMatchObject({ ok: false, code: "unavailable", kind: "campaign" });
    expect(await checkOwned(A, { connection: id(50) }, db)).toMatchObject({ ok: false, code: "unavailable", kind: "connection" });
  });

  it("a definite 'not yours' outranks a failed read", async () => {
    const { db } = world();
    expect(await checkOwned(A, { product: id(2), campaign: id(40) }, db)).toMatchObject({ code: "notFound", kind: "product" });
  });
});

describe("storage paths sit under the caller's own folder", () => {
  it("accepts the caller's own files", async () => {
    const { db } = world();
    expect(pathOwned(A, `${A}/products/front.png`)).toBe(true);
    await expect(assertOwned(A, { paths: [`${A}/press/crop.png`, null], product: id(1) }, db)).resolves.toBeUndefined();
  });

  it("refuses anything else, before any read", async () => {
    const { db, calls } = world();
    for (const bad of [
      `${B}/products/front.png`,
      `${A}/../${B}/front.png`,
      `/${A}/front.png`,
      `${A}/`,
      `${A}`,
      `${A}\\front.png`,
      `${A}//front.png`,
      `${A}/a\u0000.png`,
      `${A}x/front.png`,
      `${A}/${"x".repeat(520)}`,
      "",
    ]) {
      expect(pathOwned(A, bad), bad).toBe(false);
      expect((await checkOwned(A, { paths: bad, product: id(1) }, db)).kind, bad).toBe("paths");
    }
    expect(pathOwned(A, 5)).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("the kinds point at real tables with the right delete rule", () => {
  const supabase = join(__dirname, "..", "..", "..", "supabase");
  const applied = readdirSync(join(supabase, "applied"))
    .flatMap((d) => readdirSync(join(supabase, "applied", d)).filter((f) => f.endsWith(".sql")).map((f) => join(supabase, "applied", d, f)))
    .map((p) => readFileSync(p, "utf8"))
    .join("\n");
  const schema = readFileSync(join(supabase, "schema.sql"), "utf8");
  // Wherever it is now: pending/, or filed under applied/<date>/.
  const productsPath = [
    join(supabase, "pending", "press-tour-02-products.sql"),
    ...readdirSync(join(supabase, "applied")).map((d) => join(supabase, "applied", d, "press-tour-02-products.sql")),
  ].find((p) => existsSync(p));
  const products = readFileSync(productsPath!, "utf8");

  it("products and brand kits are soft-deleted (press-tour-02-products.sql)", () => {
    expect(OWNED_TABLES.product).toEqual({ table: "products", softDelete: true });
    expect(OWNED_TABLES.brandKit).toEqual({ table: "brand_kits", softDelete: true });
    expect(products).toContain("alter table public.products add column if not exists deleted_at timestamptz;");
    expect(products).toMatch(/create table if not exists public\.brand_kits \([\s\S]*?\n  deleted_at\s+timestamptz,/);
  });

  it("generations are soft-deleted; characters are not (a deleted character is gone)", () => {
    const table = (name: string) => schema.slice(schema.indexOf(`create table public.${name} (`), schema.indexOf(");", schema.indexOf(`create table public.${name} (`)));
    expect(table("generations")).toContain('"deleted_at" timestamp with time zone');
    expect(table("character_profiles")).toContain('"user_id" uuid not null');
    expect(table("character_profiles")).not.toContain("deleted_at");
    expect(applied).not.toMatch(/alter table public\.character_profiles[^;]*deleted_at/i);
    expect(OWNED_TABLES.generation.softDelete).toBe(true);
    expect(OWNED_TABLES.character.softDelete).toBe(false);
  });
});
