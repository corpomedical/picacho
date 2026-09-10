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
//   3. No money claim, because the true one depends on the path. A character
//      photo's allowance always comes back (characters/actions.ts). A layer
//      edit is force-refunded and appends its own "Nothing was charged." after
//      this text (actions.ts). A render's credit is NOT force-refunded: these
//      sentences carry no "error (4xx)", so forceRefundEligible never sees a
//      provider rejection, and the refund waits on the automatic_refunds
//      switch and the daily refund cap. For Flux that is the rule working —
//      fal billed the blacked-out render. For OpenAI's refusal, a 400, it is
//      a gap against the pricing FAQ, which promises that a provider refusal
//      before rendering never counts against your generations. Found
//      2026-09-10 and left for the operator, because whether OpenAI bills a
//      refused request decides which way it should close. A sentence
//      shown on all three paths may only say what is true on all three.

/**
 * GPT Image refused the request (HTTP 400, "safety system" /
 * safety_violations). Nothing comes back, so nothing was generated.
 */
export const IMAGE_REQUEST_REFUSED =
  "This request was refused by the image model's safety system, so nothing was generated.";

/**
 * Flux's checker flagged the finished image. fal answers 200 with a black
 * frame in its place, so something WAS rendered (and billed) — it just can't
 * be shown. Kept under 160 characters: the layer-edit lane slices there.
 */
export const IMAGE_RESULT_REFUSED =
  "This image was refused by the image model's safety system, so it can't be shown.";

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
