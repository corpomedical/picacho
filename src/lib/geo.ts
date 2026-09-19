import { headers } from "next/headers";
import { EU_COUNTRIES } from "@/lib/eu-countries";

// The EU list lives in lib/eu-countries.ts since 2026-09-19, shared with the
// invoice writer (which has to know whether a customer's address is inside
// the EU to word the VAT line) — see the note there.

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
