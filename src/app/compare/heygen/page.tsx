import type { Metadata } from "next";
import { ComparePage } from "../compare-shell";
import { localeAlternates } from "@/lib/i18n/metadata";

// English-only metadata, same convention as /pricing (the root layout's
// title.template appends "| Picacho"). Dated in the description on purpose:
// the page's competitor claims are verified as of August 2026 and say so.
// generateMetadata rather than a static object (2026-08-30): the canonical
// depends on which locale URL is being served, and the hreflang set must be
// emitted on all four. The static canonical this replaces would have pinned
// every locale to the English page — the standard way to make Google discard
// the translations as duplicates.
export async function generateMetadata(): Promise<Metadata> {
  return {
  title: "Picacho vs HeyGen (2026)",
  description:
    "Picacho vs HeyGen, honestly compared: avatar presenters vs scene-based character video, per-output identity scoring, watermark policy, failed-render economics, and pricing — verified from HeyGen's public pricing page, August 2026.",
    alternates: await localeAlternates("/compare/heygen"),
  };
}

// Always render fresh, never serve a CDN-cached copy — same stale-edge-copy
// rationale as every other marketing page (see app/pricing/page.tsx).
export const dynamic = "force-dynamic";

export default async function CompareHeygenPage() {
  return <ComparePage competitor="heygen" />;
}
