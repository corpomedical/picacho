// Phase 3 of the brand rulebook (see BRAND_RULEBOOK_DESIGN.md): preset rule
// packs a customer can enable in one click.
//
// This is the part that's actually sold. Phases 1 and 2 built the mechanism;
// nobody buys a mechanism, and an empty rules box asks a customer to author
// compliance policy themselves, which is exactly the work they're paying to
// avoid. A competitor can copy the feature from a screenshot — they can't
// copy the rules.
//
// IMPORTANT, and surfaced in the UI as well as here: these are drafting aids
// based on widely-shared advertising-standards principles, NOT legal advice,
// and NOT jurisdiction-specific. Advertising rules for health and appearance
// claims differ substantially between the US (FTC/FDA), UK (ASA/CAP), and
// EU member states. Anyone relying on these commercially should have them
// reviewed by a qualified adviser for their own market. The packs are
// deliberately written as plain prohibitions a person can read and edit,
// rather than citations to any specific regulation, so they stay honest
// about what they are.
//
// Every rule lands in the normal brand_rules table once applied, so it can
// be edited, disabled, or deleted like any hand-written rule.

export type PackRule = {
  label: string;
  value: string;
  severity: "block" | "warn";
};

export type BrandRulePack = {
  id: string;
  name: string;
  description: string;
  rules: PackRule[];
};

export const BRAND_RULE_PACKS: BrandRulePack[] = [
  {
    id: "aesthetics",
    name: "Aesthetics & wellness clinics",
    description:
      "Med spas, beauty salons, cosmetic dentistry, skin and hair clinics, fitness and nutrition. Blocks the outcome and health claims that get appearance-related advertising into trouble.",
    rules: [
      {
        label: "No guaranteed results",
        value:
          "Never state or imply that results are guaranteed, permanent, risk-free, or certain to occur",
        severity: "block",
      },
      {
        label: "No medical claims",
        value:
          "Never claim or imply that a treatment diagnoses, treats, cures, or prevents any medical condition or disease",
        severity: "block",
      },
      {
        label: "No before-and-after imagery",
        value:
          "Never show or describe a before-and-after comparison, a split-screen result, or a transformation sequence",
        severity: "block",
      },
      {
        label: "No promised timeframes",
        value:
          "Never promise a specific result within a specific number of days, weeks, sessions, or treatments",
        severity: "block",
      },
      {
        label: "No safety absolutes",
        value:
          "Never describe a treatment or procedure as safe, painless, side-effect-free, or having no downtime",
        severity: "block",
      },
      {
        label: "No prescription brand names",
        value:
          "Never name a prescription medicine or injectable brand, such as Botox, Dysport, or Ozempic",
        severity: "block",
      },
      {
        label: "No appearance shaming",
        value:
          "Never imply the viewer's body or appearance is a flaw, a problem, or something requiring correction",
        severity: "block",
      },
      {
        label: "No minors in treatment content",
        value: "Never depict anyone who appears to be under 18 receiving or considering a treatment",
        severity: "block",
      },
    ],
  },
  {
    id: "creators",
    name: "Creators & sponsored content",
    description:
      "Social media creators, influencers, talent agencies, coaches. Keeps sponsored posts disclosable and clear of other people's likenesses and brands.",
    rules: [
      {
        label: "No undisclosed sponsorship",
        value:
          "Never present a paid promotion, gifted product, or affiliate placement as an unpaid personal recommendation",
        severity: "block",
      },
      {
        label: "No real public figures",
        value:
          "Never depict, name, or imitate a real celebrity, politician, athlete, or other identifiable public figure",
        severity: "block",
      },
      {
        label: "No competitor brands",
        value: "Never show or name a competitor's brand, logo, packaging, or product",
        severity: "block",
      },
      {
        label: "No implied endorsement",
        value:
          "Never imply that a brand, employer, or organisation endorses this content unless they are the advertiser",
        severity: "block",
      },
      {
        label: "No fake testimonials",
        value:
          "Never present an invented review, testimonial, comment, or follower reaction as if it were real",
        severity: "block",
      },
      {
        label: "No copyrighted characters",
        value:
          "Never depict a copyrighted character, film still, album art, or other protected creative work",
        severity: "block",
      },
      {
        label: "No earnings claims",
        value:
          "Never state or imply typical, guaranteed, or achievable income, revenue, or follower growth",
        severity: "warn",
      },
    ],
  },
  {
    id: "brands",
    name: "Brands & agencies",
    description:
      "Marketing and social agencies, e-commerce, fashion, skincare and cosmetics. General brand safety plus the comparative claims that need evidence you can't put in a generated image.",
    rules: [
      {
        label: "No competitor brands",
        value: "Never show or name a competitor's brand, logo, packaging, or product",
        severity: "block",
      },
      {
        label: "No third-party trademarks",
        value:
          "Never depict a trademark, logo, or brand mark belonging to anyone other than the advertiser",
        severity: "block",
      },
      {
        label: "No real public figures",
        value:
          "Never depict, name, or imitate a real celebrity, politician, athlete, or other identifiable public figure",
        severity: "block",
      },
      {
        label: "No superlative claims",
        value:
          "Never claim to be the best, number one, the leading, or the only option, or make any comparative superiority claim",
        severity: "block",
      },
      {
        label: "No prices or discounts",
        value:
          "Never state a price, discount, percentage off, or limited-time offer in the generated content",
        severity: "warn",
      },
      {
        label: "No fake testimonials",
        value:
          "Never present an invented review, testimonial, comment, or customer quote as if it were real",
        severity: "block",
      },
      {
        label: "No unverifiable statistics",
        value:
          "Never state a statistic, percentage, survey result, or study finding as fact",
        severity: "warn",
      },
    ],
  },
];

export function getBrandRulePack(id: string): BrandRulePack | undefined {
  return BRAND_RULE_PACKS.find((p) => p.id === id);
}
