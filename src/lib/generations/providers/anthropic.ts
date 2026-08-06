// Draft step — Claude expands the user's plain-language request into an
// engineered prompt using the character rulebook. Plain `fetch`, no SDK, so
// no extra package install is needed.

import { fetchWithTimeout } from "@/lib/generations/providers/fetch-with-timeout";

export async function draftWithClaude(instructions: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local, or turn off the " +
        "'real_ai_providers' flag in Admin > Feature flags to use the mock pipeline.",
    );
  }

  const res = await fetchWithTimeout(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 500,
        messages: [{ role: "user", content: instructions }],
      }),
    },
    25_000,
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API error (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.content?.[0]?.text as string | undefined;
  if (!text) throw new Error("Claude returned an empty response.");
  return text.trim();
}
