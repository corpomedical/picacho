export const PLAN_LIMITS = {
  none: 0,
  starter: 10,
  growth: 40,
  studio: 150,
  elite: 300,
} as const;

export const PLAN_LABELS = {
  none: "No active plan",
  starter: "Starter",
  growth: "Growth",
  studio: "Studio",
  elite: "Elite",
} as const;

export type PlanId = keyof typeof PLAN_LIMITS;

// Monthly cap on AI-generated character reference photos.
//
// These cost real money (~$0.17 each on GPT Image) but consumed nothing
// before 2026-08-10 — every paid plan had them unlimited and free, which the
// pricing analysis flagged as the largest open money leak: a Starter
// subscriber on EUR19 generating 200 of them costs more than they pay.
//
// Deliberately NOT priced in credits. A credit is worth ~EUR1.90 of revenue
// against a ~EUR0.15 cost, so charging one would be an 11x markup on a setup
// action — and setup is the moment you most want someone to succeed, not to
// feel metered. A cap leaves normal use completely unaffected while bounding
// the tail: a typical account generates a handful of these ever, so nobody
// legitimate will ever see these numbers.
//
// Monthly rather than daily on purpose. Character setup happens in bursts —
// someone sits down once and builds five characters — and a daily cap blocks
// exactly that session while doing nothing about a steady drip. Counted
// against the account's real billing period, so it resets in step with
// credits (see reference_image_generations).
//
// Worst-case cost if an account maxes its cap, against plan revenue:
//   starter ~EUR4.60 of EUR19 · growth ~EUR11.60 of EUR79
//   studio  ~EUR31 of EUR299  · elite  ~EUR62 of EUR499
export const PLAN_REFERENCE_IMAGE_LIMITS = {
  none: 0,
  starter: 30,
  growth: 75,
  studio: 200,
  elite: 400,
} as const satisfies Record<PlanId, number>;
