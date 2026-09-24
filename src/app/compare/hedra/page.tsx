import type { Metadata } from "next";
import { ComparePage } from "../compare-shell";
import { getServerMessages } from "@/lib/i18n/server";
import { localeAlternates, marketingSocial } from "@/lib/i18n/metadata";

// Title and description come from the catalogs (t.seo.compare, 2026-09-24)
// so each locale URL is searched in its own language; the root layout's
// title.template appends "| Picacho". Dated in the description on purpose:
// the page's competitor claims are verified as of August 2026 and say so.
// generateMetadata rather than a static object (2026-08-30): the canonical
// depends on which locale URL is being served, and the hreflang set must be
// emitted on all four. The static canonical this replaces would have pinned
// every locale to the English page — the standard way to make Google discard
// the translations as duplicates.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerMessages();
  const { title, description } = t.seo.compare.hedra;
  return {
    title,
    description,
    alternates: await localeAlternates("/compare/hedra"),
    ...marketingSocial("/compare/hedra", title, description),
  };
}

// Always render fresh, never serve a CDN-cached copy — same stale-edge-copy
// rationale as every other marketing page (see app/pricing/page.tsx).
export const dynamic = "force-dynamic";

export default async function CompareHedraPage() {
  return <ComparePage competitor="hedra" />;
}
