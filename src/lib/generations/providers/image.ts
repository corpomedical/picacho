import { generateImageWithOpenAI } from "@/lib/generations/providers/openai-images";
import { generateImageWithFlux } from "@/lib/generations/providers/fal-image";
import { getImageModel } from "@/lib/generations/providers/image-models";

// Single entry point for image generation regardless of which model is
// selected. OpenAI returns raw image bytes (persisted via the caller-supplied
// persistBase64 handler); fal.ai/Flux returns a hosted URL directly.
//
// referenceImageUrl accepts either a single URL (the ordinary one-character
// case, unchanged) or an array (multi-character mode — one photo per
// selected character). Only OpenAI's GPT Image 2 path actually supports the
// array form; the caller (actions.ts) is responsible for never routing a
// multi-character request to Flux in the first place, but generateImageWithFlux
// throws a clear error itself as a backstop if that ever happens anyway.
export async function generateImage(
  modelId: string,
  prompt: string,
  referenceImageUrl: string | string[] | null | undefined,
  persistBase64: (base64: string) => Promise<string>,
): Promise<string> {
  const model = getImageModel(modelId);

  if (model.provider === "fal") {
    return generateImageWithFlux(prompt, referenceImageUrl);
  }

  const base64 = await generateImageWithOpenAI(prompt, referenceImageUrl);
  return persistBase64(base64);
}
