import Link from "next/link";
import type { Metadata } from "next";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";
import { getServerMessages } from "@/lib/i18n/server";
import privacyDoc from "@/lib/i18n/legal/privacy";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Picacho collects, uses, and protects your data.",
  alternates: { canonical: "/privacy" },
};

export default async function PrivacyPage() {
  const { locale, t } = await getServerMessages();
  const doc = privacyDoc[locale];

  return (
    <div className="min-h-screen bg-neutral-50">
      <MarketingHeader />

      <section className="mx-auto max-w-2xl px-8 py-16">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{doc.title}</h1>
        <p className="mt-2 text-xs text-neutral-400">
          {t.legal.lastUpdatedLabel}: {doc.updated}
        </p>
        <p className="mt-4 rounded-[10px] bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
          {t.legal.notLegalAdviceNote}
        </p>
        <p className="mt-2 text-xs text-neutral-500">
          {t.legal.seeContentPolicyNote}{" "}
          <Link href="/content-policy" className="font-medium text-neutral-900 underline">
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
