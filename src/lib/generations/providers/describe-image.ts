// Prompt Studio, image mode: read a picture and write the prompt that would
// recreate it.
//
// Same provider and model family as the identity scorer next door, and the
// same URL-in contract — vision here always takes a publicly fetchable URL
// (an absolutized /api/media capability URL or a signed storage URL), never
// base64.
//
// Two modes, and the difference is the whole point of doing this inside a
// character-consistency product:
//
//   "scene"      — describes light, wardrobe, setting, lens and composition,
//                  and refers to the person only as "the subject". Used when
//                  a character is selected, because describing a DIFFERENT
//                  face in the prompt fights the identity photo the
//                  generator anchors on, and the model resolves that
//                  conflict by averaging the two into someone who is neither.
//                  This is a quality decision first and a caution second.
//
//   "standalone" — describes everything including the person, for users
//                  generating without a character at all. The UI pairs this
//                  with a line about needing rights to the source image.

import { fetchWithTimeout } from "@/lib/generations/providers/fetch-with-timeout";

export type DescribeMode = "scene" | "standalone";

const SHARED_RULES =
  "Write ONE prompt of 2 to 4 sentences, no preamble, no markdown, no bullet points, no " +
  "title — just the prompt itself, as a fluent visual description someone could paste " +
  "straight into an image generator. Cover, in prose rather than as a list: the setting and " +
  "time of day, the quality and direction of the light, wardrobe and materials, the pose and " +
  "framing, the lens and depth of field, and the overall colour and mood. Describe only what " +
  "is actually visible — never invent a brand, a location name, or a detail you cannot see. " +
  "Describe people plainly and respectfully; do not stack intensifiers like " +
  '"hyper-realistic" or "ultra-detailed", and avoid suggestive or body-focused phrasing.';

const MODE_RULES: Record<DescribeMode, string> = {
  scene:
    "Do NOT describe the person's face, hair, age, ethnicity or body — refer to them only as " +
    '"the subject". Their identity comes from elsewhere and any description of it here would ' +
    "conflict with it. Everything around them is yours to describe in full detail.",
  standalone:
    "Describe the person as well — their appearance, hair, expression and clothing — since no " +
    "separate character reference will be supplied. Do not name or speculate about who they " +
    "are, even if they look familiar; describe only what is visible.",
};

// Character render style (Send Receipt P3): is this character a photoreal
// human or an illustrated/mascot design? Decides which Seedance lane fits —
// ByteDance's 2.5 rejects photoreal people outright. One look at the
// primary reference photo when the photo set changes; null on any doubt or
// failure, which keeps the heuristic fallback in charge.
export async function classifyRenderStyle(
  imageUrl: string,
): Promise<"photoreal" | "illustrated" | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
    const res = await fetchWithTimeout(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  // Asks the question the FENCE actually needs, which is not
                  // "what medium is this" but "would ByteDance's likeness
                  // check see a real person here".
                  //
                  // Found 2026-08-31 by running the backfill twice: a
                  // character whose photo is a photorealistic BUTTERFLY came
                  // back "photoreal" on one run and "illustrated" on the
                  // next. Neither answer fit, because the old wording
                  // presupposed a person was depicted and left the model to
                  // guess when none was. A coin flip decided whether a fence
                  // fired. Non-human subjects now have one correct answer.
                  text:
                    "Answer with EXACTLY one word.\n\n" +
                    "Would a viewer take this image to show a REAL HUMAN BEING — a " +
                    "photograph of a person, or a render indistinguishable from one? " +
                    "Answer 'photoreal'.\n\n" +
                    "Anything else at all — a drawing, anime, a 3D cartoon, a mascot, a " +
                    "painting, a logo, a product, an animal, an object, a landscape, or " +
                    "an empty scene — answer 'illustrated'.\n\n" +
                    "The question is only whether a real human is depicted. If no human " +
                    "is depicted at all, the answer is 'illustrated'.",
                },
                { type: "image_url", image_url: { url: imageUrl } },
              ],
            },
          ],
          // Same generous ceiling as every vision call here: gpt-5.4-mini
          // spends completion tokens on internal reasoning BEFORE the visible
          // text — a tight cap returns an EMPTY answer, not a shorter one
          // (the exact silent failure that broke role auto-detection,
          // operator report 2026-08-25).
          max_completion_tokens: 2000,
        }),
      },
      20_000,
    );

    if (!res.ok) return null;
    const data = await res.json();
    const text = String(data?.choices?.[0]?.message?.content ?? "").trim().toLowerCase();
    if (text.includes("photoreal")) return "photoreal";
    if (text.includes("illustrated")) return "illustrated";
    return null;
  } catch {
    return null;
  }
}

