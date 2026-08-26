// Catalog of switchable image models. Same pattern as video-models.ts — add
// an entry here to make a new model selectable in Admin > AI Providers.

export const IMAGE_MODELS = [
  {
    id: "gpt-image",
    name: "GPT Image 2",
    provider: "openai" as const,
    recommended: true,
    description: "Best prompt fidelity and identity-locking for consistent characters.",
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
] as const;

export type ImageModelId = (typeof IMAGE_MODELS)[number]["id"];

export function getImageModel(id: string) {
  return IMAGE_MODELS.find((m) => m.id === id) ?? IMAGE_MODELS.find((m) => m.recommended)!;
}
