import { generateImageWithOpenAI, ImageSafetyRejection } from "@/lib/generations/providers/openai-images";
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
  // Called if the request had to be completed by a different model than the
  // one asked for, so the caller can record that in the pipeline log rather
  // than reporting a model that didn't actually produce the result.
  onFallback?: (note: string) => void,
): Promise<string> {
  const model = getImageModel(modelId);

  if (model.provider === "fal") {
    return generateImageWithFlux(prompt, referenceImageUrl);
  }

  try {
    const base64 = await generateImageWithOpenAI(prompt, referenceImageUrl);
    return persistBase64(base64);
  } catch (err) {
    // OpenAI's safety classifier is aggressive about photorealistic people —
    // which is precisely what this product generates — and rejected 3 of the
    // 8 failed generations measured on 2026-08-10. Flux has its own, much
    // less restrictive filter, and it's already wired up and paid for, so
    // falling back to it turns an outright failure into a delivered image.
    //
    // Only for the safety case: an auth error, an outage, or a rate limit
    // says nothing about whether a different model would do better, and
    // silently double-spending on those would be wrong.
    const multiCharacter = Array.isArray(referenceImageUrl) && referenceImageUrl.length >= 2;
    if (err instanceof ImageSafetyRejection && !multiCharacter) {
      onFallback?.("OpenAI's safety filter rejected the prompt — generated with Flux instead.");
      return generateImageWithFlux(prompt, referenceImageUrl);
    }
    // Multi-character compositing has no Flux equivalent (its image-to-image
    // endpoint takes a single source), so there's nothing to fall back to.
    throw err;
  }
}
