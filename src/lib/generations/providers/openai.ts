// Review step — a second model critiques/tightens the drafted prompt against
// the same rulebook. Using a different provider than the draft step on
// purpose, per the brief: an independent second opinion catches more misses
// than asking the same model to check its own work.

import { fetchWithTimeout } from "@/lib/generations/providers/fetch-with-timeout";

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
