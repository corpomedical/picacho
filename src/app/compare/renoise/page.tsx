import type { Metadata } from "next";
import { ComparePage } from "../compare-shell";

// English-only metadata, same convention as the sibling competitor pages.
// Dated in the description on purpose: the page's competitor claims are
// verified as of August 2026 and say so.
export const metadata: Metadata = {
  title: "Picacho vs Renoise (2026)",
  description:
    "Picacho vs Renoise, honestly compared: a multi-model canvas with a manual character-lock workflow vs a saved character with per-output identity scoring, watermark policy, failed-render economics, and pricing — verified from Renoise's public pricing page, August 2026.",
  alternates: { canonical: "/compare/renoise" },
};

// Always render fresh, never serve a CDN-cached copy — same stale-edge-copy
// rationale as every other marketing page (see app/pricing/page.tsx).
export const dynamic = "force-dynamic";

export default async function CompareRenoisePage() {
  return <ComparePage competitor="renoise" />;
}
