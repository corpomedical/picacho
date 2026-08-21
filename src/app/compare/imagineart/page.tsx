import type { Metadata } from "next";
import { ComparePage } from "../compare-shell";

// English-only metadata, same convention as the sibling competitor pages.
// Dated in the description on purpose: the page's competitor claims are
// verified as of August 2026 and say so.
export const metadata: Metadata = {
  title: "Picacho vs ImagineArt (2026)",
  description:
    "Picacho vs ImagineArt, honestly compared: a broad creative suite with reference-based consistency vs a saved character with per-output identity scoring, privacy defaults, failed-render economics, and pricing — verified from ImagineArt's public pricing page, August 2026.",
  alternates: { canonical: "/compare/imagineart" },
};

// Always render fresh, never serve a CDN-cached copy — same stale-edge-copy
// rationale as every other marketing page (see app/pricing/page.tsx).
export const dynamic = "force-dynamic";

export default async function CompareImagineArtPage() {
  return <ComparePage competitor="imagineart" />;
}