// Prop description (Send Receipt P5): a short spec of the THING in a
// prop-role photo — a specific dog, car, product — for models that can't
// take the photo itself. Same null-on-failure contract as everything here.
export async function describeSubjectImage(imageUrl: string): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
    const res = await fetchWithTimeout(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text:
                    "Describe the main subject of this photo in 1-2 sentences of plain prose so an " +
                    "image generator could reproduce it faithfully: what it is, breed/make/model if " +
                    "identifiable, exact colours and markings, size and distinctive details. Describe " +
                    "only the subject — ignore background and people. No preamble, no markdown.",
                },
                { type: "image_url", image_url: { url: imageUrl } },
              ],
            },
          ],
          // Same generous ceiling as every vision call here: gpt-5.4-mini
          // spends completion tokens on internal reasoning BEFORE the visible
          // text — a tight cap returns an EMPTY answer, not a shorter one
          // (the exact silent failure that broke role auto-detection,
          // operator report 2026-08-25).
          max_completion_tokens: 2000,
        }),
      },
      30_000,
    );

    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string") return null;
    const cleaned = text.trim().replace(/^["']|["']$/g, "");
    return cleaned.length > 0 ? cleaned.slice(0, 500) : null;
  } catch {
    return null;
  }
}

// Outfit-on-the-character (2026-08-24): turn a clothing photo — typically a
// product shot or flat-lay with no person in it — into a precise garment spec.
// Written ONCE when the character is saved and stored on the row
// (character_profiles.outfit_description), then injected into prompt drafting
// for models whose endpoints can't take a clothing reference photo (the Kling
// family — their inputs are person references only). Same provider, same
// URL-in contract, same null-on-any-failure behavior as the prompt describer
// above: a vision hiccup degrades to "no description", never a failed save.
export async function describeOutfitImage(imageUrl: string): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
    const res = await fetchWithTimeout(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text:
                    "This is a photo of clothing (often a product shot or flat-lay). Write a precise " +
                    "spec of the outfit in 1 to 3 sentences of plain prose — no preamble, no markdown, " +
                    "no bullet points. Cover: each garment's type and cut, exact colours, any visible " +
                    "logos or printed text (transcribe wordmarks exactly as written), stitching and trim " +
                    "details, fabric finish, and fit. Describe only the clothing — ignore any person, " +
                    "background, or props, and never invent a brand or detail you cannot actually see.",
                },
                { type: "image_url", image_url: { url: imageUrl } },
              ],
            },
          ],
          max_completion_tokens: 2000,
        }),
      },
      30_000,
    );

    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string") return null;
    const cleaned = text.trim().replace(/^["']|["']$/g, "");
    // Generous but bounded — this lands verbatim inside prompt drafting, where
    // rule lines are capped at 1000 chars (see sanitizeRuleText in pipeline.ts).
    return cleaned.length > 0 ? cleaned.slice(0, 600) : null;
  } catch {
    return null;
  }
}

export async function describeImageAsPrompt(
  imageUrl: string,
  mode: DescribeMode,
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
    const res = await fetchWithTimeout(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text:
                    "You are a prompt engineer. Look at this image and write the text-to-image " +
                    "prompt that would produce a picture like it. " +
                    MODE_RULES[mode] +
                    " " +
                    SHARED_RULES,
                },
                { type: "image_url", image_url: { url: imageUrl } },
              ],
            },
          ],
          // Same generous ceiling as the scorer: this model family spends
          // completion tokens on internal reasoning before the visible text,
          // and a tight cap truncates the answer rather than shortening it
          // (the exact failure that broke drafting — see anthropic.ts).
          max_completion_tokens: 2000,
        }),
      },
      30_000,
    );

    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string") return null;
    const cleaned = text.trim().replace(/^["']|["']$/g, "");
    return cleaned.length > 0 ? cleaned : null;
  } catch {
    return null;
  }
}
