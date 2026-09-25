import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PAID_PLANS,
  PRESS_TOUR_CONFIRM_EMAIL,
  PRESS_TOUR_FLAGS,
  PRESS_TOUR_NEEDS_PLAN,
  PRESS_TOUR_NOT_OPEN,
  PRESS_TOUR_REQUIRED_KEYS,
  PRESS_TOUR_SETTINGS,
  PRESS_TOUR_SUSPENDED,
  hasPressTourPlan,
  isPressTourEnabled,
  parsePlanList,
  parsePressTourSetting,
  pressTourAllowed,
  pressTourEmailError,
  pressTourEnvReady,
  pressTourMissingKeys,
  pressTourOpenings,
  readPressTourSettings,
  readPressTourSwitches,
  settingsFromRows,
  switchesFromRows,
  validatePressTourSetting,
} from "./enabled";

// Press Tour's switches (Cut 1): the env kill switch, the provider keys, the
// press_tour flag read fail-closed, admins first; every switch and setting
// the code knows is exactly what press-tour-01-flags.sql inserts, all OFF.

/** A SQL file wherever it is now: pending/, or filed under applied/<date>/. */
function findSql(name: string): string {
  const root = join(__dirname, "..", "..", "..", "supabase");
  const candidates = [
    join(root, "pending", name),
    ...readdirSync(join(root, "applied")).map((d) => join(root, "applied", d, name)),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`${name} is in neither supabase/pending nor supabase/applied/<date>`);
  return readFileSync(found, "utf8");
}

const sql = findSql("press-tour-01-flags.sql");
const unquote = (s: string) => s.replace(/''/g, "'");
const flagRows = [
  ...sql.matchAll(/insert into public\.feature_flags \(key, enabled, description\)\s*values \(\s*'([^']+)',\s*(true|false),\s*'((?:[^']|'')*)'\s*\)\s*on conflict \(key\) do nothing;/g),
].map((m) => ({ key: m[1], enabled: m[2], description: unquote(m[3]) }));
const settingRows = [
  ...sql.matchAll(/insert into public\.app_settings \(key, value, description\)\s*values \(\s*'([^']+)',\s*'([^']*)',\s*'((?:[^']|'')*)'\s*\)\s*on conflict \(key\) do nothing;/g),
].map((m) => ({ key: m[1], value: m[2] }));

const READY_ENV = Object.fromEntries(PRESS_TOUR_REQUIRED_KEYS.map((k) => [k, "set"]));

function stubReadyEnv() {
  for (const k of PRESS_TOUR_REQUIRED_KEYS) vi.stubEnv(k, "set");
  vi.stubEnv("PRESS_TOUR_DISABLED", "");
}

