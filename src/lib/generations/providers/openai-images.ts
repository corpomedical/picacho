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
  referenceImageUrl?: string | null,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to .env.local, or turn off the " +
        "'real_ai_providers' flag in Admin > Feature flags to use the mock pipeline.",
    );
  }

  let res: Response;

  if (referenceImageUrl) {
    // Anchor to the character's existing reference photo so the result
    // actually looks like the same character (image edit / identity lock).
    const imageBlob = await fetchAsBlob(referenceImageUrl);
    const form = new FormData();
    form.set("model", "gpt-image-2");
    form.set("prompt", prompt);
    form.set("image", imageBlob, "reference.png");

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
    throw new Error(`OpenAI image API error (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json as string | undefined;
  if (!b64) throw new Error("OpenAI didn't return image data.");
  return b64;
}
