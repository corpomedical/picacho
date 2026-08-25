// Split out from reports.ts on purpose: that file is "use server", and
// Next.js only allows a "use server" file to export async functions —
// exporting this const array from there broke the whole module the moment a
// client component (result-actions.tsx) imported it ("A 'use server' file
// can only export async functions, found object."). Everything that needs
// the reason list — the server actions in reports.ts and the client-side
// report popover — imports it from here instead.
export const REPORT_REASONS = [
  "wrong_result",
  "inappropriate",
  "technical_error",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

// Detects the class of failure where OUR provider account is out of money —
// not "this render failed" but "every render will fail until someone tops up
// a balance". Born from the 2026-08-25 fal.ai lock: the account hit zero at
// 04:34 UTC and every video generation 403'd with "User is locked. Reason:
// Exhausted balance." — but the admin push for it was the same "Generation
// failed" as any one-off hiccup, so nobody's phone said the PRODUCT was down.
// Matched against the summarized failure detail (provider error messages),
// which is why the phrases are provider-side wordings — fal's lock text,
// OpenAI's quota text, generic 402 language. Deliberately NOT matched:
// Picacho's own "needs N credits" copy (a user being out of OUR credits is
// normal business, and that string never reaches a failure report anyway).
const PROVIDER_BALANCE_FAILURE =
  /user is locked|exhausted balance|top up your balance|insufficient (?:balance|funds|credits?)|exceeded your current quota|payment required/i;

export function isProviderBalanceFailure(detail: string): boolean {
  return PROVIDER_BALANCE_FAILURE.test(detail);
}
