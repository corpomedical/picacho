// Monthly credit allowances (2026-08-19 restructure, operator-approved).
//
// Prices didn't move — the credits multiplied (10→30, 40→140, 150→550,
// 300→1000) and a $9 Basic tier was added underneath. The old numbers priced
// a default 1-credit clip at ~$1.90, far above the competitive band; the new
// ones land it at ~$0.50–0.75. Two rules shaped the exact figures:
//
//   1. The per-credit rate must IMPROVE monotonically up-tier:
//      basic $0.75 → starter ~$0.63 → growth ~$0.56 → studio ~$0.54 →
//      elite ~$0.50. The previous table quietly inverted at the top
//      (Studio $1.99/credit was WORSE than Growth's $1.98, Elite barely
//      better) — upgrading for volume made the unit price worse, which is
//      backwards.
//   2. Basic deliberately has the WORST rate in the table. It exists to make
//      the first paid click cheap, not to be good value — the honest upsell
//      into Starter is "same credits cost less per credit".
//
// Existing subscribers: their Stripe price is untouched and these limits
// apply the moment this deploys — the change only ever ADDS credits to what
// a live subscription grants, so no migration or grandfathering is needed.
export const PLAN_LIMITS = {
  none: 0,
  basic: 12,
  starter: 30,
  growth: 140,
  studio: 550,
  // Cut 1000 -> 600 on 2026-08-30. The old figure cost $339.60/month in
  // provider spend against $404.66 of net revenue at full price, so the
  // ENTIRE gross margin on Elite was $65 — and the 15% annual discount gave
  // away $60.86 of it, which is why Elite annual was earning 1.2%. At 1000
  // credits no discount worked: even 0% off only reached 16.1%, and 20% off
  // was margin-NEGATIVE. The allowance was the broken part, not the discount.
  //
  // 600 puts monthly at 49.6% and annual (now 20% off) at 37.0%, and lets the
  // ADVERTISED discount go up rather than down — 20% costs 40% of margin at
  // this allowance where 15% cost 94% at the old one.
  //
  // Existing subscribers keep the Stripe price they signed up on, and this
  // limit applies the moment it deploys — so unlike the 2026-08-19 increase,
  // this one REDUCES what a live subscription grants. There are no Elite
  // subscribers today (checked 2026-08-30), which is why it can be done as a
  // straight change rather than a grandfathering exercise. If that is ever
  // untrue again, grandfather before touching this number.
  elite: 600,
} as const;

export const PLAN_LABELS = {
  none: "No active plan",
  basic: "Basic",
  starter: "Starter",
  growth: "Growth",
  studio: "Studio",
  elite: "Elite",
} as const;

export type PlanId = keyof typeof PLAN_LIMITS;

// Free tier: ONE free generation per day (operator-approved 2026-08-19),
// replacing the old "5 generations, once, lifetime" trial.
//
// Daily rather than a lifetime pool because the product's whole claim is
// CONSISTENCY ACROSS generations — and the lifetime five let someone burn
// all five in ten minutes, half of them while still learning to describe
// what they want, and never come back. One a day turns the same budget into
// a reason to return: by the third visit they've watched the same character
// hold up across days, which is the thing being sold.
//
// Use-it-or-lose-it, no rollover. The slot is a timestamp
// (profiles.free_generation_last_at, spent atomically via
// spend_daily_free_generation — see supabase/pending-2026-08-19/
// daily-trial.sql), not a balance, so there is nothing to hoard and a
// returning burst can never cost more than one render.
//
// Worst-case cost: ~$0.29 per day per ACTIVE free user (the pinned model's
// default clip is 1 credit at the ~$0.28 cost basis) — and only on days
// they actually generate, so the spend is bounded and scales with
// engagement rather than with signups.
//
// The trial is counted in GENERATIONS, not credits, and is restricted to
// the cheapest model (below) — Veo costs 12 credits for 8 seconds, so a
// free allowance denominated in credits with free model choice would make
// each free day cost 12x the budget.

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
// Deliberately NOT priced in credits. A credit sells for ~€0.50–0.75 since
// the 2026-08-19 restructure (it was ~€1.90 when this cap was designed)
// against a ~$0.17 photo cost — still a multiple-x markup on a setup
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
//   basic ~EUR1.60 of EUR9   · starter ~EUR4.60 of EUR19
//   growth ~EUR11.60 of EUR79 · studio ~EUR31 of EUR299
//   elite ~EUR62 of EUR499
// Monthly cap on Prompt Studio assists (Enhance, and the image-to-prompt
// read).
//
// Same reasoning as PLAN_REFERENCE_IMAGE_LIMITS above, and deliberately NOT
// priced in credits: an assist costs a fraction of a cent (one Claude call,
// or one vision call), while a credit sells for ~€0.50–0.75. Charging
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
// How many FAILED generations an account may have refunded in a rolling 24
// hours before failures start costing a credit like any other generation.
//
// Refunding our own failures is right — it is what stops chargebacks and it
// is what an honest product does. But an unlimited refund is an unlimited
// budget: nothing else in the system caps failures, so one account could
// fail continuously and spend real provider money at zero cost to itself.
// This is the backstop for that, not a punishment: the numbers are far above
// anything a real user hits, because a genuine provider outage should never
// leave a paying customer out of pocket.
//
// Deliberately a rolling window rather than a calendar day, so it can't be
// reset by waiting for midnight, and deliberately one function so the whole
// policy is tunable in one place while we study the real numbers.
export function refundedFailureDailyCap(plan: PlanId): number {
  // Free accounts get a flat allowance — their plan limit is 0, so a
  // multiple of it would be 0 and every trial failure would cost them.
  if (plan === "none") return 10;
  return Math.max(10, Math.min(PLAN_LIMITS[plan] ?? 0, 60));
}

export const PLAN_PROMPT_ASSIST_LIMITS = {
  none: 0,
  // Half of Starter's, mirroring how Basic sits under Starter everywhere
  // else (2026-08-19): a real allowance for a $9 account, with room left
  // for "upgrade and stop counting" to mean something.
  basic: 20,
  starter: 40,
  growth: 150,
  studio: 600,
  elite: Number.POSITIVE_INFINITY,
} as const satisfies Record<PlanId, number>;

// What a trial account gets, in total rather than per period (a free account
// has no billing anchor to reset against).
//
// Ten, because the free tier's whole job is to produce free generations good
// enough to convert — and a weak first prompt is the most common way that
// fails. Ten covers the first several days of the daily trial (2026-08-19)
// with an assist or two per generation — enough to learn the habit.
// Deliberately unchanged by the daily-trial switch: still a lifetime total.
export const FREE_PROMPT_ASSIST_LIMIT = 10;

export const PLAN_REFERENCE_IMAGE_LIMITS = {
  none: 0,
  // A third of Starter's (2026-08-19, added with the Basic tier). Ten still
  // covers building several characters — the typical account uses a handful
  // of these ever — while keeping the worst-case spend (~$1.70) trivial
  // against the $9 price.
  basic: 10,
  starter: 30,
  growth: 75,
  studio: 200,
  elite: 400,
} as const satisfies Record<PlanId, number>;
