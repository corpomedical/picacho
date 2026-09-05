// Every AI provider file (openai.ts, openai-images.ts, fal.ts, fal-image.ts,
// anthropic.ts) throws on a failed HTTP call using the same shape:
// "<Provider name/context> error (<status>): <raw response body>" — often a
// JSON blob straight from the provider, sometimes including an internal
// request ID. That's exactly the detail an admin needs (it lands in
// pipeline_log / generation_reports for /admin/reports), but it must never
// reach an end user verbatim — a wall of JSON looks broken, not like a real
// product. Anywhere a caught error's .message is about to be shown to a
// user, run it through this first.
//
// Messages we wrote ourselves (missing API key, "describe them first",
// the OpenAI safety-filter message in openai-images.ts, etc.) don't match
// either pattern below and pass through unchanged — only actual raw
// provider dumps get swapped for a generic, safe fallback.
const RAW_PROVIDER_ERROR_PREFIX = /^[\w.() -]+ error \(\d+\):/i;
const LOOKS_LIKE_JSON_BLOB = /[{[]\s*"/;

// Exported for render-time gating: pipeline_log step details keep the raw
// provider text (admins need it in /admin/reports and the history page),
// so surfaces that show step details to END USERS use this to decide when
// to swap in a localized generic line instead. Reported 2026-08-19: a
// failed render's history page showed the owner a full fal.ai 422 JSON
// dump, provider names, docs URLs and all.
// The one action-level error pollGeneration returns (actions.ts). Exported
// so both poll loops can recognize it as TRANSIENT: a cookie-refresh race
// after long backgrounding in the WebView made getUser() blip while the paid
// render kept going at fal — and the bubble went red over a render that
// later succeeded into History. "We couldn't check" is not "the job failed".
export const SESSION_EXPIRED_MESSAGE = "Your session expired — please log in again.";

export function isRawProviderError(message: string): boolean {
  return RAW_PROVIDER_ERROR_PREFIX.test(message) || LOOKS_LIKE_JSON_BLOB.test(message);
}

// The two failure shapes a NON-CODER actually hit (2026-08-29, operator,
// after reading a real user's failure screen: "For a normal everyday user
// that has no idea with coding, the msg was unclear"). What she saw was our
// own budget-exhausted sentence — "This request already used its 3
// generation attempts without producing a usable image" — developer-speak
// that passed the raw-dump filter because we wrote it. Worse, it REPLACED
// the useful cause: the real story ("Invalid image file", her photo was
// unreadable) sat in attempts 1–2, and the summary only ever read the last
// attempt — the same last-attempt blindness the refund rule had.
//
// So failures are now CLASSIFIED across every attempt, and the one cause a
// user can actually fix themselves (the attached photo couldn't be read)
// beats every generic line. The attachment patterns are gated on
// isRawProviderError so a prompt that merely contains the words "invalid
// image" can never trigger the wrong message.
const ATTACHMENT_REJECTED = /invalid image|unsupported image|please check your image|image_parse/i;
const BUDGET_EXHAUSTED = /already used its \d+ generation attempts/;

export type KnownFailureKind = "attachment" | "attempts";

export function classifyFailureDetails(details: Array<string | undefined>): KnownFailureKind | null {
  const all = details.filter((d): d is string => typeof d === "string");
  // The 4xx gate matters because of what the "attachment" copy PROMISES:
  // "failed tries don't use up your credits." That is true for a provider
  // REJECTION (a 4xx force-refunds, past the switch and past the daily cap)
  // and not necessarily true for anything else — a 5xx that happens to say
  // "invalid image" stays behind the refunds flag, so showing the promise
  // there made the app lie about money (2026-08-31 inspection).
  if (all.some((d) => isRawProviderError(d) && /\(4\d\d\)/.test(d) && ATTACHMENT_REJECTED.test(d))) {
    return "attachment";
  }
  if (all.some((d) => BUDGET_EXHAUSTED.test(d))) return "attempts";
  return null;
}

// For step-list rendering: the budget sentence is ours (not a raw dump), so
// the isRawProviderError gate lets it through — surfaces swap it for a
// localized line with this check instead.
export function isBudgetExhaustedDetail(message: string): boolean {
  return BUDGET_EXHAUSTED.test(message);
}

export function toUserFacingError(message: string): string {
  if (isRawProviderError(message)) {
    if (ATTACHMENT_REJECTED.test(message)) {
      return "We couldn't read the photo you attached, so nothing was generated. A regular photo (JPG or PNG) works best — try re-saving or re-taking it, then send it again.";
    }
    return "Something went wrong generating that. Please try again in a moment.";
  }
  return message;
}
