import type { Metadata } from "next";
import { ComparePage } from "../compare-shell";
import { getServerMessages } from "@/lib/i18n/server";
import { localeAlternates, marketingSocial } from "@/lib/i18n/metadata";

// Same conventions as /compare/heygen: catalog metadata (t.seo), competitor
// claims verified from Higgsfield's own pricing page and dated in the
// description. Added 2026-08-28 after the GSC data showed compare pages
// reaching page one fastest of any page type on the site.
// generateMetadata rather than a static object (2026-08-30): the canonical
// depends on which locale URL is being served, and the hreflang set must be
// emitted on all four. The static canonical this replaces would have pinned
// every locale to the English page — the standard way to make Google discard
// the translations as duplicates.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerMessages();
  const { title, description } = t.seo.compare.higgsfield;
  return {
    title,
    description,
    alternates: await localeAlternates("/compare/higgsfield"),
    ...marketingSocial("/compare/higgsfield", title, description),
  };
}

export const dynamic = "force-dynamic";

export default async function CompareHiggsfieldPage() {
  return <ComparePage competitor="higgsfield" />;
}
