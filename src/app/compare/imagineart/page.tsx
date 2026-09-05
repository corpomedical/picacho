import type { Metadata } from "next";
import { ComparePage } from "../compare-shell";
import { localeAlternates, marketingSocial } from "@/lib/i18n/metadata";

// English-only metadata, same convention as the sibling competitor pages.
// Dated in the description on purpose: the page's competitor claims are
// verified as of August 2026 and say so.
// generateMetadata rather than a static object (2026-08-30): the canonical
// depends on which locale URL is being served, and the hreflang set must be
// emitted on all four. The static canonical this replaces would have pinned
// every locale to the English page — the standard way to make Google discard
// the translations as duplicates.
const TITLE = "Picacho vs ImagineArt (2026)";
const DESCRIPTION =
  "Picacho vs ImagineArt, honestly compared: a broad creative suite with reference-based consistency vs a saved character with per-output identity scoring, privacy defaults, failed-render economics, and pricing — verified from ImagineArt's public pricing page, August 2026.";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: await localeAlternates("/compare/imagineart"),
    ...marketingSocial("/compare/imagineart", TITLE, DESCRIPTION),
  };
}

// Always render fresh, never serve a CDN-cached copy — same stale-edge-copy
// rationale as every other marketing page (see app/pricing/page.tsx).
export const dynamic = "force-dynamic";

export default async function CompareImagineArtPage() {
  return <ComparePage competitor="imagineart" />;
}
