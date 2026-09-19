// The 27 EU member states (ISO 3166-1 alpha-2). Used to decide who sees EUR
// pricing / gets charged in EUR — see PLAN_PRICE_IDS_EUR in stripe/plans.ts.
// Deliberately EU-membership, not "uses the euro" or "is in Europe" — that's
// what determines VAT obligations, which is the actual reason this exists
// (see LAUNCH_CHECKLIST.md, "Currency" item, 2026-08-09). Non-EU European
// countries (UK, Norway, Switzerland, etc.) fall through to USD/no special
// handling for now — a different, separate VAT regime if that's ever built.
//
// Its own module (2026-09-19) so code that must not import next/headers —
// the invoice document builder, and its tests — can read it too.
export const EU_COUNTRIES: ReadonlySet<string> = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE",
]);

export function isEUCountry(code: string | null | undefined): boolean {
  return !!code && EU_COUNTRIES.has(code.toUpperCase());
}
