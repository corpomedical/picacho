// What a person is told when an image model's OWN safety system refuses.
//
// No imports on purpose, so refusal-messages.test.ts can load it:
// openai-images.ts and fal-image.ts both import through "@/", which vitest
// cannot resolve.
//
// These follow content-policy.ts's rule, for the same reason (2026-09-09,
// Google Play: Sexual Content and AI-Generated Content): a refusal says the
// request was refused, and stops there. It never tells the person how to get
// the same thing through. Until 2026-09-10 the OpenAI line advised "simpler,
// unambiguous wording (for example, describing age and appearance plainly
// rather than combining conflicting details), or upload a photo instead", and
// the Flux line "plainer wording for the outfit and pose". That is the
// softenPromptForSafety ladder removed from image.ts the day before, handed
// to the person as advice — and the age example reads as advice for getting
// age-ambiguous content past a filter.
//
// No redirect either, unlike refusalMessages ("Describe a scene instead"):
// that one knows which category it refused, and a provider's refusal does
// not tell us. Any suggestion here would be a guess, and a guess is either an
// accusation or a hint.
//
// What refusal-messages.test.ts pins, and why each part matters:
//
//   1. No coaching. REFUSAL_COACHING below, which content-policy.ts's
//      refusalMessages answer to as well.
//
//   2. TERMINAL. Both contain "safety", which pipeline.ts's SAFETY_REJECTION
//      reads to stop retrying and provider-fault.ts reads to keep a refusal
//      from counting toward the model breaker. A rewording that drops the
//      word turns a refusal back into something the pipeline retries: the
//      ladder, one level down.
//
//   3. A money claim only where every path makes it true. A sentence shown on
//      several paths may only say what is true on all of them.
//
//      IMAGE_REQUEST_REFUSED says nothing was charged, and it is true
//      wherever it can appear. On a render, the pipeline marks the attempt
//      REFUSED_BEFORE_RENDER_ISSUE whenever readOpenAiRefusal below picks
//      this sentence, and forceRefundEligible refunds that marker past the
//      automatic_refunds switch and the daily cap (refund-rules.ts, which
//      also holds the ledger reading that shows OpenAI bills nothing for such
//      a refusal). A character photo's allowance always comes back
//      (characters/actions.ts).
//
//      IMAGE_RESULT_REFUSED says nothing about money, because on a render it
//      is NOT force-refunded: a picture was made before it was refused. fal
//      answers 200 with a blacked-out frame and bills it, and OpenAI's
//      output-stage block refuses "a generated image". The credit comes back
//      through the automatic_refunds switch and under the daily cap, which is
//      the charge-iff-we-were-charged rule working. (A layer edit is
//      force-refunded anyway and appends its own "Nothing was charged." after
//      this sentence — actions.ts.)
//
//      Until 2026-09-10 neither sentence could promise anything: the OpenAI
//      refusal carried no "error (4xx)" for forceRefundEligible to find, so it
//      rode the capped path too, against a pricing FAQ that says a refusal
//      before rendering never counts.

/**
 * GPT Image refused the request before drawing anything (HTTP 400). Nothing
 * comes back, nothing was generated, and nothing was charged — see point 3.
 */
export const IMAGE_REQUEST_REFUSED =
  "This request was refused by the image model's safety system, so nothing was generated and nothing was charged.";

/**
 * The image was made, then refused. Flux's checker: fal answers 200 with a
 * black frame in its place. GPT Image's output stage: OpenAI answers 400,
 * having blocked "a generated image". Either way something WAS rendered —
 * it just can't be shown. Kept under 160 characters: the layer-edit lane
 * slices there.
 */
export const IMAGE_RESULT_REFUSED =
  "This image was refused by the image model's safety system, so it can't be shown.";

/**
 * Reads an OpenAI image-API error body: null if it is not a safety refusal,
 * otherwise the sentence to show and whether the refusal came before
 * anything was rendered.
 *
 * OpenAI's image-generation guide names the refusal by `error.code =
 * "moderation_blocked"` ("use error.code as the stable discriminator") and
 * says it may carry `moderation_details.moderation_stage`: "input" (the
 * prompt or the request's images), "output" ("a generated image or downstream
 * output moderation stage") or "unknown". The body's own wording ("rejected
 * by the safety system … safety_violations=[…]") is matched too, because that
 * is what recognised every refusal on record.
 *
 * Only "output" says a picture was made. Input, unknown and no stage at all
 * count as refused before rendering. For the no-stage case that is measured,
 * not assumed: the one refusal in OpenAI's ledger was of that kind to us (we
 * discarded the body) and billed nothing (refund-rules.ts).
 */
export function readOpenAiRefusal(
  body: string,
): { message: string; beforeRender: boolean; stage: string | null } | null {
  let error: { code?: unknown; moderation_details?: { moderation_stage?: unknown } } | undefined;
  try {
    error = JSON.parse(body)?.error;
  } catch {
    // Not JSON — the wording checks below still apply.
  }
  const refused =
    error?.code === "moderation_blocked" ||
    body.includes("safety system") ||
    body.includes("safety_violations");
  if (!refused) return null;
  const rawStage = error?.moderation_details?.moderation_stage;
  const stage = typeof rawStage === "string" ? rawStage : null;
  return stage === "output"
    ? { message: IMAGE_RESULT_REFUSED, beforeRender: false, stage }
    : { message: IMAGE_REQUEST_REFUSED, beforeRender: true, stage };
}

/** Every provider refusal a person can read, for the test suite. */
export const providerRefusalMessages = {
  imageRequest: IMAGE_REQUEST_REFUSED,
  imageResult: IMAGE_RESULT_REFUSED,
} as const;

/**
 * What a refusal that coaches its way around itself looks like. A check on
 * OUR sentences, used only by the test suites — never run against anything a
 * person types. What a request means is content-policy.ts's job, and that
 * file keeps no word list on purpose; this is a lint on copy, which is why it
 * lives here and not there.
 *
 * Every refusal the product writes is tested against it: refusalMessages in
 * content-policy.ts, and the provider refusals above.
 *
 * Wider than its first version (rephras|reword|different wording|try
 * wording|adjust the wording), which passed both provider refusals it was
 * meant to stop — "Try simpler, unambiguous wording … or upload a photo
 * instead" and "Try plainer wording for the outfit and pose" — because
 * neither said "different" or "try" right before "wording". Coaching is
 * advice about PHRASING, or about another route to the same thing: another
 * input, another model. A refusal that names what IS allowed ("Describe a
 * scene instead") is not coaching, which is why "instead" alone is not here.
 */
export const REFUSAL_COACHING =
  /\b(?:rephras|reword|wording|phrasing|plainer|plainly|simpler|unambiguous)|\b(?:upload|attach)[^.]*\binstead\b|\b(?:another|different|other) (?:model|engine|provider)\b/i;
