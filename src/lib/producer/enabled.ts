import type { SupabaseClient } from "@supabase/supabase-js";

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
// once the admin runs have measured what a turn really costs.
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
export const PRODUCER_NOT_OPEN = "The Producer isn't open to your account yet.";
export const PRODUCER_NEEDS_ELITE = "The Producer is part of the Elite plan.";
export const PRODUCER_UNAVAILABLE = "The Producer is switched off for the moment.";

export type ProducerProfile = {
  plan?: unknown;
  plan_status?: unknown;
  role?: unknown;
  status?: unknown;
} | null | undefined;

/**
 * Who may use the Producer: admins always; with `producer_elite` on, Elite
 * accounts whose subscription is in good standing (NULL passes — a comped
 * plan never had a plan_status, the same rule as the chat route).
 */
export function producerAllowed(
  profile: ProducerProfile,
  openToElite: boolean,
): { error: string | null; isAdmin: boolean } {
  if (profile?.status === "suspended") return { error: PRODUCER_SUSPENDED, isAdmin: false };
  const isAdmin = profile?.role === "admin";
  if (isAdmin) return { error: null, isAdmin };
  if (!openToElite) return { error: PRODUCER_NOT_OPEN, isAdmin };
  const inGoodStanding = (profile?.plan_status ?? null) === null || profile?.plan_status === "active";
  if (profile?.plan === "elite" && inGoodStanding) return { error: null, isAdmin };
  return { error: PRODUCER_NEEDS_ELITE, isAdmin };
}

/**
 * Whether this person's pages carry the Producer's lamp: admins, and Elite
 * in good standing once `producer_elite` is on, with the Producer switched
 * on — the route's own rule (producerAllowed). Lifted out of the app
 * layout (Helios Cut 2, step 12, 2026-09-25) so a set's page can ask the
 * same question before its chat offers "Ask the Producer": the button is
 * offered only where the lamp it opens is on the page. Eligibility first,
 * so every other account skips the flag reads.
 */
export async function producerVisible(supabase: SupabaseClient, profile: ProducerProfile, isAdmin: boolean): Promise<boolean> {
  const eligible = isAdmin || (profile?.plan === "elite" && !producerAllowed(profile, true).error);
  if (!eligible) return false;
  if (!isAdmin && !(await isProducerOpenToElite(supabase))) return false;
  return isProducerEnabled(supabase);
}
