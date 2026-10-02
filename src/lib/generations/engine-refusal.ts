import { IMAGE_REQUEST_REFUSED, IMAGE_RESULT_REFUSED } from "./providers/refusal-messages";

// Which picture refusals may offer another engine (operator, 2026-10-02: a
// condom-box product shot cleared Picacho's own check on every wording and
// was still turned away → drafts at claude.ai/artifact/7MEQAvkT4VufEiy5Mu75Pj
// → fix 1, B: "Offer another engine, when our check found nothing").
//
// THE RULE IT BENDS, AND WHY THIS IS NOT THAT. Since 2026-09-10 a refusal
// never suggests another engine (refusal-messages.ts): on Google Play a
// "try a different model" line reads as advice for getting sexual content
// past a filter. That stays true for every refusal WE make. This offer exists
// only when our own gate read the request and found nothing (it ran first,
// or the engine would never have been called), our check of the finished
// picture did not refuse it, and the ENGINE's filter said no. The other
// engine gets both of our checks again, before and after.
//
// Read from the attempt log, never from the sentence a person sees: the
// engine's two refusal sentences are server English that only the display
// translates (refusal-messages.ts point 2), and our gates mark their own
// attempts with an issue.

type Attempt = { issues?: string[] | null; steps?: { detail?: unknown }[] | null } | null | undefined;

/** Our own content gate on the words (pipeline.ts) and our check of the finished picture (refund-rules.ts OUTPUT_BLOCKED_ISSUE). */
const OUR_REFUSALS = ["content_policy", "output_blocked"];

/** The run ended on the picture engine's own filter, and on nothing of ours. */
export function refusedByEngineOnly(log: unknown): boolean {
  const attempts = (Array.isArray(log) ? log : []) as Attempt[];
  if (attempts.some((a) => a?.issues?.some((i) => OUR_REFUSALS.includes(i)))) return false;
  return attempts.some((a) =>
    (a?.steps ?? []).some((s) => typeof s?.detail === "string" && (s.detail.includes(IMAGE_REQUEST_REFUSED) || s.detail.includes(IMAGE_RESULT_REFUSED))),
  );
}

/** The engine to offer instead: Seedream 5.0 Pro, or GPT Image when Seedream was the one that refused. */
export function otherPictureEngine(refusedOn: string | null): "seedream-5-pro" | "gpt-image" {
  return refusedOn === "seedream-5-pro" ? "gpt-image" : "seedream-5-pro";
}
