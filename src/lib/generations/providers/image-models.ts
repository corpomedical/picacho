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
    id: "flux",
    name: "Flux",
    provider: "fal" as const,
    falTextToImage: "fal-ai/flux/dev",
    falImageToImage: "fal-ai/flux/dev/image-to-image",
    recommended: false,
    description: "Faster and cheaper — strong for photorealism, less strict on consistency.",
  },
] as const;

export type ImageModelId = (typeof IMAGE_MODELS)[number]["id"];

export function getImageModel(id: string) {
  return IMAGE_MODELS.find((m) => m.id === id) ?? IMAGE_MODELS.find((m) => m.recommended)!;
}
