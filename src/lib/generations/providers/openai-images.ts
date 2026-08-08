// Image generation via OpenAI's GPT Image 2 — the recommended default.
// Returns raw base64 image data; the caller is responsible for persisting it
// (OpenAI's image endpoints don't return a durable hosted URL).

import { fetchWithTimeout } from "@/lib/generations/providers/fetch-with-timeout";

async function fetchAsBlob(url: string): Promise<Blob> {
  const res = await fetchWithTimeout(url, {}, 20_000);
  if (!res.ok) throw new Error(`Couldn't fetch the reference image (${res.status}).`);
  return res.blob();
}

export async function generateImageWithOpenAI(
  prompt: string,
  referenceImageUrl?: string | string[] | null,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to .env.local, or turn off the " +
        "'real_ai_providers' flag in Admin > Feature flags to use the mock pipeline.",
    );
  }

  let res: Response;

  // Normalize to an array so the single-photo (ordinary) and multi-photo
  // (multi-character) cases can share one code path below.
  const referenceUrls = Array.isArray(referenceImageUrl)
    ? referenceImageUrl
    : referenceImageUrl
      ? [referenceImageUrl]
      : [];

  if (referenceUrls.length > 0) {
    // Anchor to the character's existing reference photo(s) so the result
    // actually looks like the same character(s) (image edit / identity
    // lock). OpenAI's /v1/images/edits accepts multiple images via repeated
    // image[] fields — with 2+, it composites all of them into one result
    // instead of editing just one, which is exactly what multi-character
    // generations need.
    const imageBlobs = await Promise.all(referenceUrls.map((url) => fetchAsBlob(url)));
    const form = new FormData();
    form.set("model", "gpt-image-2");
    form.set("prompt", prompt);
    if (imageBlobs.length === 1) {
      form.set("image", imageBlobs[0], "reference.png");
    } else {
      imageBlobs.forEach((blob, i) => form.append("image[]", blob, `reference-${i}.png`));
    }

    res = await fetchWithTimeout(
      "https://api.openai.com/v1/images/edits",
      {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}` },
        body: form,
      },
      60_000,
    );
  } else {
    res = await fetchWithTimeout(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: "gpt-image-2", prompt, size: "1024x1024" }),
      },
      60_000,
    );
  }

  if (!res.ok) {
    const text = await res.text();
    // GPT Image's safety classifier is aggressive and rejects a lot of
    // perfectly innocent descriptions (it flags this as a distinct
    // "image_generation_user_error" with a safety_violations list). Dumping
    // that raw JSON — including OpenAI's internal request ID — straight into
    // the UI is neither helpful nor good practice, so this specific case
    // gets a plain, actionable message instead. Anything else (auth,
    // billing, rate limit, etc.) still surfaces the real API response, since
    // that detail is what's actually useful for debugging those.
    if (text.includes("safety system") || text.includes("safety_violations")) {
      throw new Error(
        "That description was flagged by OpenAI's safety filter and couldn't be generated. " +
          "Try simpler, unambiguous wording (for example, describing age and appearance " +
          "plainly rather than combining conflicting details), or upload a photo instead.",
      );
    }
    throw new Error(`OpenAI image API error (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json as string | undefined;
  if (!b64) throw new Error("OpenAI didn't return image data.");
  return b64;
}
