import type { Metadata } from "next";
import { ComparePage } from "../compare-shell";

// Same conventions as /compare/heygen: English-only metadata, competitor
// claims verified from Higgsfield's own pricing page and dated in the
// description. Added 2026-08-28 after the GSC data showed compare pages
// reaching page one fastest of any page type on the site.
export const metadata: Metadata = {
  title: "Picacho vs Higgsfield (2026)",
  description:
    "Picacho vs Higgsfield, honestly compared: a multi-model creative suite vs a character-first pipeline, per-output identity scoring, failed-render economics, watermark policy, and pricing — verified from Higgsfield's public pricing page, August 2026.",
  alternates: { canonical: "/compare/higgsfield" },
};

export const dynamic = "force-dynamic";

export default async function CompareHiggsfieldPage() {
  return <ComparePage competitor="higgsfield" />;
}
