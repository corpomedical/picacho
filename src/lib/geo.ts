import { headers } from "next/headers";

// The 27 EU member states (ISO 3166-1 alpha-2). Used to decide who sees EUR
// pricing / gets charged in EUR — see PLAN_PRICE_IDS_EUR in stripe/plans.ts.
// Deliberately EU-membership, not "uses the euro" or "is in Europe" — that's
// what determines VAT obligations, which is the actual reason this exists
// (see LAUNCH_CHECKLIST.md, "Currency" item, 2026-08-09). Non-EU European
// countries (UK, Norway, Switzerland, etc.) fall through to USD/no special
// handling for now — a different, separate VAT regime if that's ever built.
const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE",
]);

// Reads Vercel's edge-injected geolocation header (same one page-view
// tracking already uses — see api/track/route.ts). Absent in local dev, so
// this quietly returns false there rather than throwing; production is the
// only place it actually needs to work.
export async function isEUVisitor(): Promise<boolean> {
  // Only trust the header when actually running ON Vercel, where the edge
  // strips any inbound copy and injects its own. Anywhere else (local dev,
  // a self-hosted deploy, a preview behind a tunnel) the header is just
  // client-supplied input — a request could send x-vercel-ip-country: DE
  // and pick its own pricing currency. Off Vercel, fall back to the
  // default (USD) rather than guessing.
  if (!process.env.VERCEL) return false;
  const country = (await headers()).get("x-vercel-ip-country");
  if (!country) return false;
  return EU_COUNTRIES.has(country.toUpperCase());
}
