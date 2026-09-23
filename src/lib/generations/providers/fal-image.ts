import { getImageModel } from "@/lib/generations/providers/image-models";
import {
  LAYER_RECUT_ENDPOINT,
  LAYER_RECUT_MODEL,
  LAYER_RECUT_RESOLUTION,
} from "@/lib/generations/layers";
import { fetchWithTimeout } from "@/lib/generations/providers/fetch-with-timeout";
import { IMAGE_RESULT_REFUSED } from "@/lib/generations/providers/refusal-messages";
import {
  DEFAULT_IMAGE_ASPECT,
  defaultImageResolution,
  type ImageAspect,
  type ImageResolution,
} from "@/lib/generations/providers/image-resolution";

// Thrown when Flux's own safety checker flags the result. fal.ai does NOT
// error in that case — it returns HTTP 200 with the image replaced by a
// solid black frame and has_nsfw_concepts[i] = true. Real incident,
// 2026-08-14: two "swimsuit selfie" generations sailed through as
// "succeeded" with pure black pictures. Failing loudly here lets the
// pipeline treat it as the refusal it is — final, not retried (the message
// carries "safety", which pipeline.ts's SAFETY_REJECTION reads), with an
// honest log — instead of delivering a black rectangle as a success.
export class FluxSafetyRejection extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FluxSafetyRejection";
  }
}

// Thrown when Nano Banana Pro answers 200 with no picture — Google's models
// decline in prose rather than with an error status. Same contract as
// FluxSafetyRejection: final, refunded through the ordinary path, honest log.
export class GeminiImageRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiImageRefusal";
  }
}

// Image generation via Flux on fal.ai — the faster/cheaper alternative.
// Unlike OpenAI, fal.ai returns a hosted URL directly, so no re-upload is
// needed (same as the video provider).

