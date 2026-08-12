import type { Metadata } from "next";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";
import { getServerMessages } from "@/lib/i18n/server";
import contentPolicyDoc from "@/lib/i18n/legal/content-policy";
import { cn } from "@/lib/cn";

export const metadata: Metadata = {
  title: "Content Policy",
  description: "What's allowed and not allowed to be generated on Picacho.",
  alternates: { canonical: "/content-policy" },
};

// Always render fresh, never serve a CDN-cached copy. These marketing/legal
// pages were getting stuck: after a deploy, one hostname (picacho.ai) kept
// serving a weeks-old prerendered copy while others served the new build,
// because the pages were statically cacheable and a stale per-host edge copy
// never got evicted. force-dynamic makes every request render on the server,
// so a stale copy can't be served and the content always matches the deploy.
export const dynamic = "force-dynamic";

export default async function ContentPolicyPage() {
  const { locale, t } = await getServerMessages();
  const doc = contentPolicyDoc[locale];

  return (
    <div className="min-h-screen bg-neutral-50">
      <MarketingHeader />

      <section className="mx-auto max-w-2xl px-8 py-16">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{doc.title}</h1>
        <p className="mt-2 text-xs text-neutral-400">
          {t.legal.lastUpdatedLabel}: {doc.updated}
        </p>

        <p className="mt-6 text-sm text-neutral-600">{doc.intro}</p>

        <div className="mt-8 space-y-8">
          {doc.sections.map((section) => (
            <div
              key={section.heading}
              className={cn(
                section.emphasis === "critical" &&
                  "rounded-[14px] border-2 border-red-300 bg-red-50 p-5 dark:border-red-500/40 dark:bg-red-500/10",
                section.emphasis === "high" &&
                  "rounded-[14px] border border-amber-300 bg-amber-50 p-5 dark:border-amber-500/40 dark:bg-amber-500/10",
              )}
            >
              <h2
                className={cn(
                  "text-sm font-semibold",
                  section.emphasis === "critical"
                    ? "text-red-800 dark:text-red-300"
                    : section.emphasis === "high"
                      ? "text-amber-800 dark:text-amber-300"
                      : "text-neutral-900",
                )}
              >
                {section.heading}
              </h2>
              <div className="mt-2 space-y-2.5">
                {section.paragraphs.map((p, idx) => (
                  <p
                    key={idx}
                    className={cn(
                      "text-sm leading-relaxed",
                      section.emphasis === "critical"
                        ? "text-red-900/90 dark:text-red-200"
                        : section.emphasis === "high"
                          ? "text-amber-900/90 dark:text-amber-200"
                          : "text-neutral-600",
                    )}
                  >
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
