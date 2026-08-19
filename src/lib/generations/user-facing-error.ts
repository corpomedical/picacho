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
export function isRawProviderError(message: string): boolean {
  return RAW_PROVIDER_ERROR_PREFIX.test(message) || LOOKS_LIKE_JSON_BLOB.test(message);
}

export function toUserFacingError(message: string): string {
  if (isRawProviderError(message)) {
    return "Something went wrong generating that. Please try again in a moment.";
  }
  return message;
}