export async function generateImageWithFlux(
  prompt: string,
  referenceImageUrl?: string | string[] | null,
  /**
   * Layer edits only. The endpoint's defaults are wrong for a layer in two
   * ways, both measured 2026-09-04: output_format defaults to JPEG, whose
   * ringing along a cut-out silhouette is exactly what the matting model
   * then traces into the new alpha; and image_size defaults to "auto", which
   * returned 592x1088 for a 605x1088 layer, a 2% squash that has to be
   * resized back out. Every other caller keeps the behaviour it has always
   * had — this argument is absent for all of them.
   */
  options?: { outputFormat?: "png" | "jpeg"; size?: { width: number; height: number } | null },
): Promise<string> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) {
    throw new Error(
      "FAL_KEY is not set. Add it to .env.local, or turn off the " +
        "'real_ai_providers' flag in Admin > Feature flags to use the mock pipeline.",
    );
  }

  // FLUX.2 Pro (2026-08-26): the /edit endpoint takes image_urls — up to
  // ten reference images — so the whole reference array (identity, outfit,
  // prop, or several characters) rides exactly like the GPT edit lane. The
  // v1 code here took ONE image_url it then repainted, which is why the
  // old fallback lost faces and multi-character had to be blocked upstream.
  const referenceUrls = (Array.isArray(referenceImageUrl)
    ? referenceImageUrl
    : referenceImageUrl
      ? [referenceImageUrl]
      : []
  ).filter(Boolean);

  const model = getImageModel("flux");
  if (model.provider !== "fal") throw new Error("Flux model config is misconfigured.");

  const endpoint = referenceUrls.length ? model.falImageToImage : model.falTextToImage;
  const body: Record<string, unknown> = referenceUrls.length
    ? { prompt, image_urls: referenceUrls }
    : { prompt };
  if (options?.outputFormat) body.output_format = options.outputFormat;
  if (options?.size) body.image_size = { width: options.size.width, height: options.size.height };

  const res = await fetchWithTimeout(
    `https://fal.run/${endpoint}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
    60_000,
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`fal.ai (Flux) error (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();

  const nsfwFlags: unknown = data?.has_nsfw_concepts;
  if (Array.isArray(nsfwFlags) && nsfwFlags.some(Boolean)) {
    throw new FluxSafetyRejection(IMAGE_RESULT_REFUSED);
  }

  const url: string | undefined =
    data?.images?.[0]?.url ?? data?.image?.url ?? data?.output?.image?.url ?? data?.url;

  if (!url) throw new Error("fal.ai (Flux) response didn't include an image URL.");
  return url;
}

/**
 * Image generation via Nano Banana Pro (Google's Gemini 3 Pro Image) on
 * fal.ai — the second lane a person can pick for a picture (2026-09-23).
 * Returns a hosted fal URL, like the Flux lane; image.ts persists it.
 *
 * Its own function rather than a branch inside generateImageWithFlux,
 * because almost nothing about the request is shared: this endpoint takes
 * `resolution` ("1K" | "2K" | "4K") where Flux takes `image_size`, answers
 * with a `description` beside the images, and carries no
 * has_nsfw_concepts — so Flux's black-frame check would read as "clean" on
 * an endpoint that never sets that field. Sharing the code would mean a
 * refusal on this lane sailing through as a success, which is exactly the
 * 2026-08-14 incident FluxSafetyRejection exists to prevent.
 *
 * RESOLUTION IS PINNED to the catalogue's falResolution (1K): fal prices
 * this endpoint at one flat rate per image with 4K marked higher, so an
 * unpinned resolution is an unpinned price — the same rule that pins GPT
 * Image's quality (openai-images.ts, THE MONEY).
 *
 * safety_tolerance is NOT sent. fal exposes it (1-6, default 4) and raising
 * it would loosen Google's own filter; our content policy is the gate that
 * decides what may be sent (content-policy.ts, which cannot be turned off),
 * and turning a provider's filter down to get more prompts through is the
 * ladder that was removed on 2026-09-09. The default stands.
 */
export async function generateImageWithGemini(
  prompt: string,
  referenceImageUrl?: string | string[] | null,
  /**
   * The size and shape this send asked for (2026-09-23). Both are validated
   * against this lane's own offers upstream (image-resolution.ts) and
   * against the credit the person was charged — a request naming 4K that
   * paid for 2K would be this lane rendering money it never took.
   */
  options?: { resolution?: ImageResolution | null; aspect?: ImageAspect | null },
): Promise<string> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) {
    throw new Error(
      "FAL_KEY is not set. Add it to .env.local, or turn off the " +
        "'real_ai_providers' flag in Admin > Feature flags to use the mock pipeline.",
    );
  }

  const referenceUrls = (
    Array.isArray(referenceImageUrl)
      ? referenceImageUrl
      : referenceImageUrl
        ? [referenceImageUrl]
        : []
  ).filter(Boolean);

  const model = getImageModel("gemini");
  if (model.provider !== "fal") {
    throw new Error("Nano Banana Pro model config is misconfigured.");
  }

  const endpoint = referenceUrls.length ? model.falImageToImage : model.falTextToImage;
  const body: Record<string, unknown> = {
    prompt,
    num_images: 1,
    // Never the endpoint's own defaults for either of these. resolution
    // defaults to 1K, which is the band this lane shipped with before fal's
    // page was read properly — 2K is the same price (image-resolution.ts,
    // THE MONEY). aspect_ratio defaults to "auto", which on an edit follows
    // the FIRST input picture, so a square shot came back in the shape of
    // whatever photo anchored the character, and the identity score read a
    // face that landed smaller in a taller frame as a worse match. What the
    // send asked for, or this lane's own default — never the provider's.
    resolution: options?.resolution ?? defaultImageResolution("gemini"),
    aspect_ratio: options?.aspect ?? DEFAULT_IMAGE_ASPECT,
    output_format: "png",
  };
  if (referenceUrls.length) body.image_urls = referenceUrls;

  const res = await fetchWithTimeout(
    `https://fal.run/${endpoint}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
    120_000,
  );

  if (!res.ok) {
    const text = await res.text();
    // 422 is this endpoint's REFUSAL, measured 2026-09-23 against the live
    // endpoint: "The model did not generate the expected output for this
    // prompt. This may occur for several reasons, including unsafe content,
    // a prompt that is incompatible with the selected media type,
    // references to missing attachments, or other cases where the input
    // cannot be processed as the requested output type."
    //
    // It must not travel as a provider ERROR, for two reasons. The raw body
    // is a provider dump, and History shows nobody those (operator, 2026-08-19).
    // And every one of those causes is FINAL — retrying buys the same answer
    // at $0.15 a go — while an error message carrying a status code is what
    // the retry ladder reads. Same contract as the no-picture answer below.
    if (res.status === 422) {
      console.warn(`[gemini] 422 from ${endpoint}: ${text.slice(0, 300)}`);
      throw new GeminiImageRefusal(IMAGE_RESULT_REFUSED);
    }
    throw new Error(`fal.ai (Nano Banana Pro) error (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const url: string | undefined = data?.images?.[0]?.url ?? data?.image?.url;

  // No picture, HTTP 200. Google's image models answer a request they will
  // not draw with prose in `description` and an empty images list, so this
  // is the refusal shape — and it must fail loudly rather than return an
  // undefined URL up the stack. Treated exactly like Flux's black frame:
  // non-retryable (the message carries "safety", which pipeline.ts's
  // SAFETY_REJECTION reads) and refunded through the ordinary path, never
  // force-refunded — whether fal bills a refused request here is unmeasured,
  // and refund-rules.ts only force-refunds what a provider's own ledger has
  // been read to show is free (OpenAI's, 2026-09-10).
  if (!url) {
    throw new GeminiImageRefusal(IMAGE_RESULT_REFUSED);
  }
  return url;
}

/**
 * Cut a subject back out of an opaque image, returning a transparent PNG.
 *
 * The layer edit lane's second step: flux-2-pro/edit answers with an opaque
 * frame (it invents a background), so the subject is re-matted before the
 * result can go back into a layer stack. BiRefNet's Portrait model at 2K was
 * the probe's pick on 2026-09-03 — clean hair edges, ~1-2 s — over Bria,
 * which hard-cut stray strands and caps at 1024².
 *
 * refine_foreground matters and is not a default: without it the matte's
 * semi-transparent pixels keep the old background's colour, which fringes
 * every edge when the layer is composited over something new.
 */
export async function recutAlphaWithBiRefNet(imageUrl: string): Promise<string> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) throw new Error("FAL_KEY is not set.");
  const res = await fetchWithTimeout(
    `https://fal.run/${LAYER_RECUT_ENDPOINT}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Key ${apiKey}` },
      body: JSON.stringify({
        image_url: imageUrl,
        model: LAYER_RECUT_MODEL,
        operating_resolution: LAYER_RECUT_RESOLUTION,
        refine_foreground: true,
        output_format: "png",
      }),
    },
    120_000,
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`fal.ai (BiRefNet) error (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const url: string | undefined = data?.image?.url ?? data?.images?.[0]?.url;
  if (!url) throw new Error("fal.ai (BiRefNet) response didn't include an image URL.");
  return url;
}
