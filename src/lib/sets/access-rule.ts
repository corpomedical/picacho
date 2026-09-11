// The rule Sets apply to a person's profile, once the switch is on
// (2026-09-11): not suspended, and eligible (set-config.ts setsEligible —
// admins only in Phase 1). One function, so the two places that ask it
// cannot drift apart: setsAccess() (access.ts), which asks for the person
// signed in, and the finisher (finisher.ts), which has no session and asks
// for the owner of each build it collects.
//
// Relative imports only: the test suite and the finisher's tests load it
// as it is.

import { setsEligible } from "./set-config";
import { SETS_NOT_OPEN, SETS_SUSPENDED } from "./messages";

/** The columns the rule reads. A person with no profile row is simply not eligible. */
export type SetsProfile = { plan?: unknown; role?: unknown; status?: unknown } | null | undefined;

export function setsAccessForProfile(
  profile: SetsProfile,
): { error: string } | { error: null; plan: string; isAdmin: boolean } {
  if (profile?.status === "suspended") return { error: SETS_SUSPENDED };
  const plan = (profile?.plan as string | null | undefined) ?? "none";
  const isAdmin = profile?.role === "admin";
  if (!setsEligible(plan, isAdmin)) return { error: SETS_NOT_OPEN };
  return { error: null, plan, isAdmin };
}
