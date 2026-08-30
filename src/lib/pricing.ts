// Shared display data for the pricing page and (later) Stripe product setup.
// Keep this the single source of truth so the two never drift apart.
//
// Tier structure (changed 2026-08-12): storyboard + multi-image reference
// moved down from Elite to Studio so the $299 tier has a capability reason
// to exist, not just a bigger quota. Elite is now volume + priority + early
// access. The server-side gating in generations/actions.ts and
// workspace-data.ts mirrors this — change both together.
//
// Credits restructure (2026-08-19, operator-approved): monthly prices are
// unchanged but every tier's credits multiplied (see PLAN_LIMITS in plans.ts
// for the full rationale — per-credit rate now improves monotonically
// up-tier, and a default clip costs ~$0.50–0.75 instead of ~$1.90), and a $9
// Basic tier was added underneath Starter. `credits` here MUST stay equal to
// PLAN_LIMITS — this table is what the marketing pages print, PLAN_LIMITS is
// what the server enforces, and the two disagreeing is false advertising.

// annualPrice is the per-month equivalent when billed yearly (total charged
// = annualPrice * 12). Trimmed 2026-08-19 from ~25% off ("3 months free") to
// ~15% off, alongside the credit multiplication — the credits got 3-4x more
// generous, so the prepay discount no longer needs to carry the whole
// value story. Rounded to whole dollars, same convention as before:
// 9->8, 19->16, 79->67, 299->254, 499->424 (~15% off; Basic rounds to ~11%
// because a $9 price leaves no finer step). The old "3 months free" badge
// was removed with this — at 15% it is no longer literally true, and we
// don't keep badges that aren't. Applies to NEW checkouts only; existing
// annual subscribers keep the Stripe price they signed up on.
export const PRICING_TIERS = [
  {
    id: "basic",
    annualPrice: 8,
    name: "Basic",
    price: 9,
    credits: 12,
    highlight: false,
    features: [
      "12 credits / month — about 12 standard clips or images",
      "Unlimited character profiles",
      "Your character's rulebook compiled into every prompt",
      "Blocked or refused requests never use your credits",
    ],
  },
  {
    id: "starter",
    annualPrice: 16,
    name: "Starter",
    price: 19,
    credits: 30,
    highlight: false,
    features: [
      "30 credits / month ≈ 30 standard videos, or 15 premium ones",
      "Unlimited character profiles",
      "Your character's rulebook compiled into every prompt",
      "Blocked or refused requests never use your credits",
    ],
  },
  {
    id: "growth",
    annualPrice: 67,
    name: "Growth",
    price: 79,
    credits: 140,
    highlight: true,
    badge: "Most popular",
    features: [
      "140 credits / month ≈ 140 standard videos, or 70 premium ones",
      "Unlimited character profiles",
      "Your character's rulebook compiled into every prompt",
      "Blocked or refused requests never use your credits",
    ],
  },
  {
    id: "studio",
    annualPrice: 254,
    name: "Studio",
    price: 299,
    credits: 550,
    highlight: false,
    features: [
      "550 credits / month ≈ 550 standard videos, or 275 premium ones",
      "Everything in Growth",
      "Storyboard — set a start and end frame for a shot",
      "Multi-image reference — anchor a character to several reference photos at once",
    ],
  },
  {
    id: "elite",
    annualPrice: 424,
    name: "Elite",
    price: 499,
    credits: 1000,
    highlight: false,
    features: [
      "1000 credits / month ≈ 1000 standard videos, or 500 premium ones",
      "Everything in Studio",
      // "Priority rendering queue" and "Early access to new models and
      // features" were removed 2026-08-30: neither has any implementation.
      // There is no server-side render queue to prioritise (advanceGeneration
      // is driven by the requesting browser; claim_job_advance is a
      // concurrency mutex, not a scheduler), and feature_flags are global
      // booleans with no per-plan or per-user cohort. Do not re-add either
      // line until the mechanism behind it exists — a paid bullet with no
      // implementation is the one claim on this page with legal exposure.
      //
      // Elite's other genuine, unadvertised delta is unlimited prompt
      // assists (PLAN_PROMPT_ASSIST_LIMITS.elite === Infinity). Deliberately
      // NOT listed here: that endpoint has no rate limit, so advertising it
      // invites the exact scripted abuse plans.ts:108 warns about. Add it
      // once the limiter is in place.
      "API access — generate from your own software",
    ],
  },
] as const;
