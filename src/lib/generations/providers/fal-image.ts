import { getImageModel } from "@/lib/generations/providers/image-models";
import { fetchWithTimeout } from "@/lib/generations/providers/fetch-with-timeout";

// Image generation via Flux on fal.ai — the faster/cheaper alternative.
// Unlike OpenAI, fal.ai returns a hosted URL directly, so no re-upload is
// needed (same as the video provider).

export async function generateImageWithFlux(
  prompt: string,
  referenceImageUrl?: string | null,
): Promise<string> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) {
    throw new Error(
      "FAL_KEY is not set. Add it to .env.local, or turn off the " +
        "'real_ai_providers' flag in Admin > Feature flags to use the mock pipeline.",
    );
  }

  const model = getImageModel("flux");
  if (model.provider !== "fal") throw new Error("Flux model config is misconfigured.");

  const endpoint = referenceImageUrl ? model.falImageToImage : model.falTextToImage;
  const body = referenceImageUrl ? { prompt, image_url: referenceImageUrl } : { prompt };

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
