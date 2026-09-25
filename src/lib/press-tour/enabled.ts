import type { SupabaseClient } from "@supabase/supabase-js";
import { PLAN_LIMITS } from "../plans";

// Whether Press Tour exists, and for whom: the live/enabled.ts shape.
//
// Three levels, every one failing CLOSED, because Press Tour spends provider
// money on every import, check and render, and a lookup that errors must
// never switch it on:
//   1. PRESS_TOUR_DISABLED=1 in the environment, checked before any database
//      call so it still works when the database is what's wrong.
//   2. The provider keys it cannot run without (PRESS_TOUR_REQUIRED_KEYS).
//   3. feature_flags.press_tour, inserted OFF by
//      supabase/pending/press-tour-01-flags.sql. Every other Press Tour switch
//      reads as off while this one is off.
//
// WHO is decided by pressTourAllowed below: admins first (operator's rule),
// then the plans named in the setting press_tour_plan_list once
// press_tour_plans is on, then the free trial ad for accounts without a
// Press Tour plan once press_tour_trial is on (Spec v2 N8). A missing row,
// a malformed value or a failed read is OFF / '0' / "no plan".
//
// Alias-free (vitest has no '@/'): enabled.test.ts imports it as it is.

/** Every key Press Tour calls a provider with: renders, stills, planning, label reading and the product checks. */
export const PRESS_TOUR_REQUIRED_KEYS = [
  "FAL_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_VISION_API_KEY",
  "GEMINI_API_KEY",
] as const;

/** The keys that are not set; empty means Press Tour can run. For Admin, and for the kill switch below. */
export function pressTourMissingKeys(env: Record<string, string | undefined> = process.env): string[] {
  return PRESS_TOUR_REQUIRED_KEYS.filter((k) => !env[k]);
}

/** Level 1 and 2: the environment alone, no database. */
export function pressTourEnvReady(env: Record<string, string | undefined> = process.env): boolean {
  return env.PRESS_TOUR_DISABLED !== "1" && pressTourMissingKeys(env).length === 0;
}

// ---------------------------------------------------------------------
// The switches: exactly the rows press-tour-01-flags.sql inserts (pinned by
// enabled.test.ts), each inserted OFF.
// ---------------------------------------------------------------------
export const PRESS_TOUR_FLAGS = [
  "press_tour",
  "press_tour_posting",
  "press_post_tiktok_direct",
  "press_post_meta",
  "press_trends",
  "press_tour_plans",
  "product_lock_person_reshoot",
  "press_post_x",
  "press_tour_trial",
  "press_tour_mcp",
  "product_lock_calibrated",
  "product_lock_reshoot",
  "product_lock_refund",
] as const;
export type PressTourFlag = (typeof PRESS_TOUR_FLAGS)[number];
export type PressTourSwitches = Record<PressTourFlag, boolean>;

const ALL_OFF = (): PressTourSwitches =>
  Object.fromEntries(PRESS_TOUR_FLAGS.map((k) => [k, false])) as PressTourSwitches;

/**
 * Every Press Tour switch in one read. All false when the environment is not
 * ready, when the read fails, or while `press_tour` itself is off: a later
 * switch (posting, trial, MCP...) never opens anything on its own.
 */
export async function readPressTourSwitches(supabase: SupabaseClient): Promise<PressTourSwitches> {
  const out = ALL_OFF();
  if (!pressTourEnvReady()) return out;
  try {
    const { data, error } = await supabase
      .from("feature_flags")
      .select("key, enabled")
      .in("key", PRESS_TOUR_FLAGS as unknown as string[]);
    if (error || !Array.isArray(data)) return out;
    return switchesFromRows(data);
  } catch {
    return out;
  }
}

/** Pure: the switches from feature_flags rows. Only `enabled === true` is on; nothing is on while press_tour is off. */
export function switchesFromRows(rows: readonly unknown[]): PressTourSwitches {
  const out = ALL_OFF();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const { key, enabled } = row as { key?: unknown; enabled?: unknown };
    if (typeof key === "string" && (PRESS_TOUR_FLAGS as readonly string[]).includes(key) && enabled === true) {
      out[key as PressTourFlag] = true;
    }
  }
  return out.press_tour ? out : ALL_OFF();
}

