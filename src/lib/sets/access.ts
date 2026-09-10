import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isSetsEnabled } from "@/lib/sets/enabled";
import { setBuildsMonthlyLimit, setsEligible } from "@/lib/sets/set-config";
import { SETS_NOT_OPEN, SETS_SESSION_EXPIRED, SETS_SUSPENDED, SETS_UNAVAILABLE } from "@/lib/sets/messages";

// Who may touch Sets, checked on the server in EVERY read and action — the
// page hiding a button is not a check (2026-09-10). Signed in, the switch
// on (enabled.ts), not suspended, and eligible (admins only in Phase 1).

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
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: SETS_SESSION_EXPIRED };
  if (!(await isSetsEnabled(supabase))) return { error: SETS_UNAVAILABLE };
  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, role, status, current_period_start")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profile?.status === "suspended") return { error: SETS_SUSPENDED };
  const plan = (profile?.plan as string | null) ?? "none";
  const isAdmin = profile?.role === "admin";
  if (!setsEligible(plan, isAdmin)) return { error: SETS_NOT_OPEN };
  return {
    error: null,
    supabase,
    userId: data.user.id,
    plan,
    isAdmin,
    periodStart: (profile?.current_period_start as string | null) ?? null,
    monthlyLimit: setBuildsMonthlyLimit(plan, isAdmin),
  };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
