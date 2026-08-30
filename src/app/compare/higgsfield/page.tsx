import type { Metadata } from "next";
import { ComparePage } from "../compare-shell";
import { localeAlternates } from "@/lib/i18n/metadata";

// Same conventions as /compare/heygen: English-only metadata, competitor
// claims verified from Higgsfield's own pricing page and dated in the
// description. Added 2026-08-28 after the GSC data showed compare pages
// reaching page one fastest of any page type on the site.
// generateMetadata rather than a static object (2026-08-30): the canonical
// depends on which locale URL is being served, and the hreflang set must be
// emitted on all four. The static canonical this replaces would have pinned
// every locale to the English page — the standard way to make Google discard
// the translations as duplicates.
export async function generateMetadata(): Promise<Metadata> {
  return {
  title: "Picacho vs Higgsfield (2026)",
  description:
    "Picacho vs Higgsfield, honestly compared: a multi-model creative suite vs a character-first pipeline, per-output identity scoring, failed-render economics, watermark policy, and pricing — verified from Higgsfield's public pricing page, August 2026.",
    alternates: await localeAlternates("/compare/higgsfield"),
  };
}

export const dynamic = "force-dynamic";

export default async function CompareHiggsfieldPage() {
  return <ComparePage competitor="higgsfield" />;
}