/** Whether Press Tour exists at all (the door, the Generate mode, the tools). */
export async function isPressTourEnabled(supabase: SupabaseClient): Promise<boolean> {
  if (!pressTourEnvReady()) return false;
  try {
    const { data, error } = await supabase
      .from("feature_flags")
      .select("enabled")
      .eq("key", "press_tour")
      .maybeSingle<{ enabled: boolean }>();
    if (error || !data) return false;
    return data.enabled === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------
// The settings: exactly the rows press-tour-01-flags.sql seeds (pinned by
// enabled.test.ts). Each seed does nothing: '0' is closed, off or "no plan";
// press_reshoot_user_30d '6' does nothing until a re-shoot switch is on and
// press_reshoot_daily_usd is above 0. A MISSING or malformed row reads as 0
// for every one of them, press_reshoot_user_30d included: absent means off.
//
// `max` is a typo guard for Admin (validatePressTourSetting), not a policy:
// raise it here if the operator ever needs more.
// ---------------------------------------------------------------------
export const PRESS_TOUR_SETTINGS = {
  press_tour_plan_list: { seed: "0", kind: "plans" },
  press_trial_daily_usd: { seed: "0", kind: "usd", max: 1000 },
  press_trial_daily_cap: { seed: "0", kind: "count", max: 2000 },
  press_reshoot_daily_usd: { seed: "0", kind: "usd", max: 500 },
  press_reshoot_user_30d: { seed: "6", kind: "count", max: 30 },
  press_x_daily_cap: { seed: "0", kind: "count", max: 5000 },
  product_lock_min_confidence: { seed: "0", kind: "count", max: 95 },
} as const;
export type PressTourSettingKey = keyof typeof PRESS_TOUR_SETTINGS;
type NumericSettingKey = Exclude<PressTourSettingKey, "press_tour_plan_list">;
export type PressTourSettings = Record<NumericSettingKey, number> & { press_tour_plan_list: PaidPlanId[] };

const SETTING_KEYS = Object.keys(PRESS_TOUR_SETTINGS) as PressTourSettingKey[];

export function isPressTourSettingKey(key: unknown): key is PressTourSettingKey {
  return typeof key === "string" && (SETTING_KEYS as string[]).includes(key);
}

/** The plans Press Tour can be opened to: every plan with a monthly allowance. */
export type PaidPlanId = Exclude<keyof typeof PLAN_LIMITS, "none">;
export const PAID_PLANS = (Object.keys(PLAN_LIMITS) as (keyof typeof PLAN_LIMITS)[]).filter(
  (p): p is PaidPlanId => PLAN_LIMITS[p] > 0,
);

/** '0' or '' = no plan; otherwise plan ids separated by commas. Unknown ids are left out (closed). */
export function parsePlanList(raw: unknown): PaidPlanId[] {
  if (typeof raw !== "string") return [];
  const out: PaidPlanId[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim().toLowerCase();
    if ((PAID_PLANS as string[]).includes(id) && !out.includes(id as PaidPlanId)) out.push(id as PaidPlanId);
  }
  return out;
}

function parseNumber(kind: "usd" | "count", max: number, raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  const shape = kind === "usd" ? /^\d{1,6}(\.\d{1,2})?$/ : /^\d{1,6}$/;
  if (!shape.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
}

/** Pure: one stored value as the code reads it. Malformed or out of range = 0 / no plan (closed). */
export function parsePressTourSetting(key: "press_tour_plan_list", raw: unknown): PaidPlanId[];
export function parsePressTourSetting(key: NumericSettingKey, raw: unknown): number;
export function parsePressTourSetting(key: PressTourSettingKey, raw: unknown): number | PaidPlanId[] {
  const spec = PRESS_TOUR_SETTINGS[key];
  if (spec.kind === "plans") return parsePlanList(raw);
  return parseNumber(spec.kind, spec.max, raw) ?? 0;
}

/** Pure: the settings from app_settings rows. A missing row reads as 0 / no plan. */
export function settingsFromRows(rows: readonly unknown[]): PressTourSettings {
  const byKey = new Map<string, unknown>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const { key, value } = row as { key?: unknown; value?: unknown };
    if (typeof key === "string") byKey.set(key, value);
  }
  const out = { press_tour_plan_list: parsePlanList(byKey.get("press_tour_plan_list")) } as PressTourSettings;
  for (const key of SETTING_KEYS) {
    if (key === "press_tour_plan_list") continue;
    out[key] = parsePressTourSetting(key, byKey.get(key));
  }
  return out;
}

/** Every Press Tour setting in one read; all 0 / no plan when the read fails. */
export async function readPressTourSettings(supabase: SupabaseClient): Promise<PressTourSettings> {
  try {
    const { data, error } = await supabase.from("app_settings").select("key, value").in("key", SETTING_KEYS);
    if (error || !Array.isArray(data)) return settingsFromRows([]);
    return settingsFromRows(data);
  } catch {
    return settingsFromRows([]);
  }
}

/**
 * For Admin > Settings (admin/actions.ts validateAppSetting should ask this
 * first): the error for a value that would not read as typed, or null. Only
 * answers for Press Tour keys; any other key gets null.
 */
export function validatePressTourSetting(key: string, value: string): string | null {
  if (!isPressTourSettingKey(key)) return null;
  const spec = PRESS_TOUR_SETTINGS[key];
  const v = value.trim();
  if (spec.kind === "plans") {
    if (v === "0") return null;
    const parts = v.split(",").map((p) => p.trim().toLowerCase());
    const ok = parts.length > 0 && parts.every((p) => (PAID_PLANS as string[]).includes(p));
    return ok ? null : `${key} must be 0 (no plan) or plan ids separated by commas, from: ${PAID_PLANS.join(", ")}.`;
  }
  if (parseNumber(spec.kind, spec.max, v) !== null) return null;
  return spec.kind === "usd"
    ? `${key} must be an amount in US dollars from 0 to ${spec.max}, at most 2 decimals (0 turns it off).`
    : `${key} must be a whole number from 0 to ${spec.max} (0 turns it off).`;
}

// ---------------------------------------------------------------------
// WHO.
// ---------------------------------------------------------------------
export type PressTourOpenings = {
  /** Plans with Press Tour: empty unless press_tour_plans is on. */
  plans: readonly string[];
  /** The free trial ad is open to accounts without a Press Tour plan. */
  trial: boolean;
};

/** Pure: who the switches and settings open Press Tour to, beyond admins. */
export function pressTourOpenings(switches: PressTourSwitches, settings: PressTourSettings): PressTourOpenings {
  return {
    plans: switches.press_tour_plans ? settings.press_tour_plan_list : [],
    trial: switches.press_tour_trial,
  };
}

export const PRESS_TOUR_SUSPENDED = "This account is suspended.";
export const PRESS_TOUR_NOT_OPEN = "Press Tour isn't open to your account yet.";
export const PRESS_TOUR_NEEDS_PLAN = "Press Tour isn't part of your plan yet.";
export const PRESS_TOUR_UNAVAILABLE = "Press Tour is switched off for the moment.";
export const PRESS_TOUR_CONFIRM_EMAIL = "Confirm your email address to use Press Tour.";

export type PressTourProfile = {
  plan?: unknown;
  plan_status?: unknown;
  role?: unknown;
  status?: unknown;
} | null | undefined;

export type PressTourAccess = {
  error: string | null;
  code: "suspended" | "notOpen" | "needsPlan" | null;
  isAdmin: boolean;
  /** How the account reaches Press Tour: its role, its plan, or the one free trial ad. */
  via: "admin" | "plan" | "trial" | null;
};

/** A listed plan in good standing (NULL passes: a comped plan never had a plan_status; the Producer's rule). */
export function hasPressTourPlan(profile: PressTourProfile, plans: readonly string[]): boolean {
  const plan = typeof profile?.plan === "string" ? profile.plan : "none";
  const inGoodStanding = (profile?.plan_status ?? null) === null || profile?.plan_status === "active";
  return plan !== "none" && plans.includes(plan) && inGoodStanding;
}

/**
 * Who may use Press Tour, once isPressTourEnabled says it exists: admins
 * always; with press_tour_plans on, the plans in press_tour_plan_list; with
 * press_tour_trial on, every other account, for its one free trial ad (the
 * trial's own claim decides whether that ad is still theirs to take).
 */
export function pressTourAllowed(profile: PressTourProfile, openings: PressTourOpenings): PressTourAccess {
  if (profile?.status === "suspended") return { error: PRESS_TOUR_SUSPENDED, code: "suspended", isAdmin: false, via: null };
  const isAdmin = profile?.role === "admin";
  if (isAdmin) return { error: null, code: null, isAdmin, via: "admin" };
  if (hasPressTourPlan(profile, openings.plans)) return { error: null, code: null, isAdmin, via: "plan" };
  if (openings.trial) return { error: null, code: null, isAdmin, via: "trial" };
  if (openings.plans.length > 0) return { error: PRESS_TOUR_NEEDS_PLAN, code: "needsPlan", isAdmin, via: null };
  return { error: PRESS_TOUR_NOT_OPEN, code: "notOpen", isAdmin, via: null };
}

/**
 * A confirmed email before any paid third-party call (critique #20): an
 * import, a still, a check. Reads the auth user (profiles cannot see it);
 * anything but a set email_confirmed_at is unconfirmed.
 */
export function pressTourEmailError(user: { email_confirmed_at?: unknown } | null | undefined): string | null {
  const at = user?.email_confirmed_at;
  return typeof at === "string" && at.length > 0 ? null : PRESS_TOUR_CONFIRM_EMAIL;
}
