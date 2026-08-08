import { getImageModel } from "@/lib/generations/providers/image-models";
import { fetchWithTimeout } from "@/lib/generations/providers/fetch-with-timeout";

// Image generation via Flux on fal.ai — the faster/cheaper alternative.
// Unlike OpenAI, fal.ai returns a hosted URL directly, so no re-upload is
// needed (same as the video provider).

export async function generateImageWithFlux(
  prompt: string,
  referenceImageUrl?: string | string[] | null,
): Promise<string> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) {
    throw new Error(
      "FAL_KEY is not set. Add it to .env.local, or turn off the " +
        "'real_ai_providers' flag in Admin > Feature flags to use the mock pipeline.",
    );
  }

  // Flux's image-to-image endpoint here (fal-ai/flux/dev/image-to-image)
  // only ever accepts one source image to edit/vary — it has no equivalent
  // of OpenAI's multi-image edit for compositing several distinct
  // characters into one picture. actions.ts already blocks this combination
  // before spending a generation attempt (see the imageModelId check in
  // runGeneration); this is a backstop in case this function is ever called
  // directly with 2+ URLs some other way.
  if (Array.isArray(referenceImageUrl) && referenceImageUrl.length >= 2) {
    throw new Error(
      "Flux can't combine multiple different characters into one image — switch the image model to GPT Image 2.",
    );
  }
  const singleReferenceUrl = Array.isArray(referenceImageUrl) ? referenceImageUrl[0] : referenceImageUrl;

  const model = getImageModel("flux");
  if (model.provider !== "fal") throw new Error("Flux model config is misconfigured.");

  const endpoint = singleReferenceUrl ? model.falImageToImage : model.falTextToImage;
  const body = singleReferenceUrl ? { prompt, image_url: singleReferenceUrl } : { prompt };

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
  const url: string | undefined =
    data?.images?.[0]?.url ?? data?.image?.url ?? data?.output?.image?.url ?? data?.url;

  if (!url) throw new Error("fal.ai (Flux) response didn't include an image URL.");
  return url;
}
