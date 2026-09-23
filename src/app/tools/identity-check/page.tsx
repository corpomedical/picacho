import Link from "next/link";
import type { Metadata } from "next";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";
import { IdentityCheckTool } from "@/components/marketing/identity-check-tool";
import { getServerMessages } from "@/lib/i18n/server";
import { localeAlternates, marketingSocial } from "@/lib/i18n/metadata";

// The free public identity checker (2026-08-30).
//
// Translated on 2026-09-23 and added to LOCALIZED_PATHS: every word on the
// page and in the tool comes from the catalogs, the API's error strings are
// chosen by a code rather than pasted from the server, and the scorer is
// asked to write its one sentence in the reader's language — so /es, /pt and
// /it are real pages, not English under a Spanish URL (the thin-duplicate
// trap that keeps the guides out of LOCALIZED_PATHS). It is also the one page
// a stranger can use with no account, which is what the launch posts link.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerMessages();
  const c = t.identityCheckPage;
  return {
    title: c.metaTitle,
    description: c.metaDescription,
    alternates: await localeAlternates("/tools/identity-check"),
    ...marketingSocial("/tools/identity-check", c.metaTitle, c.metaDescription),
  };
}

// Same reasoning as every other marketing page: never serve a stale
// per-host edge copy after a deploy.
export const dynamic = "force-dynamic";

export default async function IdentityCheckPage() {
  const { t } = await getServerMessages();
  const c = t.identityCheckPage;

  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950">
      <MarketingHeader />

      <main className="mx-auto max-w-3xl px-6 pb-24 pt-14">
        <p className="text-xs font-semibold uppercase tracking-[0.13em] text-ochre">{c.eyebrow}</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl">
          {c.title}
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-neutral-600 dark:text-neutral-400">
          {c.intro}
        </p>
        <p className="mt-2 text-sm text-neutral-500">{c.noAccount}</p>

        <div className="mt-9">
          <IdentityCheckTool />
        </div>

        <section className="mt-14 border-t border-neutral-200 pt-10 dark:border-neutral-800">
          <h2 className="text-lg font-semibold tracking-tight text-neutral-900">{c.howTitle}</h2>
          <dl className="mt-5 space-y-4 text-sm leading-relaxed">
            <div>
              <dt className="font-semibold text-emerald-600">{c.strongTitle}</dt>
              <dd className="text-neutral-600 dark:text-neutral-400">{c.strongBody}</dd>
            </div>
            <div>
              <dt className="font-semibold text-amber-600">{c.driftTitle}</dt>
              <dd className="text-neutral-600 dark:text-neutral-400">{c.driftBody}</dd>
            </div>
            <div>
              <dt className="font-semibold text-red-600">{c.differentTitle}</dt>
              <dd className="text-neutral-600 dark:text-neutral-400">{c.differentBody}</dd>
            </div>
          </dl>
        </section>

        <section className="mt-12 rounded-[18px] bg-neutral-50 p-7 dark:bg-neutral-900">
          <h2 className="text-lg font-semibold tracking-tight text-neutral-900">{c.whyTitle}</h2>
          <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            {c.whyBody}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/signup"
              className="rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 dark:bg-white dark:text-neutral-900"
            >
              {c.ctaSignup}
            </Link>
            <Link
              href="/guides/ai-character-consistency"
              className="rounded-full border border-neutral-300 px-5 py-2.5 text-sm font-semibold text-neutral-700 transition-colors hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-300"
            >
              {c.ctaGuide}
            </Link>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
