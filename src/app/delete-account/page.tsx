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
    // The danger zone lives on Privacy & data since the 2026-09-19 redesign.
    account: t.settingsHub.tabPrivacy,
    dangerZone: t.settings.dangerZone,
    deleteAccount: t.settings.deleteMyAccount,
    // In the app, Settings lives under the bar's More tab (2026-09-21).
    more: t.nav.more,
  };
  const steps = [d.fromAppStep1, formatMsg(d.fromAppStep2, labels), formatMsg(d.fromAppStep3, labels)];
  const deleted = d.deletedItems.split("|");
  const [before, after] = d.cantSignInBody.split("{email}");
  // Deleting only some of your data (2026-09-21): Google Play's Data safety
  // form links its "delete some or all of your data without deleting your
  // account" answer to #some-data. Every step quotes the app's own labels,
  // like the steps above, and each path was traced to its delete action.
  const itemLabels = {
    history: t.nav.history,
    media: t.nav.media,
    delete: t.history.deleteGeneration,
    deleteCharacter: t.character.deleteCharacter,
    saveCharacter: t.character.saveCharacter,
    settings: t.settings.title,
    privacy: t.settingsHub.tabPrivacy,
    shared: t.settings.sharedPostsTitle,
    remove: t.settings.sharedPostsRemove,
    deleteNote: t.notes.deleteNote,
    deleteProject: t.projects.deleteProject,
    security: t.settingsHub.tabSecurity,
    disconnect: t.settings.disconnect,
  };
  const someItems = d.someDataItems.split("|").map((item) => formatMsg(item, itemLabels));
  const [otherBefore, otherAfter] = d.someDataOther.split("{email}");

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
              href="/app/settings?tab=privacy"
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

          <div id="some-data" className="scroll-mt-24">
            <h2 className="text-base font-semibold text-neutral-900">{d.someDataTitle}</h2>
            <p className="mt-3 text-sm text-neutral-600">{d.someDataIntro}</p>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-neutral-600">
              {someItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-neutral-600">{d.someDataKept}</p>
            <p className="mt-3 text-sm text-neutral-600">
              {otherBefore}
              <a href={`mailto:${supportEmail}`} className="font-medium text-neutral-900 underline underline-offset-2">
                {supportEmail}
              </a>
              {otherAfter}
            </p>
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
