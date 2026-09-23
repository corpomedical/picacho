// Catalog of switchable image models. Same pattern as video-models.ts — add
// an entry here to make a new model selectable in Admin > AI Providers.

export const IMAGE_MODELS = [
  {
    // GPT Image 2.5 Sunburst since 2026-09-14 (openai-images.ts names the
    // snapshot and says why). The id stays "gpt-image" for the same reason
    // "flux" stayed: it is the value stored in Admin > AI Providers.
    id: "gpt-image",
    name: "GPT Image 2.5",
    provider: "openai" as const,
    recommended: true,
    description: "Best prompt fidelity and identity-locking for consistent characters; OpenAI's most capable editing model.",
  },
  {
    // Upgraded from Flux 1 dev to FLUX.2 Pro (2026-08-26, operator-approved
    // after three Eva identity probes held the face). The id stays "flux"
    // on purpose: it's the value stored in Admin > AI Providers, and a
    // rename would silently reset every account's model setting. The leap
    // that matters: /edit takes up to 10 reference images (v1's
    // image-to-image took ONE source it repainted — the "0% match"
    // fallback incident), so the fallback lane now keeps the face and
    // multi-character finally has a fallback at all.
    id: "flux",
    name: "Flux 2 Pro",
    provider: "fal" as const,
    falTextToImage: "fal-ai/flux-2-pro",
    falImageToImage: "fal-ai/flux-2-pro/edit",
    recommended: false,
    description: "Fast, cheap and photoreal — multi-reference identity via FLUX.2 edit.",
  },
  {
    // Nano Banana Pro — Google's Gemini 3 Pro Image, the second lane a person
    // can pick for a picture (2026-09-23, the operator's call: "Make it an
    // option for the user to select. Not for free tier.").
    //
    // WHY IT IS OFFERED AT ALL, since it costs MORE than the default. Two
    // reasons, both about what GPT Image cannot do:
    //   • Refusals. OpenAI's classifier was the single most common named
    //     cause of failed generations (3 of 8, measured 2026-08-10) and it is
    //     aggressive about photorealistic people, which is what this product
    //     makes — see openai-images.ts. Since the safety ladder was removed
    //     on 2026-09-09 a refusal is final: a refunded credit and a dead end.
    //     A second lane the person can move to themselves is the honest
    //     answer to that, unlike the ladder — they pick a different engine,
    //     nothing reworded their prompt to slip past a filter.
    //   • Google's image docs give references NAMED ROLES (3 Pro: 6 object
    //     images + 5 character-consistency images), where OpenAI's edit
    //     endpoint takes one flat list and refuses input_fidelity outright
    //     (400, measured 2026-09-14). Whether those role slots hold a face
    //     better than our anchor is UNPROVEN — see the capability note in
    //     send-plan.ts, which deliberately keeps identity.max at 1 until a
    //     probe says otherwise.
    //
    // THE MONEY (fal's own model pages and ai.google.dev/gemini-api/docs/
    // pricing, both read 2026-09-23 — re-read before quoting again). fal
    // charges $0.15 per image on fal-ai/nano-banana-pro, flat, with 4K
    // marked "higher cost", so RESOLUTION IS PINNED to 1K below: one
    // resolution, one price, the same rule openai-images.ts pins quality
    // for. Google direct is cheaper — $0.134 per 1K/2K image ($120 per 1M
    // output tokens x 1,120 tokens) plus $2 per 1M input tokens against
    // fal's flat $0.15 — and going direct is the obvious later cost cut;
    // fal is the lane today because it needs no second key, no new ledger
    // reader, and no new outage surface.
    //
    // Against the default: a GPT Image 2.5 Set shot with three input
    // pictures measured $0.0767 (economics.ts), so this lane costs about
    // 1.96x the picture it replaces. An image is always 1 credit (quote.ts)
    // and a credit's cost basis is $0.28, so $0.15 still clears with 46%
    // left — no credit-weight change, which is why images stay 1 credit and
    // the picker shows no price chip for this lane.
    id: "gemini",
    name: "Nano Banana Pro",
    provider: "fal" as const,
    falTextToImage: "fal-ai/nano-banana-pro",
    falImageToImage: "fal-ai/nano-banana-pro/edit",
    // Pinned (THE MONEY above). fal's enum is 1K | 2K | 4K.
    falResolution: "1K" as const,
    /** What one picture costs us on fal, for the margin test in image-lane.test.ts. */
    costPerImageUsd: 0.15,
    /** Paid plans only, per the operator. Enforced server-side in actions.ts, not only hidden in the composer. */
    paidOnly: true,
    recommended: false,
    description: "Google's Gemini 3 Pro Image — a second opinion when a prompt or a face fights the default.",
  },
] as const;

