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

  const call = (withThinkingParam: boolean) =>
    fetchWithTimeout(
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
          // 500 was far too small: claude-sonnet-5 spends output tokens on
          // internal reasoning before the visible text, so on harder
          // requests the draft came back cut off after a few words
          // (stop_reason=max_tokens — real incidents, 2026-08-13/14,
          // including the soften-for-safety retry dying the same way and
          // dumping generations onto Flux). Thinking is disabled outright —
          // these are short formatting tasks that don't need it — and the
          // ceiling is high enough that a 2-4 sentence prompt can never
          // hit it.
          max_tokens: 3000,
          // No `temperature`: claude-sonnet-5 rejects the parameter as
          // deprecated (400, measured 2026-09-11). Determinism on the
          // content policy's readings comes from the OpenAI readers' seed
          // and from the majority vote, not from this call.
          ...(withThinkingParam ? { thinking: { type: "disabled" } } : {}),
          messages: [{ role: "user", content: instructions }],
        }),
      },
      25_000,
    );

  let res = await call(true);
  // A 429 is a queue, not an answer: wait what the server asks (capped) and
  // ask once more. The content policy's backup reader fails closed on an
  // unreadable reply, so a rate-limit blip must not read as an outage.
  if (res.status === 429) {
    const sec = Number(res.headers.get("retry-after"));
    await new Promise((r) => setTimeout(r, Number.isFinite(sec) && sec > 0 ? Math.min(sec * 1000, 5000) : 1500));
    res = await call(true);
  }

  if (!res.ok) {
    const text = await res.text();
    // Defensive: if this API/model version rejects the thinking parameter
    // itself, retry once without it rather than failing the whole draft over
    // an optional optimization.
    if (res.status === 400 && text.includes("thinking")) {
      res = await call(false);
      if (!res.ok) {
        const retryText = await res.text();
        throw new Error(`Claude API error (${res.status}): ${retryText.slice(0, 300)}`);
      }
    } else {
      throw new Error(`Claude API error (${res.status}): ${text.slice(0, 300)}`);
    }
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
  // A partial answer is worse than no answer here. stop_reason other than a
  // normal end ("max_tokens", "refusal", ...) means the text cuts off
  // mid-thought — real incident, 2026-08-13: a draft stopped after eight
  // words, the review step "completed" it from the rulebook alone, and the
  // user's requested scene (a Paris cafe meeting) vanished from the final
  // image. Throwing routes the pipeline to its deterministic fallback,
  // which keeps the user's request verbatim.
  if (
    data?.stop_reason &&
    data.stop_reason !== "end_turn" &&
    data.stop_reason !== "stop_sequence"
  ) {
    throw new Error(`Claude's draft was cut short (stop_reason=${data.stop_reason}).`);
  }

  const text = textBlock.text.trim();

  // A PROSE REFUSAL IS NOT A DRAFT. Claude declining in a sentence comes back
  // with stop_reason "end_turn" and non-empty text, which is byte-identical
  // in shape to a successful rewrite — so before this check the refusal
  // itself became the prompt and was posted to the image provider. It is
  // visible in production: a fal 422 on 2026-09-09 carries
  // `"prompt": "I can't rewrite this prompt. The core instructio…"`.
  //
  // Throwing (rather than returning something) routes the caller to its
  // deterministic fallback, which keeps the user's typed request verbatim.
  // That is only safe because the request has already passed the platform
  // content policy at the entry point (lib/generations/content-policy.ts) —
  // before that gate existed, falling back here made a refused prompt MORE
  // likely to reach a provider, not less.
  //
  // Deliberately narrow: anchored to the opening of the reply, so a scene
  // description that happens to contain "I can't" in dialogue is untouched.
  if (/^(?:i(?:'m| am)? ?(?:can'?t|cannot|won'?t|not able|unable|sorry)|sorry[,.]|i apologi[sz]e)\b/i.test(text)) {
    throw new Error(`Claude declined to draft this prompt: ${text.slice(0, 120)}`);
  }

  return text;
}




// ---------------------------------------------------------------------------
// Cinema Studio's director
// ---------------------------------------------------------------------------

// Decomposes one sentence into a shot list.
//
// Deliberately NOT a creative-writing call. The director's whole job is to
// choose from a fixed, pre-tested vocabulary — the proven camera moves and
// looks in cinema-presets.ts — and to say what happens in each shot. Every
// other decision (which model renders it, how the character is anchored, what
// the block text actually says) is already made by code that has been proven
// on real renders. That is the same discipline the preset file itself
// records: nothing here guesses, classifies, or asks a model to do something
// unproven.
//
// Returns the PARSED JSON, unvalidated. normaliseScenePlan in scene-plan.ts is
// what makes it safe to spend money on, and it is unit-tested against exactly
// the kinds of nonsense this can return: invented preset ids, twenty shots, a
// duration the endpoint would reject. Keeping parsing and validation apart is
// what lets the validation be testable without a network.
export async function directScene(instructions: string): Promise<unknown> {
  // Reuses the draft call so there is ONE Anthropic request shape in this
  // file — same model, same timeout, same empty-response and cut-short
  // handling, including the retry for API versions that reject the thinking
  // parameter. A second hand-rolled fetch would drift from it.
  const text = await draftWithClaude(instructions);

  // Models wrap JSON in markdown fences often enough that refusing it would
  // be a self-inflicted failure. Strip a fence if present, then fall back to
  // the outermost braces — cheaper and more reliable than asking again.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const braced =
    candidate.startsWith("{") && candidate.endsWith("}")
      ? candidate
      : candidate.slice(candidate.indexOf("{"), candidate.lastIndexOf("}") + 1);

  try {
    return JSON.parse(braced);
  } catch {
    // Null rather than a throw: the caller turns this into "the director
    // couldn't plan that scene, nothing was charged", which is a better
    // outcome than a crash on a step that costs a fraction of a cent and has
    // spent no render money yet.
    return null;
  }
}
