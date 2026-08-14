// Review step — a second model critiques/tightens the drafted prompt against
// the same rulebook. Using a different provider than the draft step on
// purpose, per the brief: an independent second opinion catches more misses
// than asking the same model to check its own work.

import { fetchWithTimeout } from "@/lib/generations/providers/fetch-with-timeout";

// Characters v2: image-level identity verification. Compares a finished
// generation against the character's identity photo (gallery photo #1) and
// returns a 0-100 similarity score with a short note. The old pipeline only
// ever validated PROMPT TEXT — "the word freckles appears" says nothing
// about the picture — so a wrong face sailed through and users found out by
// eye ("0 match"). Best-effort by design: any failure returns null and the
// generation stays fully usable, just unscored.
export async function scoreIdentityMatch(
  resultImageUrl: string,
  identityImageUrl: string,
  traitSummary: string,
): Promise<{ score: number; notes: string } | null> {
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
                    "The first image is a character's identity reference photo. The second is a " +
                    "newly generated image meant to depict the SAME person" +
                    (traitSummary ? ` (saved traits: ${traitSummary})` : "") +
                    ". Score 0-100 how convincingly the generated image shows the same person — " +
                    "face, hair, and distinguishing features weigh most; clothing, pose, " +
                    "lighting, and setting are expected to differ and must not lower the score. " +
                    'Reply with ONLY minified JSON: {"score": <integer 0-100>, "notes": "<one ' +
                    'short sentence about what differs, or an empty string>"}',
                },
                { type: "image_url", image_url: { url: identityImageUrl } },
                { type: "image_url", image_url: { url: resultImageUrl } },
              ],
            },
          ],
          // Generous ceiling on purpose: this model family spends completion
          // tokens on internal reasoning first, and a tight cap truncates the
          // visible answer (the exact failure that broke drafting — see
          // anthropic.ts, 2026-08-14).
          max_completion_tokens: 2000,
        }),
      },
      30_000,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content as string | undefined;
    const jsonMatch = text?.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as { score?: unknown; notes?: unknown };
    const score = Math.round(Number(parsed.score));
    if (!Number.isFinite(score) || score < 0 || score > 100) return null;
    return { score, notes: typeof parsed.notes === "string" ? parsed.notes.slice(0, 300) : "" };
  } catch {
    return null;
  }
}

export async function reviewWithOpenAI(instructions: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to .env.local, or turn off the " +
        "'real_ai_providers' flag in Admin > Feature flags to use the mock pipeline.",
    );
  }

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
        messages: [{ role: "user", content: instructions }],
        // OpenAI deprecated `max_tokens` in favor of this for current chat
        // models (gpt-5.4-mini and newer reject max_tokens outright with a
        // 400 "unsupported_parameter" error) — found via a real end-to-end
        // test run, 2026-08-07.
        max_completion_tokens: 500,
      }),
    },
    25_000,
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content as string | undefined;
  if (!text) throw new Error("OpenAI returned an empty response.");
  return text.trim();
}
