// Helios on the pricing page (launch prep, 2026-09-19). The doc's own rule
// (docs/ASTRA_SETS.md §4, set-config.ts): the pricing copy must say what
// each plan gets BEFORE SETS_OPEN_TO_PLANS flips — and must not advertise a
// feature nobody can buy while it is off (pricing.ts's own warning about a
// paid bullet with no implementation). So the bullets are written now, in
// every locale, and appear on the cards only when the switch is on: the
// flip commit turns one constant and the pricing page says the rest.
//
// The numbers come from the same table the server enforces
// (SET_BUILDS_MONTHLY_LIMITS), so the copy can never drift from the cap.
// Takes and films are every paid plan's (setTakesEligible, the operator's
// 2026-09-19 "Open to all plans"), so the one bullet says the whole of it.

import { formatMsg } from "../i18n/format";
import { SETS_OPEN_TO_PLANS, SET_BUILDS_MONTHLY_LIMITS } from "./set-config";
import type { PlanId } from "../plans";

type Words = { heliosSetsOne: string; heliosSets: string };

/** The pure rule, testable in both states of the switch. */
export function heliosPlanFeaturesWhen(open: boolean, plan: string, words: Words): string[] {
  if (!open) return [];
  const n = SET_BUILDS_MONTHLY_LIMITS[plan as PlanId] ?? 0;
  if (n <= 0) return [];
  return [n === 1 ? words.heliosSetsOne : formatMsg(words.heliosSets, { n })];
}

/** What a plan's pricing card appends for Helios: nothing until the launch commit flips the switch. */
export function heliosPlanFeatures(plan: string, words: Words): string[] {
  return heliosPlanFeaturesWhen(SETS_OPEN_TO_PLANS, plan, words);
}
