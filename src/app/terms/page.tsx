import Link from "next/link";
import type { Metadata } from "next";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";
import { getServerMessages } from "@/lib/i18n/server";
import termsDoc from "@/lib/i18n/legal/terms";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that govern your use of Picacho.",
  alternates: { canonical: "/terms" },
};

// Always render fresh, never serve a CDN-cached copy. These marketing/legal
// pages were getting stuck: after a deploy, one hostname (picacho.ai) kept
// serving a weeks-old prerendered copy while others served the new build,
// because the pages were statically cacheable and a stale per-host edge copy
// never got evicted. force-dynamic makes every request render on the server,
// so a stale copy can't be served and the content always matches the deploy.
export const dynamic = "force-dynamic";

export default async function TermsPage() {
  const { locale, t } = await getServerMessages();
  const doc = termsDoc[locale];

  return (
    <div className="min-h-screen bg-neutral-50">
      <MarketingHeader />

      <section className="mx-auto max-w-2xl px-8 py-16">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{doc.title}</h1>
        <p className="mt-2 text-xs text-neutral-400">
          {t.legal.lastUpdatedLabel}: {doc.updated}
        </p>
        <p className="mt-4 rounded-[10px] bg-red-50 px-3.5 py-2.5 text-xs text-red-800 dark:bg-red-500/15 dark:text-red-300">
          {t.legal.seeContentPolicyNote}{" "}
          <Link href="/content-policy" className="font-semibold underline">
            {t.marketing.footer.contentPolicy}
          </Link>
        </p>

        <p className="mt-6 text-sm text-neutral-600">{doc.intro}</p>

        <div className="mt-8 space-y-8">
          {doc.sections.map((section) => (
            <div key={section.heading}>
              <h2 className="text-sm font-semibold text-neutral-900">{section.heading}</h2>
              <div className="mt-2 space-y-2.5">
                {section.paragraphs.map((p, idx) => (
                  <p key={idx} className="text-sm leading-relaxed text-neutral-600">
                    {p}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
