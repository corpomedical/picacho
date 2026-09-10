import type { Metadata } from "next";
import Link from "next/link";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";
import { getServerMessages } from "@/lib/i18n/server";
import { localeAlternates, marketingSocial } from "@/lib/i18n/metadata";
import { formatMsg } from "@/lib/i18n/format";
import { createClient } from "@/lib/supabase/server";
import { SUPPORT_EMAIL_FALLBACK } from "@/lib/domains";

// The public account-deletion page (2026-09-11). Google Play requires TWO
// deletion paths for an app with accounts: the in-app one (Settings →
// Account → Delete account, which has existed since August) AND "a web link
// resource where users can request app account deletion", declared in the
// Data safety form — reachable without the app and without being signed in.
// This is that link. Every sentence below is what deleteAccount
// (lib/profile/actions.ts) actually does; change one, change the other.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerMessages();
  const d = t.deleteAccountPage;
  return {
    title: d.metaTitle,
    description: d.metaDescription,
    alternates: await localeAlternates("/delete-account"),
    ...marketingSocial("/delete-account", d.metaTitle, d.metaDescription),
  };
}

// Same reason as the other legal pages: never serve a stale edge copy.
export const dynamic = "force-dynamic";

export default async function DeleteAccountPage() {
  const { t } = await getServerMessages();
  const d = t.deleteAccountPage;

  let supportEmail = SUPPORT_EMAIL_FALLBACK;
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("app_settings").select("value").eq("key", "support_email").maybeSingle();
    if (data?.value) supportEmail = data.value as string;
  } catch {
    // The fallback address is a real inbox; the page must render regardless.
  }

  // The steps quote the app's own labels, in the reader's language, so the
  // words on this page are the words on the screen (2026-09-11 review: the
  // Portuguese page named a section the Portuguese UI calls something else).
  const labels = {
    settings: t.settings.title,
    account: t.settings.account,
    dangerZone: t.settings.dangerZone,
    deleteAccount: t.settings.deleteMyAccount,
  };
  const steps = [d.fromAppStep1, formatMsg(d.fromAppStep2, labels), formatMsg(d.fromAppStep3, labels)];
  const deleted = d.deletedItems.split("|");
  const [before, after] = d.cantSignInBody.split("{email}");

  return (
    <div className="min-h-screen bg-neutral-50">
      <MarketingHeader />

      <section className="mx-auto max-w-2xl px-8 py-16">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{d.title}</h1>
        <p className="mt-6 text-sm text-neutral-600">{d.intro}</p>

        <div className="mt-10 space-y-10">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">{d.fromAppTitle}</h2>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-neutral-600">
              {steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <Link
              href="/app/settings?tab=account"
              className="mt-4 inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              {d.fromAppCta}
            </Link>
          </div>

          <div>
            <h2 className="text-base font-semibold text-neutral-900">{d.cantSignInTitle}</h2>
            <p className="mt-3 text-sm text-neutral-600">
              {before}
              <a
                href={`mailto:${supportEmail}?subject=${encodeURIComponent(d.mailSubject)}`}
                className="font-medium text-neutral-900 underline underline-offset-2"
              >
                {supportEmail}
              </a>
              {after}
            </p>
          </div>

          <div>
            <h2 className="text-base font-semibold text-neutral-900">{d.deletedTitle}</h2>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-neutral-600">
              {deleted.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-base font-semibold text-neutral-900">{d.subscriptionTitle}</h2>
            <p className="mt-3 text-sm text-neutral-600">{d.subscriptionBody}</p>
          </div>

          <div>
            <h2 className="text-base font-semibold text-neutral-900">{d.keptTitle}</h2>
            <p className="mt-3 text-sm text-neutral-600">{d.keptBody}</p>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
