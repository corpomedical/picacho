import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { USER_STORAGE_BUCKETS } from "../profile/storage-buckets";
import { PRESS_KIT_BUCKET, PRESS_UPLOADS_BUCKET } from "./card-service";
import { PRESS_TOUR_FLAGS } from "./enabled";
import { BRAND_KIT_COLUMNS, PRODUCT_CARD_COLUMNS } from "./types";

// Press Tour's rollout lists, across the files that each keep one (Cut 1
// integration). enabled.test.ts pins 01's rows to the code and types.test.ts
// pins 02's values to the code; this file pins the other two rosters to the
// same truth, because each is a list nothing else keeps in step:
//   - scripts/verify-db.mjs, the operator's read-only "did the SQL land"
//     probe: a switch, bucket or column missing from it is one the probe
//     never asks about;
//   - src/lib/profile/storage-buckets.ts, the account-deletion sweep: a
//     bucket missing from it keeps a deleted person's product photos.

const repo = join(__dirname, "..", "..", "..");

/** A SQL file wherever it is now: pending/, or filed under applied/<date>/. */
function findSql(name: string): string {
  const root = join(repo, "supabase");
  const candidates = [
    join(root, "pending", name),
    ...readdirSync(join(root, "applied")).map((d) => join(root, "applied", d, name)),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`${name} is in neither supabase/pending nor supabase/applied/<date>`);
  return readFileSync(found, "utf8");
}

const products = findSql("press-tour-02-products.sql");
// verify-db.mjs runs against production when imported, so it is read as text,
// with its // comments taken out first.
const verifyDb = readFileSync(join(repo, "scripts", "verify-db.mjs"), "utf8")
  .split("\n")
  .map((line) => line.replace(/^\s*\/\/.*$/, ""))
  .join("\n");