/** A feature_flags / app_settings reader that answers from rows, and counts its reads. */
function fakeDb(answer: { data?: unknown; error?: { message: string } | null; throws?: boolean }) {
  let reads = 0;
  const result = () => (answer.throws ? Promise.reject(new Error("network")) : Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null }));
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    maybeSingle: () => result(),
    then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => result().then(ok, bad),
  });
  const db = {
    from: () => {
      reads++;
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, reads: () => reads };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the SQL and the code name the same switches", () => {
  it("inserts every switch the code reads, each one OFF, and no other", () => {
    expect(flagRows.map((r) => r.key).sort()).toEqual([...PRESS_TOUR_FLAGS].sort());
    expect(flagRows.every((r) => r.enabled === "false")).toBe(true);
    expect(sql).not.toMatch(/do update/i);
  });

  it("seeds every setting the code reads, each one doing nothing, and no other", () => {
    expect(settingRows.map((r) => r.key).sort()).toEqual(Object.keys(PRESS_TOUR_SETTINGS).sort());
    for (const { key, value } of settingRows) {
      expect(value, key).toBe(PRESS_TOUR_SETTINGS[key as keyof typeof PRESS_TOUR_SETTINGS].seed);
    }
    // v2: the per-person re-shoot allowance is 6; every other seed is 0.
    expect(PRESS_TOUR_SETTINGS.press_reshoot_user_30d.seed).toBe("6");
    for (const [key, spec] of Object.entries(PRESS_TOUR_SETTINGS)) {
      if (key !== "press_reshoot_user_30d") expect(spec.seed, key).toBe("0");
    }
    // The operator's trial ceiling is in dollars, and starts closed.
    expect(PRESS_TOUR_SETTINGS.press_trial_daily_usd).toMatchObject({ seed: "0", kind: "usd" });
  });

  it("the seeds read as closed: no plan, no trial, no free re-shoot budget, no X posts", () => {
    const seeded = settingsFromRows(settingRows);
    expect(seeded.press_tour_plan_list).toEqual([]);
    expect(seeded.press_trial_daily_usd).toBe(0);
    expect(seeded.press_trial_daily_cap).toBe(0);
    expect(seeded.press_reshoot_daily_usd).toBe(0);
    expect(seeded.press_x_daily_cap).toBe(0);
    expect(seeded.product_lock_min_confidence).toBe(0);
    expect(seeded.press_reshoot_user_30d).toBe(6);
    for (const { key, value } of settingRows) expect(validatePressTourSetting(key, value), key).toBeNull();
  });

  it("the verify block checks exactly the same rows", () => {
    const list = (name: string) => {
      const body = sql.slice(sql.indexOf(`${name} text[] := array[`));
      return [...body.slice(0, body.indexOf("];")).matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    };
    expect(list("want_flags")).toEqual([...PRESS_TOUR_FLAGS].sort());
    expect(list("want_settings")).toEqual(Object.keys(PRESS_TOUR_SETTINGS).sort());
  });

  it("the press_tour switch's description names every key the code requires", () => {
    const d = flagRows.find((r) => r.key === "press_tour")?.description ?? "";
    for (const k of PRESS_TOUR_REQUIRED_KEYS) expect(d, k).toContain(k);
  });
});

describe("level 1 and 2: the environment", () => {
  it("needs every provider key", () => {
    expect(pressTourMissingKeys(READY_ENV)).toEqual([]);
    expect(pressTourEnvReady(READY_ENV)).toBe(true);
    for (const k of PRESS_TOUR_REQUIRED_KEYS) {
      const env = { ...READY_ENV, [k]: "" };
      expect(pressTourMissingKeys(env)).toEqual([k]);
      expect(pressTourEnvReady(env)).toBe(false);
    }
  });

  it("PRESS_TOUR_DISABLED=1 switches it off whatever else is set", () => {
    expect(pressTourEnvReady({ ...READY_ENV, PRESS_TOUR_DISABLED: "1" })).toBe(false);
    expect(pressTourEnvReady({ ...READY_ENV, PRESS_TOUR_DISABLED: "0" })).toBe(true);
  });
});

