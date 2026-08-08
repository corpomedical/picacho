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
  // Scan every content block for the first one with real text, rather than
  // only ever trusting content[0] — Claude's response can include non-text
  // blocks (e.g. a thinking block) ahead of the actual text block, and
  // content[0].text would be undefined in that case even though the model
  // did produce a usable response. Real incident, 2026-08-08: a retried
  // generation failed 3/3 attempts with a bare "empty response" and no way
  // to tell why — this both fixes the case where a real answer was sitting
  // later in the array, and (if the response genuinely has no text
  // anywhere) surfaces the actual stop_reason and raw payload instead of a
  // dead-end message, so the next failure is diagnosable.
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const textBlock = blocks.find(
    (block: unknown): block is { text: string } =>
      typeof block === "object" && block !== null && typeof (block as { text?: unknown }).text === "string" &&
      (block as { text: string }).text.length > 0,
  );
  if (!textBlock) {
    const stopReason = data?.stop_reason ? ` stop_reason=${data.stop_reason}` : "";
    throw new Error(
      `Claude returned an empty response.${stopReason} ${JSON.stringify(data).slice(0, 300)}`,
    );
  }
  return textBlock.text.trim();
}
