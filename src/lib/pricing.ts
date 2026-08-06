// Shared display data for the pricing page and (later) Stripe product setup.
// Keep this the single source of truth so the two never drift apart.

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
    ],
  },
  {
    id: "studio",
    name: "Studio",
    price: 299,
    generations: 150,
    highlight: false,
    overageNote: "then $2.50 per additional generation",
    features: [
      "150 generations / month",
      "$2.50 per generation after that",
      "Unlimited character profiles",
      "Full draft → review → validate pipeline",
    ],
  },
  {
    id: "elite",
    name: "Elite",
    price: 499,
    generations: 300,
    highlight: false,
    overageNote: "then $2.50 per additional generation",
    features: [
      "300 generations / month",
      "$2.50 per generation after that",
      "Unlimited character profiles",
      "Full draft → review → validate pipeline",
      "Storyboard — set a start and end frame for a shot",
      "Multi-image reference — anchor a character to several reference photos at once",
    ],
  },
] as const;
