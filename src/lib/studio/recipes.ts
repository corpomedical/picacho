// Product Studio shot recipes (2026-08-27, "B on A" operator-approved).
// Each recipe is a FIXED, pre-proven prompt the Studio fires through the
// ordinary runGeneration pipeline: the product photo (or logo) rides the
// neutral reference lane exactly like a manually attached image, the
// character (when the recipe stars one) is the normal identity anchor, and
// results land in History/Media like any other render. Zero new pipeline
// behavior — the Studio is orchestration plus taste.
//
// Proving-day rule: every recipe below was validated as a real render
// before earning a card — held-by-character, product hero and lifestyle on
// 2026-08-27 against the placeholder bottle (shape, cap and logotype
// preserved exactly), logo-on-apparel on 2026-08-26 (the verbatim wordmark
// tee). A recipe's thumbnail in public/studio/ IS its validation render.
// Change a prompt and it must be re-proven.

export type StudioRecipe = {
  id: string;
  // Whether the shot stars the user's character (identity anchor) or is a
  // product-only scene.
  needsCharacter: boolean;
  // Which product asset rides the reference lane: the product photo, or
  // the brand logo (logo recipes need a product with a logo uploaded).
  reference: "product" | "logo";
  // Builds the model-facing prompt. English on purpose — text for the
  // model, like presets and perspectives.
  prompt: (productName: string) => string;
};

export const STUDIO_RECIPES: StudioRecipe[] = [
  {
    id: "held-by-character",
    needsCharacter: true,
    reference: "product",
    prompt: (name) =>
      `She holds the ${name} — the product shown in the attached photo; keep its shape, materials, label and logo exactly as photographed — at chest height with a delighted expression, presenting it to the camera. Clean soft-cream studio background, crisp advertising photography, focus on both face and product.`,
  },
  {
    id: "logo-apparel",
    needsCharacter: true,
    reference: "logo",
    prompt: (name) =>
      `She stands in a bright studio wearing a plain white t-shirt printed with the ${name} logo from the attached image — reproduce the mark exactly: same letterforms, weight and colors. Natural relaxed smile, soft commercial lighting, chest-up framing.`,
  },
  {
    id: "product-hero",
    needsCharacter: false,
    reference: "product",
    prompt: (name) =>
      `Premium studio hero shot of the ${name} — the product shown in the attached photo; keep its shape, materials, label and logo exactly. It stands on a low stone pedestal against a soft warm gradient backdrop, dramatic side key light with a gentle rim, subtle reflection below, high-end advertising photography, no person.`,
  },
  {
    id: "lifestyle",
    needsCharacter: false,
    reference: "product",
    prompt: (name) =>
      `Editorial lifestyle photo of the ${name} — the product shown in the attached photo; keep its shape, label and logo exactly. It sits on a sunlit marble kitchen counter beside a folded linen napkin and a small green plant, warm morning light through a window, shallow depth of field, no person.`,
  },
];

// The contact sheet: four takes of the chosen recipe, each nudged so the
// set reads as a shoot, not four near-duplicates. Applied as a suffix in
// slot order.
export const STUDIO_VARIATIONS: string[] = [
  "",
  " Variation: a slightly different camera angle and framing than a straight-on shot.",
  " Variation: a noticeably different backdrop tone and mood, same product fidelity.",
  " Variation: a closer, tighter crop emphasizing material and label detail.",
];

export function getStudioRecipe(id: string): StudioRecipe | null {
  return STUDIO_RECIPES.find((r) => r.id === id) ?? null;
}
