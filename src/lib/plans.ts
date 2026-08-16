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
// Monthly cap on Prompt Studio assists (Enhance, and the image-to-prompt
// read).
//
// Same reasoning as PLAN_REFERENCE_IMAGE_LIMITS above, and deliberately NOT
// priced in credits: an assist costs a fraction of a cent (one Claude call,
// or one vision call), while a credit is worth ~EUR1.90 of revenue. Charging
// credits for it would make people hesitate before using the one feature that
// makes their PAID generations land first time — the exact opposite of what
// it's for. A cap costs nothing to normal use and bounds the tail.
//
// The tail is the real reason this exists at all: an assist writes no
// generations row, so it bypasses both the credit meter and the 3-second
// cooldown. Without a cap the endpoint is a free Claude proxy for anyone with
// an account and a script.
//
// Elite is uncapped on purpose — at EUR499 the assist cost is rounding error,
// and "unlimited" is a real thing to sell.
export const PLAN_PROMPT_ASSIST_LIMITS = {
  none: 0,
  starter: 40,
  growth: 150,
  studio: 600,
  elite: Number.POSITIVE_INFINITY,
} as const satisfies Record<PlanId, number>;

// What a trial account gets, in total rather than per period (a free account
// has no billing anchor to reset against).
//
// Ten, because the free tier's whole job is to produce five generations good
// enough to convert — and a weak first prompt is the most common way that
// fails. Two assists per free generation is enough to learn the habit.
export const FREE_PROMPT_ASSIST_LIMIT = 10;

export const PLAN_REFERENCE_IMAGE_LIMITS = {
  none: 0,
  starter: 30,
  growth: 75,
  studio: 200,
  elite: 400,
} as const satisfies Record<PlanId, number>;
