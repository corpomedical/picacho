import type { Metadata } from "next";
import { ComparePage } from "../compare-shell";

// English-only metadata, same convention as /pricing (the root layout's
// title.template appends "| Picacho"). Dated in the description on purpose:
// the page's competitor claims are verified as of August 2026 and say so.
export const metadata: Metadata = {
  title: "Picacho vs Hedra (2026)",
  description:
    "Picacho vs Hedra, honestly compared: talking-character clips vs persistent multi-scene identity, per-clip price, identity scoring, watermarks, and API access — verified from Hedra's public pricing page, August 2026.",
  alternates: { canonical: "/compare/hedra" },
};

// Always render fresh, never serve a CDN-cached copy — same stale-edge-copy
// rationale as every other marketing page (see app/pricing/page.tsx).
export const dynamic = "force-dynamic";

export default async function CompareHedraPage() {
  return <ComparePage competitor="hedra" />;
}
