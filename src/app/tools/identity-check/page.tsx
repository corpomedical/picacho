import Link from "next/link";
import type { Metadata } from "next";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";
import { IdentityCheckTool } from "@/components/marketing/identity-check-tool";

// The free public identity checker (2026-08-30).
//
// English-only for now, and therefore deliberately NOT in LOCALIZED_PATHS —
// same rule as the guides: an English page under a Spanish URL is a thin
// duplicate, which ranks worse than not ranking. Add it there once the copy
// is translated.
export const metadata: Metadata = {
  title: "AI character consistency checker",
  description:
    "Free tool: upload a reference photo and any AI-generated image, and get a 0-100 identity match score. Works on output from any generator — Kling, Midjourney, Sora, Veo or Picacho. No account needed.",
  alternates: { canonical: "/tools/identity-check" },
};

// Same reasoning as every other marketing page: never serve a stale
// per-host edge copy after a deploy.
export const dynamic = "force-dynamic";

export default function IdentityCheckPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950">
      <MarketingHeader />

      <main className="mx-auto max-w-3xl px-6 pb-24 pt-14">
        <p className="text-xs font-semibold uppercase tracking-[0.13em] text-ochre">Free tool</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl">
          Did it actually keep the face?
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-neutral-600 dark:text-neutral-400">
          Every AI video tool promises character consistency. None of them tell you whether it
          worked. Upload the real face and any generated image — from any generator — and a vision
          model will score how convincingly they are the same person.
        </p>
        <p className="mt-2 text-sm text-neutral-500">
          No account, no credit card, nothing stored.
        </p>

        <div className="mt-9">
          <IdentityCheckTool />
        </div>

        <section className="mt-14 border-t border-neutral-200 pt-10 dark:border-neutral-800">
          <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
            How to read the number
          </h2>
          <dl className="mt-5 space-y-4 text-sm leading-relaxed">
            <div>
              <dt className="font-semibold text-emerald-600">85 and above — strong match</dt>
              <dd className="text-neutral-600 dark:text-neutral-400">
                Face, hair and distinguishing features carried over. Clothing, pose and lighting are
                expected to differ and are not counted against it.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-amber-600">70 to 84 — drifting</dt>
              <dd className="text-neutral-600 dark:text-neutral-400">
                Recognisable, but something has moved. This is the range where a series of shots
                stops looking like one person and starts looking like siblings.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-red-600">Below 70 — a different person</dt>
              <dd className="text-neutral-600 dark:text-neutral-400">
                The generator invented a face. Most tools will hand you this without comment, which
                is the entire reason this page exists.
              </dd>
            </div>
          </dl>
        </section>

        <section className="mt-12 rounded-[18px] bg-neutral-50 p-7 dark:bg-neutral-900">
          <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
            Why we built this
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            Picacho is a character studio: you save a character once, and every image and video
            keeps that same face. The part nobody else does is checking — a vision model scores
            every image against the identity photo, and the number is printed under the result. This
            page is that check, unlocked and pointed at whatever you want to test, including our
            competitors&apos; output and ours.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/signup"
              className="rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 dark:bg-white dark:text-neutral-900"
            >
              Make a character that holds up
            </Link>
            <Link
              href="/guides/ai-character-consistency"
              className="rounded-full border border-neutral-300 px-5 py-2.5 text-sm font-semibold text-neutral-700 transition-colors hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-300"
            >
              How character consistency works
            </Link>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
