import type { ReactNode } from "react";
import type { Messages } from "@/lib/i18n/messages";
import type { Locale } from "@/lib/i18n/locales";
import { cn } from "@/lib/cn";
import { logout } from "@/lib/auth/actions";
import type { Allowances } from "@/lib/settings/account-data";
import type { SpendPart } from "@/lib/settings/credit-spend";
import { SETTINGS_TABS, settingsHref, type SettingsTab } from "@/lib/settings/tabs";
import { SettingsSection } from "@/components/settings/settings-section";
import { BackToOverview, SettingsRail } from "@/components/settings/hub/rail";
import {
  AllowancesCard,
  CreditsBlock,
  IdentityCard,
  NeedsList,
  PlanActionLink,
  PlanCard,
  SectionList,
  type CreditsModel,
  type NeedModel,
} from "@/components/settings/hub/overview";
import { SpendBreakdown } from "@/components/settings/hub/billing";
import { CARD, Slate, StatusDot } from "@/components/settings/hub/parts";

// The page's frame and its two new rooms, as components that take plain
// data (2026-09-19). The page builds the data from the account; the
// ui-check harness builds it from fixtures — so what gets looked at before
// shipping is the same markup the page renders.

export function SettingsShell({
  activeTab,
  t,
  saved,
  errorMessage,
  children,
}: {
  activeTab: SettingsTab;
  t: Messages;
  saved: boolean;
  errorMessage: string | null;
  children: ReactNode;
}) {
  const s = t.settings;
  const h = t.settingsHub;
  return (
    <div className="mx-auto max-w-4xl">
      {activeTab !== "overview" && <BackToOverview h={h} />}
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">{s.eyebrow}</p>
      <h1 className="mt-1 marquee text-[26px] leading-[1.05] text-atelier-ink sm:text-[28px]">{s.title}</h1>
      <p className="mt-1 text-sm text-atelier-muted">{s.subtitle}</p>

      {saved && (
        <p className="mt-4 rounded-control border border-emerald-600/25 bg-emerald-500/10 px-3.5 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          {s.savedNotice}
        </p>
      )}
      {errorMessage && (
        <p className="mt-4 rounded-control border border-red-600/25 bg-red-500/10 px-3.5 py-2 text-sm text-red-600 dark:text-red-400">
          {errorMessage}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-6 sm:flex-row">
        <SettingsRail tabs={SETTINGS_TABS} active={activeTab} h={h} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

export type PlanHeader = {
  label: string;
  tone: "good" | "warn" | "off";
  statusText: string | null;
};

export function OverviewTab({
  t,
  locale,
  identity,
  plan,
  planLine,
  credits,
  allowances,
  needs,
  latestInvoice,
  sections,
  buyHref,
}: {
  t: Messages;
  locale: Locale;
  identity: { name: string | null; username: string | null; email: string; company: string | null; memberSince: string };
  plan: PlanHeader;
  planLine: ReactNode;
  credits: CreditsModel;
  allowances: Allowances;
  needs: NeedModel[];
  latestInvoice: ReactNode;
  sections: { tab: SettingsTab; hint: string | null; warn?: boolean }[];
  buyHref: string | null;
}) {
  const s = t.settings;
  const h = t.settingsHub;
  return (
    <div className="space-y-4">
      <IdentityCard {...identity} locale={locale} h={h} />
      <PlanCard
        planLabel={plan.label}
        tone={plan.tone}
        statusText={plan.statusText}
        line={planLine}
        action={<PlanActionLink href={settingsHref("billing")}>{h.planAndBilling}</PlanActionLink>}
        credits={credits}
        locale={locale}
        h={h}
        s={s}
        buyHref={buyHref}
      />
      <AllowancesCard allowances={allowances} h={h} />
      <NeedsList needs={needs} h={h} />
      {latestInvoice}
      <SectionList h={h} sections={sections} />
      <form action={logout} className="px-1 pt-1">
        <button
          type="submit"
          className="min-h-11 text-sm font-medium text-atelier-muted underline underline-offset-2 transition-colors hover:text-atelier-ink"
        >
          {s.logOut}
        </button>
      </form>
    </div>
  );
}

export function BillingTab({
  t,
  locale,
  plan,
  planAction,
  planBody,
  credits,
  spend,
  spendSince,
  store,
  invoices,
  customer,
}: {
  t: Messages;
  locale: Locale;
  plan: PlanHeader;
  /** "Change or cancel", when there is a live subscription and this is not a store app. */
  planAction: ReactNode;
  /** Price, next payment, yearly — or where the plan is managed, or the way to get one. */
  planBody: ReactNode;
  credits: CreditsModel;
  spend: SpendPart[] | null;
  spendSince: string;
  /** The credit packs (web) or the Play store (app). */
  store: ReactNode;
  invoices: ReactNode;
  customer: ReactNode;
}) {
  const s = t.settings;
  const h = t.settingsHub;
  return (
    <div className="space-y-4">
      <section className={cn(CARD, "overflow-hidden")}>
        <header className="flex items-start justify-between gap-4 px-5 pb-4 pt-5 sm:px-6">
          <div className="flex min-w-0 flex-col gap-1">
            <Slate>{h.yourPlan}</Slate>
            <div className="flex items-baseline gap-2.5">
              <span className="font-numeral text-2xl font-medium leading-none text-atelier-ink sm:text-[26px]">{plan.label}</span>
              {plan.statusText && (
                <span className="flex items-center gap-1.5 text-xs text-atelier-muted">
                  <StatusDot tone={plan.tone} />
                  {plan.statusText}
                </span>
              )}
            </div>
          </div>
          {planAction}
        </header>
        {planBody && <div className="space-y-4 border-t border-atelier-rule/60 px-5 py-4 sm:px-6">{planBody}</div>}
      </section>

      <SettingsSection title={h.creditsTitle} description={h.creditsDesc}>
        <CreditsBlock credits={credits} locale={locale} h={h} s={s} buyHref={null} />
        {spend && (
          <div className="border-t border-atelier-rule/60 pt-5">
            <SpendBreakdown parts={spend} h={h} sinceLabel={spendSince} />
          </div>
        )}
      </SettingsSection>

      {store}
      {invoices}
      {customer}
    </div>
  );
}
