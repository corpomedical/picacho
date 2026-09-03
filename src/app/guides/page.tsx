import type { Metadata } from "next";
import Link from "next/link";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";

// The guides hub — one card per published guide, newest first. Same
// English-only-body convention as the guides themselves; grows a card per
// article, nothing dynamic to maintain.
export const metadata: Metadata = {
  title: "Guides",
  description:
    "Practical, verified guides on AI character work: consistency, reference sets, identity scoring, and multi-shot video — from the team building Picacho.",
  alternates: { canonical: "/guides" },
};

export const dynamic = "force-dynamic";

const GUIDES = [
  {
    href: "/guides/ai-camera-movements",
    date: "August 2026",
    title: "AI camera movements: the director's cheat sheet",
    blurb:
      "Nine movements that actually work — crash zoom, dolly-in, orbit, bullet time and more — each shown as a real generated clip with the exact wording that produces it.",
  },
  {
    href: "/guides/seedance-2",
    date: "August 2026",
    title: "Seedance 2.0: the practical guide",
    blurb:
      "Identity references vs first frames, the photoreal rejection fence on both Seedance lanes, exact outfit matching from a clothing photo, and real per-second economics — all verified in production.",
  },
  {
    href: "/guides/getting-started",
    date: "August 2026",
    title: "The Picacho course: first login to first video",
    blurb:
      "Nine short chapters, every step photographed on the live product — create a consistent character, generate images and videos that keep their face, and fix the few things that go wrong.",
  },
  {
    href: "/guides/ai-character-consistency",
    date: "August 2026",
    title: "AI character consistency: the practical guide",
    blurb:
      "Why characters drift, the reference-set recipe, identity references vs first frames, the photoreal policy trap, and measuring the lock instead of hoping.",
  },
];

export default async function GuidesIndexPage() {
  return (
    <div className="min-h-screen bg-neutral-50">
      <MarketingHeader />

      <section className="isolate relative overflow-hidden bg-paper">
        <div className="mx-auto max-w-3xl px-8 pb-14 pt-20 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            Guides
          </p>
          <h1 className="mt-4 font-display text-4xl font-bold leading-[1.08] tracking-[-0.035em] text-slate-900 sm:text-5xl">
            Practical guides, verified claims
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-sm leading-relaxed text-slate-600 sm:text-base">
            What we learn building Picacho — tested against live models before it&apos;s written
            down, useful with or without our product.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-2xl px-8 py-16">
        <div className="space-y-5">
          {GUIDES.map((g) => (
            <Link
              key={g.href}
              href={g.href}
              className="block rounded-[18px] border border-neutral-100 bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-colors hover:border-neutral-300"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">{g.date}</p>
              <h2 className="mt-2 text-lg font-semibold text-neutral-900">{g.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-neutral-500">{g.blurb}</p>
            </Link>
          ))}
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
