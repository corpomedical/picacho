import { generateImageWithOpenAI, ImageSafetyRejection } from "@/lib/generations/providers/openai-images";
import { generateImageWithFlux } from "@/lib/generations/providers/fal-image";
import { fetchWithTimeout } from "@/lib/generations/providers/fetch-with-timeout";
import { getImageModel } from "@/lib/generations/providers/image-models";
import { softenPromptForSafety } from "@/lib/generations/providers/anthropic";

// A hard ceiling on PAID calls for one generation, counted across every
// retry, fallback and soften-and-try-again inside it.
//
// The old shape multiplied: 3 attempts x 2 generate-retries, and each of
// those could chain GPT Image -> safety rejection -> softened retry -> Flux.
// Twelve GPT Image calls plus six Flux renders for a single credit, and if
// the generation ultimately failed that credit was refunded — so the worst
// case was roughly two euros of spend against zero revenue, from one click.
//
// The budget is threaded through instead of lowering the retry counts,
// because the retries themselves are worth keeping: a transient 500 really
// does succeed on the second try. What must not happen is many EXPENSIVE
// recoveries stacking up inside them.
export type ProviderBudget = { spent: number; limit: number };

export function newProviderBudget(limit: number): ProviderBudget {
  return { spent: 0, limit };
}

export class ProviderBudgetExhausted extends Error {
  constructor(limit: number) {
    super(
      `This request already used its ${limit} generation attempts without producing a usable image.`,
    );
    this.name = "ProviderBudgetExhausted";
  }
}

// Call immediately BEFORE anything that costs money. Throws rather than
// returning false so no call site can forget to check.
function chargeBudget(budget: ProviderBudget | undefined): void {
  if (!budget) return;
  if (budget.spent >= budget.limit) throw new ProviderBudgetExhausted(budget.limit);
  budget.spent += 1;
}

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
  // Shared across every attempt of one generation — see ProviderBudget.
  budget?: ProviderBudget,
  // Outfit-on-the-character (2026-08-24): a clothing photo sent ALONGSIDE the
  // single identity photo on the GPT image-edit path only. Deliberately its
  // own argument rather than merged into referenceImageUrl: the array form
  // means multi-character (one photo per person, blocks the Flux fallback),
  // and the Flux paths are single-source image-to-image where a clothing
  // photo would become the base image — the exact identity-destroying
  // mistake this feature exists to prevent. Flux calls get the identity
  // photo alone; the prompt's outfit description carries the garment there.
  outfitImageUrl?: string | null,
  // Prop-role photo (Send Receipt P5) — same GPT-only extra-image contract
  // as the outfit image above; Flux fallbacks stay single-source.
  propImageUrl?: string | null,
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
    chargeBudget(budget);
    return persistRemoteImage(await generateImageWithFlux(prompt, referenceImageUrl));
  }

  // Only the ordinary single-identity case can take the extra outfit image —
  // callers already only set outfitImageUrl then, this is the local guard.
  const openAiRefs =
    (outfitImageUrl || propImageUrl) && typeof referenceImageUrl === "string" && referenceImageUrl
      ? [
          referenceImageUrl,
          ...(outfitImageUrl ? [outfitImageUrl] : []),
          ...(propImageUrl ? [propImageUrl] : []),
        ]
      : referenceImageUrl;

  try {
    chargeBudget(budget);
    const base64 = await generateImageWithOpenAI(prompt, openAiRefs);
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
        chargeBudget(budget);
        const base64 = await generateImageWithOpenAI(softenedPrompt, openAiRefs);
        // The softened text is included because it's otherwise invisible:
        // the pipeline log shows the ORIGINAL prompt, so when a softened
        // render ignores an instruction there is no way to tell whether the
        // rewrite dropped it (2026-08-26: a "new camera angle" render went
        // through softening, leaving exactly that question unanswerable).
        onFallback?.(
          `OpenAI's safety filter rejected the wording — automatically softened it and retried on GPT Image 2, keeping the identity anchor. Softened prompt: "${softenedPrompt.slice(0, 300)}"`,
        );
        return persistBase64(base64);
      } catch (softenErr) {
        // An exhausted budget is not a recoverable rejection — it is the
        // stop sign. Everything else falls through to the Flux attempt.
        if (softenErr instanceof ProviderBudgetExhausted) throw softenErr;
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
      chargeBudget(budget);
      return persistRemoteImage(
        await generateImageWithFlux(softenedPrompt ?? prompt, referenceImageUrl),
      );
    }
    // Multi-character compositing has no Flux equivalent (its image-to-image
    // endpoint takes a single source), so there's nothing to fall back to.
    throw err;
  }
}
