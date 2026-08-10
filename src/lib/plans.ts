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

// Free tier: a one-time trial, not a monthly allowance.
//
// Five rather than three because the product's whole claim is CONSISTENCY
// ACROSS generations — that can't be seen in one image. Someone needs the
// same character three or four times to believe it, and the first attempt is
// often not what they pictured while they're still learning to describe what
// they want. Three only works if every attempt lands; five leaves room for
// one miss and still demonstrates the thing being sold.
//
// Costs roughly EUR1.50 per signup at ~EUR0.30/credit. At a 5% conversion to
// Starter that pays back in about two months and compounds after that.
//
// Note this is a count of GENERATIONS, not credits, and the free tier is
// restricted to the cheapest model (see FREE_TIER_VIDEO_MODEL_ID) — Veo costs
// 11 credits for 8 seconds, so a free allowance denominated in credits with
// free model choice would let a single signup cost EUR3+.
export const FREE_GENERATION_LIMIT = 5;

// The only video model a free-tier account may use. Also the fastest, so a
// trial user sees a result sooner — which matters more at trial than quality
// does.
export const FREE_TIER_VIDEO_MODEL_ID = "kling";

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
