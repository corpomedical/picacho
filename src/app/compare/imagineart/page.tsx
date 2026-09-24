import type { Metadata } from "next";
import { ComparePage } from "../compare-shell";
import { getServerMessages } from "@/lib/i18n/server";
import { localeAlternates, marketingSocial } from "@/lib/i18n/metadata";

// Title and description from the catalogs (t.seo.compare), same as the
// sibling competitor pages.
// Dated in the description on purpose: the page's competitor claims are
// verified as of August 2026 and say so.
// generateMetadata rather than a static object (2026-08-30): the canonical
// depends on which locale URL is being served, and the hreflang set must be
// emitted on all four. The static canonical this replaces would have pinned
// every locale to the English page — the standard way to make Google discard
// the translations as duplicates.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerMessages();
  const { title, description } = t.seo.compare.imagineart;
  return {
    title,
    description,
    alternates: await localeAlternates("/compare/imagineart"),
    ...marketingSocial("/compare/imagineart", title, description),
  };
}

// Always render fresh, never serve a CDN-cached copy — same stale-edge-copy
// rationale as every other marketing page (see app/pricing/page.tsx).
export const dynamic = "force-dynamic";

export default async function CompareImagineArtPage() {
  return <ComparePage competitor="imagineart" />;
}
