import { generateImageWithOpenAI } from "@/lib/generations/providers/openai-images";
import { generateImageWithFlux } from "@/lib/generations/providers/fal-image";
import { getImageModel } from "@/lib/generations/providers/image-models";

// Single entry point for image generation regardless of which model is
// selected. OpenAI returns raw image bytes (persisted via the caller-supplied
// persistBase64 handler); fal.ai/Flux returns a hosted URL directly.
export async function generateImage(
  modelId: string,
  prompt: string,
  referenceImageUrl: string | null | undefined,
  persistBase64: (base64: string) => Promise<string>,
): Promise<string> {
  const model = getImageModel(modelId);

  if (model.provider === "fal") {
    return generateImageWithFlux(prompt, referenceImageUrl);
  }

  const base64 = await generateImageWithOpenAI(prompt, referenceImageUrl);
  return persistBase64(base64);
}
