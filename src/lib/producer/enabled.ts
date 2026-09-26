import type { SupabaseClient } from "@supabase/supabase-js";
import { PLAN_CHAT_UNIT_LIMITS, type PlanId } from "../plans";

// Whether the Producer exists, and for whom — the live/enabled.ts shape.
//
// Three levels, every one failing CLOSED, because this spends Anthropic
// tokens on every turn and a lookup that errors must never switch it on:
//   1. PRODUCER_DISABLED=1 in the environment, checked before any database
//      call so it still works when the database is what's wrong.
//   2. The Anthropic key it cannot run without.
//   3. feature_flags.producer, inserted ON by supabase/applied/2026-09-24/producer.sql.
//
// WHO is a second switch (operator, 2026-09-24: "Build v1 now, admins
// only"): admins always; `producer_elite` (inserted OFF) opens it to Elite
// once the admin runs have measured what a turn really costs. And one
// account at a time (2026-09-26, operator: "Give me an option to grant users
// access to The assistant in the admin area"): profiles.producer_access,
// set from the admin's user page, opens it to that account whatever its plan
// and whatever producer_elite says (supabase/applied/2026-09-26/producer-access.sql).
export async function isProducerEnabled(supabase: SupabaseClient): Promise<boolean> {
  if (process.env.PRODUCER_DISABLED === "1") return false;
  if (!process.env.ANTHROPIC_API_KEY) return false;
  return flagOn(supabase, "producer");
}

export async function isProducerOpenToElite(supabase: SupabaseClient): Promise<boolean> {
  return flagOn(supabase, "producer_elite");
}

async function flagOn(supabase: SupabaseClient, key: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("feature_flags")
      .select("enabled")
      .eq("key", key)
      .maybeSingle<{ enabled: boolean }>();
    if (error || !data) return false;
    return data.enabled === true;
  } catch {
    return false;
  }
}

export const PRODUCER_SUSPENDED = "This account is suspended.";
// Said to people who don't have it (or no longer do): the product's own name.
export const PRODUCER_NOT_OPEN = "Aly isn't open to your account yet.";
export const PRODUCER_NEEDS_ELITE = "Aly is part of the Elite plan.";
export const PRODUCER_UNAVAILABLE = "Your assistant is switched off for the moment.";

export type ProducerProfile = {
  plan?: unknown;
  plan_status?: unknown;
  role?: unknown;
  status?: unknown;
  /** Granted by an admin (readProducerGrant): read on its own, never in the profile's own select. */
  producer_access?: unknown;
} | null | undefined;

/**
 * Whether an admin granted this account the Producer. Read on its own, so a
 * profile read never names the column: before producer-access.sql runs the
 * column is missing, this read errors, and it answers "not granted" — the
 * way every Producer switch fails, closed — while the rest of the page reads
 * as before.
 */
export async function readProducerGrant(client: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const { data, error } = await client
      .from("profiles")
      .select("producer_access")
      .eq("id", userId)
      .maybeSingle<{ producer_access: boolean }>();
    if (error || !data) return false;
    return data.producer_access === true;
  } catch {
    return false;
  }
}

/**
 * Who may use the Producer: admins always; an account an admin granted it
 * to (producer_access), whatever its plan; with `producer_elite` on, Elite
 * accounts whose subscription is in good standing (NULL passes — a comped
 * plan never had a plan_status, the same rule as the chat route). A
 * suspended account never.
 */
export function producerAllowed(
  profile: ProducerProfile,
  openToElite: boolean,
): { error: string | null; isAdmin: boolean; granted: boolean } {
  if (profile?.status === "suspended") return { error: PRODUCER_SUSPENDED, isAdmin: false, granted: false };
  const isAdmin = profile?.role === "admin";
  if (isAdmin) return { error: null, isAdmin, granted: false };
  if (profile?.producer_access === true) return { error: null, isAdmin, granted: true };
  if (!openToElite) return { error: PRODUCER_NOT_OPEN, isAdmin, granted: false };
  const inGoodStanding = (profile?.plan_status ?? null) === null || profile?.plan_status === "active";
  if (profile?.plan === "elite" && inGoodStanding) return { error: null, isAdmin, granted: false };
  return { error: PRODUCER_NEEDS_ELITE, isAdmin, granted: false };
}

export type ProducerAccessState =
  | "suspended"
  | "admin"
  | "granted"
  | "elite"
  | "elite-closed"
  | "off";

/**
 * Why this account has the Producer, or why not, for the admin's user page:
 * the order producerAllowed decides in (a test holds the two together).
 */
export function producerAccessState(user: {
  status?: unknown;
  role?: unknown;
  plan?: unknown;
  plan_status?: unknown;
  producer_access?: unknown;
}, openToElite: boolean): ProducerAccessState {
  if (user.status === "suspended") return "suspended";
  if (user.role === "admin") return "admin";
  if (user.producer_access === true) return "granted";
  const eliteInGoodStanding =
    user.plan === "elite" && ((user.plan_status ?? null) === null || user.plan_status === "active");
  if (eliteInGoodStanding) return openToElite ? "elite" : "elite-closed";
  return "off";
}

/**
 * The assistant allowance a Producer turn meters against: Elite's for an
 * admin (whatever test plan the account holds) and for a granted account (a
 * grant must work on any plan, a free one included); otherwise the plan's own.
 */
export function producerUnitCap(access: { isAdmin: boolean; granted: boolean }, plan: unknown): number {
  if (access.isAdmin || access.granted) return PLAN_CHAT_UNIT_LIMITS.elite;
  return PLAN_CHAT_UNIT_LIMITS[((plan as string | null) ?? "none") as PlanId] ?? 0;
}

/**
 * Whether this person's pages carry the Producer's lamp: admins, a granted
 * account, and Elite in good standing once `producer_elite` is on, with the
 * Producer switched on — the route's own rule (producerAllowed). The grant
 * comes in on the profile (readProducerGrant). Lifted out of the app
 * layout (Helios Cut 2, step 12, 2026-09-25) so a set's page can ask the
 * same question before its chat offers "Ask the Producer": the button is
 * offered only where the lamp it opens is on the page. Eligibility first,
 * so every other account skips the flag reads.
 */
export async function producerVisible(supabase: SupabaseClient, profile: ProducerProfile, isAdmin: boolean): Promise<boolean> {
  const granted = !isAdmin && profile?.status !== "suspended" && profile?.producer_access === true;
  const eligible = isAdmin || granted || (profile?.plan === "elite" && !producerAllowed(profile, true).error);
  if (!eligible) return false;
  if (!isAdmin && !granted && !(await isProducerOpenToElite(supabase))) return false;
  return isProducerEnabled(supabase);
}
