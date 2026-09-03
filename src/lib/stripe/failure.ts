// Sorting a Stripe error into "will the same click fail again?" — the one
// question the checkout page has to answer before it tells someone to retry.
//
// Background (2026-09-03): for fifteen days every first-time buyer was refused
// with a deterministic 400 (customer_tax_location_invalid) and the page said
// "try again", so people tried again, and again, and nothing escalated. A
// Stripe invalid-request, authentication or permission error is a bug in OUR
// configuration and fails identically on every attempt; only network, API
// and rate-limit errors are worth a retry.

export type CheckoutFailureKind = "config" | "transient";

export type ClassifiedFailure = {
  kind: CheckoutFailureKind;
  /** Stripe's error code when it has one, else the error type, else "unknown". */
  code: string;
  message: string;
};

const CONFIG_ERROR_TYPES = new Set([
  "StripeInvalidRequestError",
  "StripeAuthenticationError",
  "StripePermissionError",
  "StripeIdempotencyError",
]);

export function classifyStripeFailure(err: unknown): ClassifiedFailure {
  const e = (err ?? {}) as { type?: unknown; code?: unknown; statusCode?: unknown; message?: unknown };
  const type = typeof e.type === "string" ? e.type : "";
  const code = typeof e.code === "string" ? e.code : "";
  const status = typeof e.statusCode === "number" ? e.statusCode : 0;
  const message =
    typeof e.message === "string" && e.message
      ? e.message
      : err instanceof Error
        ? err.message
        : String(err ?? "unknown error");
  // stripe-node builds a StripeRateLimitError for HTTP 429 AND for a 400
  // carrying code "rate_limit" — both are the one 4xx that IS transient.
  const rateLimited = type === "StripeRateLimitError" || code === "rate_limit" || status === 429;
  // Any other 4xx from Stripe = our request was wrong (bad params, dead ids,
  // wrong-mode keys) and will be wrong again next click.
  const deterministic =
    !rateLimited && (CONFIG_ERROR_TYPES.has(type) || (status >= 400 && status < 500));
  return {
    kind: deterministic ? "config" : "transient",
    code: code || type || "unknown",
    message: message.slice(0, 300),
  };
}

// Money-path failure reports share the generation_reports table with app
// crashes (generation_id null, reason technical_error, source auto). The
// marker at the very front of `details` is how every consumer — the admin
// Reports page, the user dossier, the Billing count — tells them apart, and
// this is the ONE definition of it.
export type ReportSurface = "checkout" | "portal";

export const REPORT_MARKERS: Record<ReportSurface, string> = {
  checkout: "[checkout]",
  portal: "[portal]",
};

export function reportSurface(details: string | null | undefined): ReportSurface | null {
  if (!details) return null;
  if (details.startsWith(REPORT_MARKERS.checkout)) return "checkout";
  if (details.startsWith(REPORT_MARKERS.portal)) return "portal";
  return null;
}

export const REPORT_SURFACE_LABELS: Record<ReportSurface, string> = {
  checkout: "Checkout failed",
  portal: "Billing portal failed",
};
