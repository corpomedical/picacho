import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { verifiedClaims } from "@/lib/supabase/claims";
import { setsAccessForProfile } from "@/lib/sets/access-rule";
import { isSetsEnabled } from "@/lib/sets/enabled";
import { setBuildsMonthlyLimit } from "@/lib/sets/set-config";
import { SETS_SESSION_EXPIRED, SETS_UNAVAILABLE } from "@/lib/sets/messages";

// Who may touch Sets, checked on the server in EVERY read and action — the
// page hiding a button is not a check (2026-09-10). Signed in, the switch
// on (enabled.ts), not suspended, eligible (admins only in Phase 1), and a
// plan whose payments are in good standing (2026-09-30).
// The last two are access-rule.ts's, the one rule the finisher applies too
// to the owner of every build it collects.

export type SetsAccess =
  | { error: string }
  | {
      error: null;
      supabase: SupabaseClient;
      userId: string;
      plan: string;
      isAdmin: boolean;
      periodStart: string | null;
      monthlyLimit: number;
    };

export async function setsAccess(): Promise<SetsAccess> {
  const supabase = await createClient();
  // Who (2026-09-30, operator: "Pushed, measure it" — live, this took ~1 s): the session's signed claims,
  // verified locally (lib/supabase/claims.ts) — the proxy's and the /app layout's trust model; the proxy checks
  // profiles.status on every /app request, server actions included (they post to their /app route), and the
  // profile read below checks it again. It replaced a getUser() round trip to the auth server. Then the switch
  // and the profile, at once.
  const claims = await verifiedClaims(supabase);
  const userId = typeof claims?.sub === "string" ? claims.sub : null;
  if (!userId) return { error: SETS_SESSION_EXPIRED };
  const [enabled, { data: profile }] = await Promise.all([
    isSetsEnabled(supabase),
    supabase.from("profiles").select("plan, plan_status, role, status, current_period_start").eq("id", userId).maybeSingle(),
  ]);
  if (!enabled) return { error: SETS_UNAVAILABLE };
  const rule = setsAccessForProfile(profile);
  if (rule.error !== null) return { error: rule.error };
  const { plan, isAdmin } = rule;
  return {
    error: null,
    supabase,
    userId,
    plan,
    isAdmin,
    periodStart: (profile?.current_period_start as string | null) ?? null,
    monthlyLimit: setBuildsMonthlyLimit(plan, isAdmin),
  };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