/** The double-quoted strings of the first `<lead>[ ... ]` in verify-db.mjs. */
function verifyList(lead: string): string[] {
  const from = verifyDb.indexOf(lead);
  expect(from, lead).toBeGreaterThan(-1);
  const body = verifyDb.slice(from + lead.length, verifyDb.indexOf("]", from + lead.length));
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** The column names of `create table if not exists public.<table> (` in 02, constraints left out. */
function tableColumns(table: string): string[] {
  const lead = `create table if not exists public.${table} (`;
  const from = products.indexOf(lead);
  expect(from, lead).toBeGreaterThan(-1);
  const body = products.slice(from + lead.length, products.indexOf("\n);", from));
  return [...body.matchAll(/^ {2}([a-z_]+)\s/gm)].map((m) => m[1]).filter((c) => c !== "constraint");
}

const addedProductColumns = [...products.matchAll(/alter table public\.products add column if not exists ([a-z_]+)/g)].map((m) => m[1]);
// The Product Studio table's own columns (applied/2026-08-27/product-studio.sql),
// which verify-db has no reason to probe.
const STUDIO_BASE = ["id", "name", "created_at", "updated_at"];

describe("verify-db asks about every switch the code reads", () => {
  const flags = verifyList("const FLAGS = [");

  it("each Press Tour switch is probed", () => {
    for (const f of PRESS_TOUR_FLAGS) expect(flags, f).toContain(f);
  });

  it("and no Press Tour switch the code no longer reads", () => {
    const pressFlags = flags.filter((f) => /^(press_|product_lock_)/.test(f));
    expect(pressFlags.sort()).toEqual([...PRESS_TOUR_FLAGS].sort());
  });
});

describe("the press-kit bucket, in every roster", () => {
  it("02 creates the bucket the code writes to", () => {
    const insert = products.match(/insert into storage\.buckets[^;]*?values\s*\(\s*'([^']+)'/);
    expect(insert?.[1]).toBe(PRESS_KIT_BUCKET);
  });

  it("verify-db probes it", () => {
    expect(verifyList("const BUCKETS = [")).toContain(PRESS_KIT_BUCKET);
  });

  it("account deletion sweeps it", () => {
    expect(USER_STORAGE_BUCKETS).toContain(PRESS_KIT_BUCKET);
  });
});

describe("the press-uploads staging bucket, in every roster and bounded (SEC-3)", () => {
  it("02 creates it private, 12 MB a file, pictures only", () => {
    const from = products.indexOf("'press-uploads',\n  'press-uploads',");
    expect(from).toBeGreaterThan(-1);
    const values = products.slice(from, products.indexOf(")", products.indexOf("array[", from)) + 1);
    expect(values).toContain("false,\n  12582912,");
    expect(values).toContain("array['image/jpeg', 'image/png', 'image/webp']");
    expect(values).not.toContain("video");
    expect(PRESS_UPLOADS_BUCKET).toBe("press-uploads");
  });

  it("verify-db probes it and the sweep's lister, and account deletion sweeps it", () => {
    expect(verifyList("const BUCKETS = [")).toContain(PRESS_UPLOADS_BUCKET);
    expect(verifyList("const RPCS = [")).toContain("press_stale_uploads");
    expect(USER_STORAGE_BUCKETS).toContain(PRESS_UPLOADS_BUCKET);
  });

  it("the lister is the service role's alone", () => {
    expect(products).toContain("revoke all on function public.press_stale_uploads(timestamptz, integer) from public, anon, authenticated;");
    expect(products).toContain("grant execute on function public.press_stale_uploads(timestamptz, integer) to service_role;");
  });

  it("the hourly sweep is scheduled, behind the cron secret", () => {
    const crons = (JSON.parse(readFileSync(join(repo, "vercel.json"), "utf8")) as { crons: { path: string; schedule: string }[] }).crons;
    expect(crons.find((c) => c.path === "/api/cron/press-uploads")?.schedule).toMatch(/^\d+ \* \* \* \*$/);
    const route = readFileSync(join(repo, "src", "app", "api", "cron", "press-uploads", "route.ts"), "utf8");
    expect(route).toContain("if (!secret || auth !== `Bearer ${secret}`) {");
    expect(route.indexOf('{ status: 401 }')).toBeLessThan(route.indexOf("sweepStaleUploads("));
  });
});

describe("Cut 0's money hardening (M1/F1) and api_keys (F2)", () => {
  const hardening = findSql("press-tour-00-hardening.sql");
  const apiKeys = findSql("press-tour-00b-api-keys.sql");

  it("00 revokes both bonus-credit RPCs from public, anon and authenticated, and verifies it", () => {
    for (const fn of ["spend_bonus_credits", "add_bonus_credits"]) {
      expect(hardening).toContain(`revoke all on function public.${fn}(uuid, integer) from public, anon, authenticated;`);
      expect(hardening).toContain(`grant execute on function public.${fn}(uuid, integer) to service_role;`);
      expect(hardening).toContain(`'public.${fn}(uuid, integer)'`);
    }
    expect(hardening).toMatch(/foreach who in array array\['public', 'anon', 'authenticated'\] loop\s+if has_function_privilege\(who, fn, 'EXECUTE'\) then\s+raise exception/);
  });

  it("00b drops the write policies and the write grants on api_keys, and verifies it", () => {
    expect(apiKeys).toContain('drop policy if exists "Insert own api keys" on public.api_keys;');
    expect(apiKeys).toContain('drop policy if exists "Update own api keys" on public.api_keys;');
    expect(apiKeys).toContain("revoke insert, update, delete, truncate, references, trigger on public.api_keys from public, anon, authenticated;");
    expect(apiKeys).toContain("cmd <> 'SELECT'");
    expect(apiKeys).toMatch(/PASTE THIS AFTER THE CUT 0 PUSH IS LIVE/);
  });

  it("verify-db can find a signature for every function it must probe with the anon key", () => {
    // verify-db reads schema.sql, then applied/ and pending/ (schema.sql
    // lags); a function none of them declares prints "cannot probe" and is
    // never called at all, which is how the bonus RPCs went unprobed.
    const root = join(repo, "supabase");
    const sqlIn = (dir: string): string =>
      readdirSync(dir, { withFileTypes: true })
        .map((e) => (e.isDirectory() ? sqlIn(join(dir, e.name)) : e.name.endsWith(".sql") ? readFileSync(join(dir, e.name), "utf8") : ""))
        .join("\n");
    const all = [readFileSync(join(root, "schema.sql"), "utf8"), sqlIn(join(root, "applied")), existsSync(join(root, "pending")) ? sqlIn(join(root, "pending")) : ""].join("\n");
    const privateRpcs = verifyList("const PRIVATE_RPCS = [");
    expect(privateRpcs).toEqual(expect.arrayContaining(["spend_bonus_credits", "add_bonus_credits"]));
    for (const fn of privateRpcs) {
      expect(all, fn).toMatch(new RegExp(`create or replace function public\\.${fn}\\(`, "i"));
    }
    expect(verifyDb).toContain('new URL("../supabase/applied/", import.meta.url)');
    expect(verifyDb).toContain('new URL("../supabase/pending/", import.meta.url)');
  });
});

describe("verify-db probes every column 02 creates and the code reads", () => {
  it("products: every column 02 adds, and every column a card read selects", () => {
    const probed = verifyList("  products: [");
    expect(addedProductColumns.length).toBeGreaterThan(0);
    for (const col of addedProductColumns) expect(probed, col).toContain(col);
    for (const col of PRODUCT_CARD_COLUMNS.split(", ")) {
      if (!STUDIO_BASE.includes(col)) expect(probed, col).toContain(col);
    }
  });

  it("02's own verify block names every column it adds to products", () => {
    const from = products.indexOf("-- Every new products column is there.");
    expect(from).toBeGreaterThan(-1);
    const body = products.slice(from, products.indexOf("]) col", from));
    const verified = [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(verified.sort()).toEqual([...addedProductColumns].sort());
  });

  it("brand_kits: every column but the key and the timestamps, which a kit read selects too", () => {
    const probed = verifyList("  brand_kits: [");
    const created = tableColumns("brand_kits");
    expect(created).toContain("user_id");
    for (const col of created) {
      if (!["id", "created_at", "updated_at"].includes(col)) expect(probed, col).toContain(col);
    }
    for (const col of BRAND_KIT_COLUMNS.split(", ")) expect(created, col).toContain(col);
  });

  it("product_consents: every column but the key", () => {
    const probed = verifyList("  product_consents: [");
    const created = tableColumns("product_consents");
    expect(created).toContain("photos_hash");
    for (const col of created) {
      if (col !== "id") expect(probed, col).toContain(col);
    }
  });
});
