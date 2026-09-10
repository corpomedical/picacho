// Review step — a second model critiques/tightens the drafted prompt against
// the same rulebook. Using a different provider than the draft step on
// purpose, per the brief: an independent second opinion catches more misses
// than asking the same model to check its own work.

import { fetchWithTimeout } from "@/lib/generations/providers/fetch-with-timeout";
import { utilityModel } from "@/lib/generations/providers/openai-model";
import { identityScorerVersion } from "@/lib/generations/scorer-version";

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
): Promise<{ score: number; notes: string; unusable: boolean; scorerVersion: string } | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const model = utilityModel();
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
                    "Also judge whether the second image is usable AT ALL: set unusable to true " +
                    "only if it is essentially a solid black/blank frame, corrupted, or failed " +
                    "to load — never merely because it looks different from the reference. " +
                    'Reply with ONLY minified JSON: {"score": <integer 0-100>, "notes": "<one ' +
                    'short sentence about what differs, or an empty string>", "unusable": ' +
                    "<true|false>}",
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
    const parsed = JSON.parse(jsonMatch[0]) as {
      score?: unknown;
      notes?: unknown;
      unusable?: unknown;
    };
    const score = Math.round(Number(parsed.score));
    if (!Number.isFinite(score) || score < 0 || score > 100) return null;
    return {
      score,
      notes: typeof parsed.notes === "string" ? parsed.notes.slice(0, 300) : "",
      unusable: parsed.unusable === true,
      // Stamped next to the value it qualifies, so a score is never a bare
      // number whose origin has to be guessed from its timestamp.
      scorerVersion: identityScorerVersion(utilityModel()),
    };
  } catch {
    return null;
  }
}

function retryAfterMs(res: Response): number {
  const ms = Number(res.headers.get("retry-after-ms"));
  if (Number.isFinite(ms) && ms > 0) return Math.min(ms, 5000);
  const sec = Number(res.headers.get("retry-after"));
  if (Number.isFinite(sec) && sec > 0) return Math.min(sec * 1000, 5000);
  return 1500;
}

export async function reviewWithOpenAI(
  instructions: string,
  // Defaults preserve the original behaviour for every existing caller; the
  // content policy passes its own, because a SAFETY verdict that changes
  // between identical runs is not a verdict. Measured 2026-09-09: the same
  // 75-case eval scored 0 and then 2 over-refusals on identical code, purely
  // from sampling — deterministic scoring is what makes the number quotable.
  opts: { temperature?: number; maxTokens?: number; seed?: number; model?: string } = {},
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to .env.local, or turn off the " +
        "'real_ai_providers' flag in Admin > Feature flags to use the mock pipeline.",
    );
  }

  // `model` lets a caller name a specific reader — the content policy's
  // vote at a band edge asks a second, larger model — without changing the
  // default every other caller relies on.
  const model = opts.model || utilityModel();

  // A 429 is a queue, not an answer. The content policy fails closed on an
  // unreadable reply, so a rate-limit blip under a burst of renders would
  // turn into refusals; wait what the server asks (capped) and ask once
  // more before giving up.
  const send = () => fetchWithTimeout(
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
        // Raised from a flat 500 for callers that ask: gpt-5.4-mini spends
        // tokens on internal reasoning before it writes, and a tight cap
        // truncates the answer into an unparseable fragment — the same
        // failure providers/anthropic.ts records and fixed at 3000.
        max_completion_tokens: opts.maxTokens ?? 500,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        // Best-effort determinism on top of temperature 0 (2026-09-10): two
        // identical requests with the same seed are served the same sample
        // wherever the backend can manage it.
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
      }),
    },
    25_000,
  );
  let res = await send();
  for (let retry = 0; retry < 2 && res.status === 429; retry++) {
    await new Promise((r) => setTimeout(r, Math.max(1000, retryAfterMs(res))));
    res = await send();
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content as string | undefined;
  if (!text) throw new Error("OpenAI returned an empty response.");
  return text.trim();
}
