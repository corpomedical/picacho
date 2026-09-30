// The rule Sets apply to a person's profile, once the switch is on
// (2026-09-11): not suspended, eligible (set-config.ts setsEligible —
// admins only in Phase 1), and a plan in good standing. One function, so
// the two places that ask it cannot drift apart: setsAccess() (access.ts),
// which asks for the person signed in, and the finisher (finisher.ts),
// which has no session and asks for the owner of each build it collects.
//
// Relative imports only: the test suite and the finisher's tests load it
// as it is.

import { planInGoodStanding } from "../plans";
import { setsEligible } from "./set-config";
import { SETS_NOT_OPEN, SETS_PAYMENT_FAILED, SETS_PLAN_INACTIVE, SETS_SUSPENDED } from "./messages";

/** The columns the rule reads. A person with no profile row is simply not eligible. */
export type SetsProfile = { plan?: unknown; role?: unknown; status?: unknown; plan_status?: unknown } | null | undefined;

export function setsAccessForProfile(
  profile: SetsProfile,
): { error: string } | { error: null; plan: string; isAdmin: boolean } {
  if (profile?.status === "suspended") return { error: SETS_SUSPENDED };
  const plan = (profile?.plan as string | null | undefined) ?? "none";
  const isAdmin = profile?.role === "admin";
  if (!setsEligible(plan, isAdmin)) return { error: SETS_NOT_OPEN };
  // The plan's payments (2026-09-30, operator: "Fix both holes now"). Until
  // today this rule read the plan's name alone, so an account whose card had
  // failed (plan_status past_due: Stripe keeps the plan while it retries) kept
  // its monthly set builds, Astra edits and Angle Stage proxies, and Helios's
  // free prep work, while its credits were already paused. Paused here the
  // same way (plans.ts planInGoodStanding), and open again the moment Stripe
  // says the plan is active. Admins keep access for support.
  if (!isAdmin && !planInGoodStanding(profile?.plan_status)) {
    return { error: profile?.plan_status === "past_due" ? SETS_PAYMENT_FAILED : SETS_PLAN_INACTIVE };
  }
  return { error: null, plan, isAdmin };
}
