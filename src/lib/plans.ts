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
  // 600 -> 750 on 2026-08-31 (operator-approved, second pass). The
  // 2026-08-30 cut to 600 fixed the margin but left Elite the WORST
  // per-credit rate in the table — $0.832/credit against Studio's $0.544,
  // 53% more for the bigger plan, which the day's full inspection flagged:
  // anyone who does the division sees Studio is the better deal.
  //
  // Same arithmetic convention as that cut ($0.3396/credit worst-case
  // provider mix, $404.66 net monthly / $323.57 net annual-equivalent at
  // full price): 750 credits costs $254.70, putting monthly at 37% and
  // annual (20% off) at 21%, and narrows the per-credit gap to 22%. Going
  // all the way to a ladder-perfect 950 was considered and REJECTED with
  // the numbers on the table: it prices annual Elite at a 0.3% margin —
  // a bet that heavy users under-use, on the one plan bought by heavy users.
  //
  // No Elite subscribers exist (checked 2026-08-30, unchanged since), so no
  // grandfathering. If that is ever untrue, grandfather before touching this.
  elite: 750,
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

// Chat-agent budget per billing period, in 2-cent units (2026-08-30).
// See lib/agent/prices.ts for what a unit is and how a turn is priced.
//
// Sized against this file's own precedent: a worst-case spend that stays a
// sane fraction of the plan price, the way PLAN_REFERENCE_IMAGE_LIMITS was
// sized (~$1.70 of images against a $9 plan). Held at roughly a tenth of
// each price so the share is the SAME on every tier — the first draft of
// this table ran from 10% to 24% depending on the plan, which meant Starter
// subscribers were quietly given twice the chat budget, per dollar, that
// Studio subscribers were.
//
//   plan     units   worst case   price   share
//   basic       45       $0.90       $9    10%
//   starter     95       $1.90      $19    10%
//   growth     400       $8.00      $79    10%
//   studio   1,500      $30.00     $299    10%
//   elite    2,500      $50.00     $499    10%
//
// Worst case is what it says: every unit spent, every month. Real use will
// be a fraction of it, and agent_usage.cost_usd exists so these can be
// re-cut against evidence instead of arithmetic.
//
// What that buys, MEASURED 2026-08-31 (see lib/agent/prices.ts for the raw
// numbers): a Faster turn settles at 1 unit and a Smarter turn at 2. So the
// allowances are roughly 25 questions free, 45 on Basic, 95 on Starter, 400
// on Growth, 1,500 on Studio and 2,500 on Elite — halve those if someone
// runs entirely on Smarter.
//
// ELITE IS CAPPED, and that is a deliberate departure from
// PLAN_PROMPT_ASSIST_LIMITS above, where elite is POSITIVE_INFINITY. The
// reason is the warning already written there: an assist "writes no
// generations row, so it bypasses both the credit meter and the 3-second
// cooldown. Without a cap the endpoint is a free Claude proxy for anyone
// with an account and a script." A streaming chat turn is that same bypass
// with a bigger output budget. If a real Elite account ever approaches
// 2,500 units, raise this number on purpose rather than leaving the hole
// open by default.
export const PLAN_CHAT_UNIT_LIMITS = {
  none: 0,
  basic: 45,
  starter: 95,
  growth: 400,
  studio: 1500,
  elite: 2500,
} as const satisfies Record<PlanId, number>;

// The free tier's chat allowance is a LIFETIME total, not per period — a
// free account has no billing anchor to reset against, exactly as
// FREE_PROMPT_ASSIST_LIMIT explains for assists.
//
// Twenty-five units is roughly fifteen to twenty Faster messages (a cached
// Faster turn measures 1-2 units): about $0.50 per account, and Anthropic
// spend rather than fal spend, so it cannot eat the render balance. The free tier's job is to produce a first result good
// enough to convert, and the most common way that fails is a badly set up
// character and a blind first send — which is precisely what this agent is
// for. Faster mode only; Smarter is a paid capability.
export const FREE_CHAT_UNIT_LIMIT = 25;

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
