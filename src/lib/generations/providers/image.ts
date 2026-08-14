import { generateImageWithOpenAI, ImageSafetyRejection } from "@/lib/generations/providers/openai-images";
import { generateImageWithFlux } from "@/lib/generations/providers/fal-image";
import { fetchWithTimeout } from "@/lib/generations/providers/fetch-with-timeout";
import { getImageModel } from "@/lib/generations/providers/image-models";
import { softenPromptForSafety } from "@/lib/generations/providers/anthropic";

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
  // finalModelName is set when a different model than the requested one
  // actually produced the image, so the pipeline log can report the truth
  // (it used to always print the requested model, even after a fallback).
  onFallback?: (note: string, finalModelName?: string) => void,
): Promise<string> {
  const model = getImageModel(modelId);

  // Flux results come back as fal.media URLs — external hosting we don't
  // control, which can expire and leave History cards dead. Persisting into
  // our own storage (same as the GPT path) makes every result durable and
  // uniformly served via our signed URLs. Best-effort: if the download
  // hiccups, the fal URL still works today, so return it rather than
  // failing a generation that actually succeeded.
  async function persistRemoteImage(url: string): Promise<string> {
    try {
      const res = await fetchWithTimeout(url, {}, 20_000);
      if (!res.ok) return url;
      const base64 = Buffer.from(await res.arrayBuffer()).toString("base64");
      return await persistBase64(base64);
    } catch {
      return url;
    }
  }

  if (model.provider === "fal") {
    return persistRemoteImage(await generateImageWithFlux(prompt, referenceImageUrl));
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
    if (!(err instanceof ImageSafetyRejection)) throw err;

    // First recovery: soften the wording and retry on GPT itself. This keeps
    // the image-edit identity anchor, which is the whole product promise —
    // the old behavior jumped straight to Flux, whose plain image-to-image
    // repaints the person (real report: "0 match" to the character). Works
    // for multi-character too, since the retry stays on the same endpoint.
    let softenedPrompt: string | null = null;
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        softenedPrompt = await softenPromptForSafety(prompt);
        const base64 = await generateImageWithOpenAI(softenedPrompt, referenceImageUrl);
        onFallback?.(
          "OpenAI's safety filter rejected the wording — automatically softened it and retried on GPT Image 2, keeping the identity anchor.",
        );
        return persistBase64(base64);
      } catch {
        // Softening failed or the retry was rejected too — fall through,
        // keeping the softened wording (if any) for the Flux attempt below:
        // Flux has its own trigger-happy checker, and the plain rewrite
        // helps there exactly as much as it does on GPT.
      }
    }

    if (!multiCharacter && process.env.FAL_KEY) {
      onFallback?.(
        "OpenAI's safety filter rejected the prompt — generated with Flux instead. Identity match is weaker than GPT Image 2's anchored mode.",
        "Flux",
      );
      return persistRemoteImage(
        await generateImageWithFlux(softenedPrompt ?? prompt, referenceImageUrl),
      );
    }
    // Multi-character compositing has no Flux equivalent (its image-to-image
    // endpoint takes a single source), so there's nothing to fall back to.
    throw err;
  }
}