describe("level 3: the press_tour switch, read fail-closed", () => {
  it("is on only when the row says enabled: true", async () => {
    stubReadyEnv();
    expect(await isPressTourEnabled(fakeDb({ data: { enabled: true } }).db)).toBe(true);
    expect(await isPressTourEnabled(fakeDb({ data: { enabled: false } }).db)).toBe(false);
    expect(await isPressTourEnabled(fakeDb({ data: { enabled: "true" } }).db)).toBe(false);
    expect(await isPressTourEnabled(fakeDb({ data: null }).db)).toBe(false);
    expect(await isPressTourEnabled(fakeDb({ data: { enabled: true }, error: { message: "boom" } }).db)).toBe(false);
    expect(await isPressTourEnabled(fakeDb({ throws: true }).db)).toBe(false);
  });

  it("never reads the database while the environment says no", async () => {
    stubReadyEnv();
    vi.stubEnv("PRESS_TOUR_DISABLED", "1");
    const off = fakeDb({ data: { enabled: true } });
    expect(await isPressTourEnabled(off.db)).toBe(false);
    expect(await readPressTourSwitches(off.db)).toEqual(switchesFromRows([]));
    expect(off.reads()).toBe(0);

    vi.stubEnv("PRESS_TOUR_DISABLED", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    const noKey = fakeDb({ data: { enabled: true } });
    expect(await isPressTourEnabled(noKey.db)).toBe(false);
    expect(noKey.reads()).toBe(0);
  });
});

describe("every switch in one read", () => {
  const on = (...keys: string[]) => keys.map((key) => ({ key, enabled: true }));

  it("nothing is on while press_tour is off", () => {
    const s = switchesFromRows(on("press_tour_trial", "press_tour_plans", "press_tour_posting", "product_lock_refund"));
    expect(Object.values(s).every((v) => v === false)).toBe(true);
  });

  it("with press_tour on, each switch is its own row, and only a real true counts", () => {
    const s = switchesFromRows([...on("press_tour", "press_tour_trial"), { key: "press_tour_plans", enabled: "true" }, { key: "made_up", enabled: true }, null]);
    expect(s.press_tour).toBe(true);
    expect(s.press_tour_trial).toBe(true);
    expect(s.press_tour_plans).toBe(false);
    expect(s.product_lock_refund).toBe(false);
    expect(Object.keys(s).sort()).toEqual([...PRESS_TOUR_FLAGS].sort());
  });

  it("a failed read is all off", async () => {
    stubReadyEnv();
    const allOff = switchesFromRows([]);
    expect(await readPressTourSwitches(fakeDb({ data: on("press_tour"), error: { message: "x" } }).db)).toEqual(allOff);
    expect(await readPressTourSwitches(fakeDb({ throws: true }).db)).toEqual(allOff);
    expect(await readPressTourSwitches(fakeDb({ data: "not rows" }).db)).toEqual(allOff);
    expect((await readPressTourSwitches(fakeDb({ data: on("press_tour", "press_trends") }).db)).press_trends).toBe(true);
  });
});

describe("the settings, read fail-closed", () => {
  it("a missing, malformed or out-of-range value reads as 0 / no plan", async () => {
    const none = settingsFromRows([]);
    expect(none.press_tour_plan_list).toEqual([]);
    expect(none.press_reshoot_user_30d).toBe(0);
    expect(none.press_trial_daily_usd).toBe(0);
    for (const bad of ["fifty", "-5", "50.123", "1e3", "", " ", "50,5", "0x10", "Infinity", null, 50]) {
      expect(parsePressTourSetting("press_trial_daily_usd", bad), String(bad)).toBe(0);
    }
    expect(parsePressTourSetting("press_trial_daily_usd", "1000.01")).toBe(0);
    expect(parsePressTourSetting("press_x_daily_cap", "200.5")).toBe(0);
    expect(parsePressTourSetting("product_lock_min_confidence", "96")).toBe(0);
    expect(await readPressTourSettings(fakeDb({ error: { message: "x" } }).db)).toEqual(none);
    expect(await readPressTourSettings(fakeDb({ throws: true }).db)).toEqual(none);
  });

  it("reads what the operator typed", async () => {
    expect(parsePressTourSetting("press_trial_daily_usd", "50")).toBe(50);
    expect(parsePressTourSetting("press_trial_daily_usd", " 12.5 ")).toBe(12.5);
    expect(parsePressTourSetting("press_x_daily_cap", "200")).toBe(200);
    const read = await readPressTourSettings(
      fakeDb({ data: [{ key: "press_trial_daily_usd", value: "50" }, { key: "press_tour_plan_list", value: "elite, studio" }] }).db,
    );
    expect(read.press_trial_daily_usd).toBe(50);
    expect(read.press_tour_plan_list).toEqual(["elite", "studio"]);
    expect(read.press_trial_daily_cap).toBe(0);
  });

  it("the plan list takes paid plans only", () => {
    expect(PAID_PLANS).toEqual(["basic", "starter", "growth", "studio", "elite"]);
    expect(parsePlanList("0")).toEqual([]);
    expect(parsePlanList("")).toEqual([]);
    expect(parsePlanList("Basic,elite,elite")).toEqual(["basic", "elite"]);
    expect(parsePlanList("none,admin,studo,growth")).toEqual(["growth"]);
    expect(parsePlanList(undefined)).toEqual([]);
  });

  it("Admin refuses a value that would not read as typed", () => {
    expect(validatePressTourSetting("press_trial_daily_usd", "50")).toBeNull();
    expect(validatePressTourSetting("press_trial_daily_usd", "fifty")).toMatch(/US dollars/);
    expect(validatePressTourSetting("press_trial_daily_usd", "5000")).toMatch(/from 0 to 1000/);
    expect(validatePressTourSetting("press_reshoot_user_30d", "6")).toBeNull();
    expect(validatePressTourSetting("press_reshoot_user_30d", "6.5")).toMatch(/whole number/);
    expect(validatePressTourSetting("press_tour_plan_list", "basic,elite")).toBeNull();
    expect(validatePressTourSetting("press_tour_plan_list", "0")).toBeNull();
    expect(validatePressTourSetting("press_tour_plan_list", "elite,studo")).toMatch(/plan ids/);
    expect(validatePressTourSetting("press_tour_plan_list", "0,elite")).toMatch(/plan ids/);
    expect(validatePressTourSetting("video_model", "anything")).toBeNull();
  });
});

describe("who: admins first", () => {
  const closed = { plans: [], trial: false };

  it("admins always; everyone else is refused while nothing is open", () => {
    expect(pressTourAllowed({ role: "admin", plan: "none" }, closed)).toEqual({ error: null, code: null, isAdmin: true, via: "admin" });
    const elite = pressTourAllowed({ plan: "elite", plan_status: "active" }, closed);
    expect(elite).toMatchObject({ error: PRESS_TOUR_NOT_OPEN, code: "notOpen", via: null });
    expect(pressTourAllowed(null, closed).code).toBe("notOpen");
  });

  it("a suspended account is refused, admin or not", () => {
    expect(pressTourAllowed({ role: "admin", status: "suspended" }, closed)).toMatchObject({ error: PRESS_TOUR_SUSPENDED, code: "suspended" });
    expect(pressTourAllowed({ plan: "elite", status: "suspended" }, { plans: ["elite"], trial: true }).code).toBe("suspended");
  });

  it("the listed plans, in good standing, once press_tour_plans is on", () => {
    const open = { plans: ["studio", "elite"], trial: false };
    expect(pressTourAllowed({ plan: "elite" }, open).via).toBe("plan");
    expect(pressTourAllowed({ plan: "studio", plan_status: "active" }, open).via).toBe("plan");
    expect(pressTourAllowed({ plan: "elite", plan_status: "canceled" }, open)).toMatchObject({ error: PRESS_TOUR_NEEDS_PLAN, code: "needsPlan" });
    expect(pressTourAllowed({ plan: "basic", plan_status: "active" }, open).code).toBe("needsPlan");
    expect(pressTourAllowed({ plan: "none" }, open).code).toBe("needsPlan");
    expect(hasPressTourPlan({ plan: "none" }, ["none"])).toBe(false);
  });

  it("the trial is for accounts WITHOUT a Press Tour plan (v2 N8)", () => {
    const open = { plans: ["elite"], trial: true };
    expect(pressTourAllowed({ plan: "none" }, open).via).toBe("trial");
    expect(pressTourAllowed({ plan: "basic", plan_status: "active" }, open).via).toBe("trial");
    expect(pressTourAllowed({ plan: "elite", plan_status: "active" }, open).via).toBe("plan");
    expect(pressTourAllowed({ role: "admin" }, open).via).toBe("admin");
  });

  it("the switches decide the openings: no plan list without press_tour_plans", () => {
    const settings = settingsFromRows([{ key: "press_tour_plan_list", value: "elite" }]);
    const on = (...keys: string[]) => switchesFromRows(["press_tour", ...keys].map((key) => ({ key, enabled: true })));
    expect(pressTourOpenings(on(), settings)).toEqual({ plans: [], trial: false });
    expect(pressTourOpenings(on("press_tour_plans"), settings)).toEqual({ plans: ["elite"], trial: false });
    expect(pressTourOpenings(on("press_tour_trial"), settings)).toEqual({ plans: [], trial: true });
  });
});

describe("a confirmed email before any paid call", () => {
  it("only a set email_confirmed_at passes", () => {
    expect(pressTourEmailError({ email_confirmed_at: "2026-09-25T10:00:00Z" })).toBeNull();
    for (const u of [null, undefined, {}, { email_confirmed_at: null }, { email_confirmed_at: "" }, { email_confirmed_at: true }]) {
      expect(pressTourEmailError(u as { email_confirmed_at?: unknown } | null)).toBe(PRESS_TOUR_CONFIRM_EMAIL);
    }
  });
});
