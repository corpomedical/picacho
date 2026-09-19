import type { ReactNode } from "react";
import Link from "next/link";
import type { Messages } from "@/lib/i18n/messages";
import { formatMsg } from "@/lib/i18n/format";
import { cn } from "@/lib/cn";
import type { Allowances } from "@/lib/settings/account-data";
import { settingsHref, type SettingsTab } from "@/lib/settings/tabs";
import { TAB_ICONS, tabLabel } from "@/components/settings/hub/rail";
import { PortalButton } from "@/components/settings/hub/portal-button";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, CARD_FRAME, Chevron, Meter, Slate, StatusDot } from "@/components/settings/hub/parts";

// The Overview (direction A "Front desk", 2026-09-19): what someone opens
// Settings to find out — who is signed in, what plan, what is left, what
// needs them — before any form. Every figure is the same one the app
// enforces; the page only shows it.

export type CreditsModel =
  | {
      mode: "plan";
      /** Plan credits left this billing month (bonus credits included, as enforcement counts them). */
      left: number;
      limit: number;
      /** The plan's own credits are paused by a failed payment. */
      paused: boolean;
      /** When the allowance refills, ISO — the monthly window, not the yearly renewal. */
      resetsOn: string | null;
      /** Admin-granted credits inside `limit`, said out loud so the number adds up. */
      bonus: number;
      extra: number;
    }
  | { mode: "free"; slotOpen: boolean; extra: number };

export type NeedModel =
  | { key: "payment"; portal: true }
  | { key: "twoStep" | "username"; href: string };

export function IdentityCard({
  name,
  username,
  email,
  company,
  memberSince,
  locale,
  h,
}: {
  name: string | null;
  username: string | null;
  email: string;
  company: string | null;
  memberSince: string;
  locale: string;
  h: Messages["settingsHub"];
}) {
  const display = name?.trim() || username || email;
  const initial = display.trim().charAt(0).toUpperCase() || "·";
  // The email is already the headline when there is no name or username.
  const facts = [username ? `@${username}` : null, display === email ? null : email, company?.trim() || null]
    .filter(Boolean)
    .join(" · ");
  return (
    <section className={cn(CARD, "flex items-center gap-4 px-5 py-4 sm:px-6 sm:py-5")}>
      <div
        aria-hidden
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-atelier-ink/[0.08] font-numeral text-xl text-atelier-ink sm:h-12 sm:w-12"
      >
        {initial}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-numeral text-[17px] font-semibold leading-tight text-atelier-ink sm:text-lg">{display}</p>
        <p className="mt-0.5 truncate text-[12.5px] text-atelier-muted sm:text-[13px]">{facts}</p>
        <p className="mt-0.5 hidden text-xs text-atelier-muted sm:block">
          {formatMsg(h.memberSince, {
            date: new Date(memberSince).toLocaleDateString(locale, { month: "long", year: "numeric", timeZone: "UTC" }),
          })}
        </p>
      </div>
      {/* Desktop only: on a phone the Profile row sits in the list below. */}
      <Link
        href={settingsHref("profile")}
        className="hidden min-h-8 flex-shrink-0 items-center justify-center rounded-control border border-atelier-rule px-3 py-1.5 text-[13px] text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink sm:inline-flex"
      >
        {h.editProfile}
      </Link>
    </section>
  );
}

