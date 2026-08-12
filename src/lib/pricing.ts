// Shared display data for the pricing page and (later) Stripe product setup.
// Keep this the single source of truth so the two never drift apart.
//
// Tier structure (changed 2026-08-12): storyboard + multi-image reference
// moved down from Elite to Studio so the $299 tier has a capability reason
// to exist, not just a bigger quota. Elite is now volume + priority + early
// access. The server-side gating in generations/actions.ts and
// workspace-data.ts mirrors this — change both together.

export const PRICING_TIERS = [
  {
    id: "starter",
    name: "Starter",
    price: 19,
    generations: 10,
    highlight: false,
    features: [
      "10 generations / month",
      "Unlimited character profiles",
      "Full draft → review → validate pipeline",
      "Failed generations never use your allowance",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    price: 79,
    generations: 40,
    highlight: true,
    badge: "Most popular",
    features: [
      "40 generations / month",
      "Unlimited character profiles",
      "Full draft → review → validate pipeline",
      "Failed generations never use your allowance",
    ],
  },
  {
    id: "studio",
    name: "Studio",
    price: 299,
    generations: 150,
    highlight: false,
    features: [
      "150 generations / month",
      "Everything in Growth",
      "Storyboard — set a start and end frame for a shot",
      "Multi-image reference — anchor a character to several reference photos at once",
    ],
  },
  {
    id: "elite",
    name: "Elite",
    price: 499,
    generations: 300,
    highlight: false,
    features: [
      "300 generations / month",
      "Everything in Studio",
      "Priority rendering queue",
      "Early access to new models and features",
      "API access — early access by request",
    ],
  },
] as const;