export type ImageModelId = (typeof IMAGE_MODELS)[number]["id"];

export function getImageModel(id: string) {
  return IMAGE_MODELS.find((m) => m.id === id) ?? IMAGE_MODELS.find((m) => m.recommended)!;
}

/**
 * The picture lanes a person may choose between in the composer's ENGINE
 * cell, in the order they are shown. NOT the whole catalogue: Flux 2 Pro
 * stays admin-only (Admin > AI Providers), because its entry describes it as
 * the cheap fallback lane rather than a lane anyone would pick on purpose,
 * and a picker whose rows are not all worth picking teaches nothing.
 *
 * Every id here needs a job line in all four locales — image-lane.test.ts
 * fails the build otherwise, the same guard FEATURED_VIDEO_MODEL_IDS has.
 */
export const SELECTABLE_IMAGE_MODEL_IDS = ["gpt-image", "gemini"] as const;

/**
 * Whether this lane is a paid-plan lane. A free account is pinned to the
 * admin default whatever the form asks for (actions.ts) — the free day is
 * counted in generations, one a day, which only equals a budget if every
 * free generation costs about the same.
 */
export function isImageModelPaidOnly(id: string): boolean {
  const model = IMAGE_MODELS.find((m) => m.id === id);
  return model !== undefined && "paidOnly" in model && model.paidOnly === true;
}

/** The lanes a person may pick, resolved to catalogue entries (unknown ids dropped). */
export function selectableImageModels() {
  return SELECTABLE_IMAGE_MODEL_IDS.map((id) => IMAGE_MODELS.find((m) => m.id === id)!).filter(Boolean);
}

/**
 * The lanes that can put SEVERAL distinct characters in one picture. Every
 * lane in the catalogue can today — GPT's multi-image edit always could,
 * FLUX.2 Pro's /edit joined it 2026-08-26, and Nano Banana Pro's /edit takes
 * a reference array too — so the guard in actions.ts is dormant. It stays
 * because it is the cheap protection against the opposite of a silent
 * failure: a future lane that takes ONE source image would otherwise render
 * a group scene from one person's photo and call it a success.
 */
export const IMAGE_LANES_THAT_COMPOSITE = ["gpt-image", "flux", "gemini"] as const;

/**
 * The lanes that take an EXTRA photo beside the person — the outfit laid
 * out, an attached prop or background, a set's earlier still, the
 * photograph a photo set was built from. All three take a reference array,
 * so all three are here.
 *
 * Read it from here, never by naming ids at the call site. The four gates in
 * actions.ts spelled out `"gpt-image" || "flux"` when Nano Banana Pro
 * arrived (2026-09-23) and nobody updated them, so that lane silently lost
 * the outfit photo, lost a set's look and place photos, and had the person's
 * attachment turned into a sentence of vision-written text instead of
 * pixels — while MODEL_CAPABILITIES.gemini.outfitImage said true and the
 * send receipt promised the photo rode. Found the same day, on the first
 * real render, from a low identity score.
 */
export const IMAGE_LANES_THAT_TAKE_EXTRA_PHOTOS = ["gpt-image", "flux", "gemini"] as const;

/** Whether this picture lane receives the extra photos as pixels (see above). */
export function imageLaneTakesExtraPhotos(id: string): boolean {
  return (IMAGE_LANES_THAT_TAKE_EXTRA_PHOTOS as readonly string[]).includes(id);
}
