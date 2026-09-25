// Whether a failure means the MODEL is broken (2026-08-31: extracted from
// model-health.ts so it can be tested — that module imports the admin client
// through "@/", which vitest-without-config cannot resolve).
//
// Failures that mean the MODEL is broken, as opposed to this particular
// request being unreasonable.
//
// The distinction matters: counting a rejected prompt as a provider failure
// would let three people writing content-policy-violating prompts take a
// perfectly healthy model offline for everyone. Only infrastructure-shaped
// failures count.
export function isProviderFault(message: string): boolean {
  const m = message.toLowerCase();
  // Matched against fal's REAL tokens, not English prose. The original list
  // said "content policy" with a space, while fal writes
  // "content_policy_violation" — so every Seedance 2.5 likeness refusal was
  // counted as the MODEL failing. Observed in production on 2026-08-31:
  // seedance sat at consecutive_failures = 20 from one user's rejected
  // photos, one distinct-user short of the breaker silently substituting a
  // different model for everyone. A rejection is the provider ANSWERING,
  // not the provider being down.
  const requestFault =
    m.includes("content policy") ||
    m.includes("content_policy") ||
    // ModelArk's spelling of the same event. Its three refusal codes —
    // InputImageSensitiveContentDetected, InputTextSensitiveContentDetected,
    // OutputVideoSensitiveContentDetected — share this substring and share
    // none of the tokens above, so without it a BytePlus likeness refusal
    // would count as the MODEL being down and march Seedance toward the
    // breaker on nothing but rejected photos. That is the exact bug this
    // list was rewritten to fix for fal on 2026-08-31.
    m.includes("sensitivecontentdetected") ||
    m.includes("moderation") ||
    m.includes("nsfw") ||
    m.includes("safety") ||
    m.includes("likeness") ||
    m.includes("invalid prompt") ||
    m.includes("prompt is too long") ||
    m.includes("partner_validation") ||
    m.includes("aspect_ratio") ||
    m.includes("invalid parameters");
  if (requestFault) return false;
  // Any 4xx apart from 429 is the provider judging THIS request — bad input,
  // policy, auth scope — and says nothing about whether the model works for
  // the next person. 429 stays a provider fault on purpose: a stream of
  // rate-limit errors is capacity, which is exactly what the breaker is for.
  const status = m.match(/error \((4\d\d)\)/);
  if (status && status[1] !== "429") return false;
  return true;
}

// Moved here from pipeline.ts (2026-09-25) so a module that must stay light —
// report-constants.ts, read by client components and the admin's failure
// split — can use the one list instead of a copy. pipeline.ts imports it.
//
// Phrases a provider uses when it has decided the CONTENT is the problem.
// Retrying these is pure waste: the same prompt fails the same classifier
// every time, and each rejection can still cost a render (Flux returns a
// blacked-out image with HTTP 200 and bills for it). Deliberately distinct
// from a bare 400, which really can be transient — see the comment on
// NON_RETRYABLE_STATUS_CODES in pipeline.ts.
// A PROVIDER'S CONTENT REFUSAL IS TERMINAL. Getting this list wrong is how
// the removed soften-and-retry ladder survived one level up.
//
// Until 2026-09-09 this was written in English prose — /safety|nsfw|content
// policy|moderation|blocked by the provider/ — and matched NONE of the four
// refusal strings fal and BytePlus actually emit. fal answers
// `content_policy_violation`; ModelArk answers
// `InputTextSensitiveContentDetected` and its two siblings. Neither contains
// "content policy" with a space, so a content refusal fell through to the
// retry machinery and was re-drafted under an instruction whose stated
// purpose was that "plain description passes content filters far more
// reliably". That is the ladder, reassembled, in the file the removal
// never opened. (The instruction itself was rewritten on 2026-09-10 to give
// the drafter our own reasons instead — see the drafting prompt in pipeline.ts.)
//
// The tokens below are isProviderFault's list above, which got this right for
// the circuit breaker on 2026-08-31 — the same question ("did the provider judge
// this request, or is it down?") deserved the same answer in both places.
export const SAFETY_REJECTION =
  /content[_ ]polic|sensitivecontentdetected|safety|nsfw|moderation|likeness|blocked by the provider|invalid prompt/i;
