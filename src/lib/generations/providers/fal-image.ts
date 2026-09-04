import { getImageModel } from "@/lib/generations/providers/image-models";
import {
  LAYER_RECUT_ENDPOINT,
  LAYER_RECUT_MODEL,
  LAYER_RECUT_RESOLUTION,
} from "@/lib/generations/layers";
import { fetchWithTimeout } from "@/lib/generations/providers/fetch-with-timeout";

// Thrown when Flux's own safety checker flags the result. fal.ai does NOT
// error in that case — it returns HTTP 200 with the image replaced by a
// solid black frame and has_nsfw_concepts[i] = true. Real incident,
// 2026-08-14: two "swimsuit selfie" generations sailed through as
// "succeeded" with pure black pictures. Failing loudly here lets the
// pipeline treat it like any other rejected generation (retry, refund,
// honest log) instead of delivering a black rectangle as a success.
export class FluxSafetyRejection extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FluxSafetyRejection";
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
    throw new FluxSafetyRejection(
      "Flux's safety checker flagged this image and blacked it out. " +
        "Try plainer wording for the outfit and pose.",
    );
  }

  const url: string | undefined =
    data?.images?.[0]?.url ?? data?.image?.url ?? data?.output?.image?.url ?? data?.url;

  if (!url) throw new Error("fal.ai (Flux) response didn't include an image URL.");
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
