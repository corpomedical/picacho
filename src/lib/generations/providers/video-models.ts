// Catalog of switchable video generation models, all hosted behind fal.ai's
// single API/key. Add an entry here (with a confirmed fal.ai endpoint id) to
// make a new model selectable in Admin > AI Providers — no other code needs
// to change, which is the "easy to add a fallback provider" architecture
// the brief asked for.

export const VIDEO_MODELS = [
  {
    id: "kling",
    name: "Kling 2.1",
    falEndpoint: "fal-ai/kling-video/v2.1/standard/text-to-video",
    recommended: true,
    description: "Best price-to-quality ratio — roughly $0.10–$0.20 per second.",
  },
  {
    id: "veo",
    name: "Veo 3.1",
    falEndpoint: "fal-ai/veo3.1",
    recommended: false,
    description: "Google's flagship model. Higher cost (~$0.75/sec), strongest quality.",
  },
] as const;

export type VideoModelId = (typeof VIDEO_MODELS)[number]["id"];

export function getVideoModel(id: string) {
  return VIDEO_MODELS.find((m) => m.id === id) ?? VIDEO_MODELS.find((m) => m.recommended)!;
}