export function CreditsBlock({
  credits,
  locale,
  h,
  s,
  buyHref,
}: {
  credits: CreditsModel;
  locale: string;
  h: Messages["settingsHub"];
  s: Messages["settings"];
  /** Null inside the store apps: nothing there may lead to a purchase. */
  buyHref: string | null;
}) {
  const resets =
    credits.mode === "plan" && credits.resetsOn
      ? new Date(credits.resetsOn).toLocaleDateString(locale, { day: "numeric", month: "long", timeZone: "UTC" })
      : null;
  return (
    <div className="grid grid-cols-2 gap-5 sm:gap-7">
      {credits.mode === "plan" ? (
        <div className="flex min-w-0 flex-col gap-2">
          <Slate>{h.planCredits}</Slate>
          <div className="flex items-baseline gap-2">
            <span className="font-numeral text-[38px] leading-[0.9] tabular-nums text-atelier-accent sm:text-[44px]">
              {credits.left}
            </span>
            {/* A paused plan has nothing to count against: no "0 of 0". */}
            {!(credits.paused && credits.limit === 0) && (
              <span className="text-[12.5px] text-atelier-muted sm:text-[13px]">
                {formatMsg(h.ofLimitLeft, { limit: credits.limit })}
              </span>
            )}
          </div>
          <Meter left={credits.left} cap={credits.limit} />
          <span className="text-xs text-atelier-muted">
            {credits.paused
              ? h.planCreditsPaused
              : resets
                ? formatMsg(h.backOn, { limit: credits.limit, date: resets })
                : null}
          </span>
          {credits.bonus > 0 && (
            <span className="text-xs text-atelier-muted">
              {credits.bonus === 1 ? s.bonusIncludedOne : formatMsg(s.bonusIncluded, { n: credits.bonus })}
            </span>
          )}
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-2">
          <Slate>{h.freeDaily}</Slate>
          <span className="font-numeral text-[38px] leading-[0.9] tabular-nums text-atelier-accent sm:text-[44px]">
            {credits.slotOpen ? 1 : 0}
          </span>
          <div className="h-1.5" />
          <span className="text-xs text-atelier-muted">{credits.slotOpen ? h.freeDailyOpen : h.freeDailyUsed}</span>
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-2">
        <Slate>{h.extraCredits}</Slate>
        <div className="flex items-baseline gap-2">
          <span className="font-numeral text-[38px] leading-[0.9] tabular-nums text-atelier-ink sm:text-[44px]">
            {credits.extra}
          </span>
          <span className="text-[12.5px] text-atelier-muted sm:text-[13px]">{h.neverExpire}</span>
        </div>
        <div className="h-1.5" />
        <span className="text-xs text-atelier-muted">
          {credits.mode === "free" ? h.usedAfterFree : h.usedAfterPlan}
          {buyHref && (
            <>
              {" · "}
              <Link href={buyHref} className="text-atelier-ink underline underline-offset-2 hover:text-atelier-accent">
                {h.buyMore}
              </Link>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

export function PlanCard({
  planLabel,
  tone,
  statusText,
  line,
  action,
  credits,
  locale,
  h,
  s,
  buyHref,
}: {
  planLabel: string;
  tone: "good" | "warn" | "off";
  statusText: string | null;
  /** The price and renewal line — streamed from Stripe where that is where it lives. */
  line: ReactNode;
  action: ReactNode;
  credits: CreditsModel;
  locale: string;
  h: Messages["settingsHub"];
  s: Messages["settings"];
  buyHref: string | null;
}) {
  return (
    <section className={cn(CARD, "overflow-hidden")}>
      <header className="flex items-start justify-between gap-4 px-5 pb-4 pt-5 sm:px-6">
        <div className="flex min-w-0 flex-col gap-1">
          <Slate>{h.yourPlan}</Slate>
          <div className="flex items-baseline gap-2.5">
            <span className="font-numeral text-2xl font-medium leading-none text-atelier-ink sm:text-[26px]">{planLabel}</span>
            {statusText && (
              <span className="flex items-center gap-1.5 text-xs text-atelier-muted">
                <StatusDot tone={tone} />
                {statusText}
              </span>
            )}
          </div>
          <div className="text-[13px] text-atelier-muted">{line}</div>
        </div>
        {action}
      </header>
      <div className="border-t border-atelier-rule/60 px-5 py-5 sm:px-6">
        <CreditsBlock credits={credits} locale={locale} h={h} s={s} buyHref={buyHref} />
      </div>
    </section>
  );
}

export function AllowancesCard({ allowances, h }: { allowances: Allowances; h: Messages["settingsHub"] }) {
  if (allowances.items.length === 0) return null;
  const label: Record<Allowances["items"][number]["key"], string> = {
    helios: h.allowHelios,
    photos: h.allowPhotos,
    assists: h.allowAssists,
    assistant: h.allowAssistant,
  };
  return (
    <section className={cn(CARD, "overflow-hidden")}>
      <header className="flex flex-col gap-0.5 px-5 pb-3.5 pt-5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3 sm:px-6">
        <h2 className="font-numeral text-[15px] font-semibold leading-tight text-atelier-ink">
          {allowances.lifetime ? h.freeToTry : h.alsoThisMonth}
        </h2>
        <span className="text-xs text-atelier-muted">{allowances.lifetime ? h.lifetimeNote : h.separateFromCredits}</span>
      </header>
      <div className="grid grid-cols-2 gap-x-5 gap-y-4 border-t border-atelier-rule/60 px-5 py-4 sm:grid-cols-4 sm:px-6 sm:py-5">
        {allowances.items.map((a) => {
          const value =
            a.left === null || a.cap === null
              ? h.unlimited
              : a.asPercent
                ? formatMsg(h.pctLeft, { pct: Math.round((a.left / a.cap) * 100) })
                : formatMsg(h.leftOf, { left: a.left, cap: a.cap });
          return (
            <div key={a.key} className="flex min-w-0 flex-col gap-1.5">
              <span className="text-xs text-atelier-muted">{label[a.key]}</span>
              <span className="font-numeral text-[15px] tabular-nums text-atelier-ink sm:text-base">{value}</span>
              {a.left !== null && a.cap !== null && (
                <div className="h-1 w-full overflow-hidden rounded-full bg-atelier-ink/10">
                  <div
                    className="h-full rounded-full bg-atelier-ink/50"
                    style={{ width: `${a.cap > 0 ? Math.min(100, (a.left / a.cap) * 100) : 0}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function NeedsList({ needs, h }: { needs: NeedModel[]; h: Messages["settingsHub"] }) {
  if (needs.length === 0) return null;
  return (
    <div className="space-y-3">
      {needs.map((need) => {
        const copy =
          need.key === "payment"
            ? { title: h.needPaymentTitle, body: h.needPaymentBody, cta: h.needUpdateCard }
            : need.key === "twoStep"
              ? { title: h.need2faTitle, body: h.need2faBody, cta: h.need2faCta }
              : { title: h.needUsernameTitle, body: h.needUsernameBody, cta: h.needUsernameCta };
        return (
          <section
            key={need.key}
            className={cn(CARD_FRAME, "flex items-center gap-3.5 border-atelier-accent/25 px-5 py-4 sm:px-6")}
          >
            <StatusDot tone="warn" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-atelier-ink">{copy.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-atelier-muted">{copy.body}</p>
            </div>
            {need.key === "payment" ? (
              <PortalButton flow="payment_method" className={BUTTON_SECONDARY}>
                {copy.cta}
              </PortalButton>
            ) : (
              <Link href={need.href} className={BUTTON_SECONDARY} aria-label={`${copy.cta} — ${copy.title}`}>
                {copy.cta}
              </Link>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** The phone's menu of rooms: every tab, with what it holds at a glance. */
export function SectionList({
  sections,
  h,
}: {
  sections: { tab: SettingsTab; hint: string | null; warn?: boolean }[];
  h: Messages["settingsHub"];
}) {
  return (
    <nav aria-label={h.sectionsLabel} className={cn(CARD, "overflow-hidden sm:hidden")}>
      <ul>
        {sections.map((s, i) => {
          const Icon = TAB_ICONS[s.tab];
          return (
            <li key={s.tab} className={cn(i > 0 && "border-t border-atelier-rule/60")}>
              <Link href={settingsHref(s.tab)} className="flex min-h-[52px] items-center gap-3 px-4 text-sm text-atelier-ink">
                <Icon className="h-[18px] w-[18px] flex-shrink-0 text-atelier-muted" />
                <span className="flex-1">{tabLabel(s.tab, h)}</span>
                {s.hint && (
                  <span className={cn("truncate text-[12.5px]", s.warn ? "text-atelier-accent" : "text-atelier-muted")}>
                    {s.hint}
                  </span>
                )}
                <Chevron />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function PlanActionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={BUTTON_PRIMARY}>
      {children}
    </Link>
  );
}
