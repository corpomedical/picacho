import type { SVGProps } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMonthlyUsage } from "@/lib/generations/actions";
import { PLAN_LIMITS, PLAN_LABELS, type PlanId } from "@/lib/plans";
import { PRICING_TIERS } from "@/lib/pricing";
import { getBrandRules } from "@/lib/brand-rules/actions";
import { BrandRulesPanel } from "@/components/brand-rules-panel";
import { BuyCreditsPanel } from "@/components/buy-credits-panel";
import { isNativeApp } from "@/lib/native/server";
import { FeedbackForm } from "@/components/settings/feedback-form";
import { ProfileForm } from "@/components/profile-form";
import { UsernameForm } from "@/components/settings/username-form";
import { EmailForm } from "@/components/settings/email-form";
import { PasswordForm } from "@/components/settings/password-form";
import { ThemePicker } from "@/components/settings/theme-picker";
import { DeleteAccountForm } from "@/components/settings/delete-account-form";
import { SkipRefinementToggle } from "@/components/settings/skip-refinement-toggle";
import { MarketingEmailsToggle } from "@/components/settings/marketing-emails-toggle";
import { ApiKeysCard } from "@/components/settings/api-keys-card";
import { LanguageSwitcher } from "@/components/language-switcher";
import { logout } from "@/lib/auth/actions";
import { createCheckoutSession, createPortalSession } from "@/lib/stripe/actions";
import { getServerMessages } from "@/lib/i18n/server";
import { formatMsg } from "@/lib/i18n/format";
import { isEUVisitor } from "@/lib/geo";
import { cn } from "@/lib/cn";

// Atelier paper sheet — the local stand-in for ui/Card (which keeps its old
// look for screens not yet moved onto the tokens): raised warm surface, one
// hairline rule, control radius, no drop shadow. Section titles inside a
// sheet are set as small caps labels, the settings-popover idiom extended.
const SHEET = "rounded-control border border-atelier-rule bg-atelier-surface p-8";
const SHEET_TITLE = "text-[11px] font-medium uppercase tracking-widest text-atelier-muted";

// The upsell ladder for the "next tier" card below — each plan nudges toward
// the one after it. Basic slots in as the first paid step (2026-08-19): a
// plan-less account is offered the $9 entry, and a Basic account is offered
// Starter, which is the whole point of Basic's deliberately-worst per-credit
// rate (see PLAN_LIMITS in plans.ts). Ends at "studio" on purpose — Studio
// accounts aren't nudged toward Elite, and Elite has nowhere to go.
const TIER_ORDER: PlanId[] = ["none", "basic", "starter", "growth", "studio"];

function AccountIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <circle cx="8.5" cy="11.5" r="2" />
      <path d="M5.5 16.5c.5-1.5 1.8-2.3 3-2.3s2.5.8 3 2.3M14 9h5M14 12.5h5" />
    </svg>
  );
}

function AppearanceIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

function SecurityIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </svg>
  );
}

// Shield — brand and compliance rules.
function BrandIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function UsageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4.5 19a8.5 8.5 0 1 1 15 0" />
      <path d="M12 13 15 9" />
      <circle cx="12" cy="13" r="1" />
    </svg>
  );
}

function SupportIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .8-1 1.7" />
      <path d="M12 17h.01" />
    </svg>
  );
}

type TabId = "account" | "appearance" | "security" | "usage" | "brand" | "support";
const VALID_TABS: TabId[] = ["account", "appearance", "security", "usage", "brand", "support"];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; tab?: string }>;
}) {
  const { t } = await getServerMessages();
  const s = t.settings;
  const { saved, error, tab } = await searchParams;
  const activeTab: TabId = VALID_TABS.includes(tab as TabId) ? (tab as TabId) : "account";

  // ?error= is attacker-reachable: anyone can send a link like
  // /app/settings?error=Your+account+is+locked,+call+this+number — and this
  // page used to render that text verbatim inside trusted settings chrome,
  // which is exactly the surface a phishing message wants. So the param is
  // treated as a CODE, never as copy: the known values our own server actions
  // redirect back with (see createCheckoutSession/createPortalSession etc. in
  // stripe/actions.ts) map to localized messages here, and anything
  // unrecognized — including the free-text database messages profile actions
  // still pass — collapses to one generic localized line.
  const KNOWN_ERRORS: Record<string, string> = {
    "That plan isn't available.": s.errorPlanUnavailable,
    "This plan isn't set up for checkout yet.": s.errorPlanNotConfigured,
    "Couldn't start checkout — try again.": s.errorCheckoutFailed,
    "That credit pack isn't available.": s.errorPackUnavailable,
    "Credit packs aren't set up for checkout yet.": s.errorPackNotConfigured,
    "No billing account yet — start with a plan below.": s.errorNoBillingAccount,
    "Couldn't open billing — try again.": s.errorBillingFailed,
    "You already have a subscription — use Manage billing to change plans.": s.errorAlreadySubscribed,
    // deleteAccount's abort notice — the one message on this page that must
    // never collapse to the generic line: it's how the user learns the
    // account still exists (and still bills) after a failed deletion.
    "We couldn't cancel your subscription just now, so your account was NOT deleted — try again in a minute, or contact support and we'll sort it out.":
      s.errorDeletionAborted,
  };
  const errorMessage = error ? (KNOWN_ERRORS[error] ?? s.errorGeneric) : null;
  const brandRules = await getBrandRules();
  // Drives the reader-app gating below — see lib/native/platform.ts.
  const nativeApp = await isNativeApp();

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  // Brand-rule enforcement kill switch — the panel shows a notice when off.
  const { data: brandFlag } = await supabase
    .from("feature_flags")
    .select("enabled")
    .eq("key", "brand_rules_enforcement")
    .single();
  const brandRulesPaused = !brandFlag?.enabled;

  const [{ data: profile }, usedThisMonth, { data: supportEmailSetting }] = await Promise.all([
    // marketing_opt_out reads fine with the session client: the 2026-08-18
    // profiles lockdown (bottom of schema.sql) narrowed the UPDATE grant,
    // not SELECT — only the WRITE goes through the service role, in
    // setMarketingEmails.
    supabase
      .from("profiles")
      .select(
        "username, company, gender, plan, plan_status, stripe_customer_id, skip_ai_refinement, marketing_opt_out, bonus_credits, purchased_credits, role, api_access",
      )
      .eq("id", data.user.id)
      .single(),
    getMonthlyUsage(data.user.id),
    supabase.from("app_settings").select("value").eq("key", "support_email").single(),
  ]);

  const username = profile?.username ?? (data.user.email ?? "").split("@")[0];
  const plan = (profile?.plan ?? "none") as PlanId;

  // API access: Elite includes it, an admin grant covers the exceptions.
  const apiEnabled =
    profile?.plan === "elite" || profile?.api_access === true || profile?.role === "admin";
  const { data: apiKeyRows } = apiEnabled
    ? await supabase
        .from("api_keys")
        .select("id, name, prefix, created_at, last_used_at")
        .eq("user_id", data.user.id)
        .is("revoked_at", null)
        .order("created_at", { ascending: false })
    : { data: [] };
  const apiKeys = (apiKeyRows ?? []) as {
    id: string;
    name: string;
    prefix: string;
    created_at: string;
    last_used_at: string | null;
  }[];
  // Display-only mirror of the actual enforcement in checkGenerationAllowance
  // (generations/core.ts): the plan's monthly allowance only counts while
  // plan_status is NULL (comped / pre-Stripe grants) or "active" — a
  // past_due or canceled subscription has its plan credits paused, and this
  // page used to keep showing the full plan limit anyway, so someone whose
  // card failed saw "12 of 100 this month" while the composer refused them.
  // Bonus credits (admin-granted) stack on top and are never paused — same
  // rule as the enforcement.
  const planAllowanceActive =
    profile?.plan_status == null || profile.plan_status === "active";
  const limit = (planAllowanceActive ? PLAN_LIMITS[plan] : 0) + (profile?.bonus_credits ?? 0);
  const pct = limit > 0 ? Math.min(100, Math.round((usedThisMonth / limit) * 100)) : 0;
  const nextPlanId = TIER_ORDER[TIER_ORDER.indexOf(plan) + 1];
  const nextTier = nextPlanId ? PRICING_TIERS.find((t) => t.id === nextPlanId) : undefined;
  // Same-number swap (€19 not a $->€ conversion) — matches the price this
  // person would actually be charged at checkout, see stripe/actions.ts.
  const currencySymbol = (await isEUVisitor()) ? "€" : "$";
  const purchasedCredits = (profile?.purchased_credits ?? 0) as number;
  const supportEmail = supportEmailSetting?.value ?? "support@picacho.app";
  // A "live" Stripe subscription (active or behind on payment) means all
  // plan changes should go through the Customer Portal, which handles
  // proration correctly. No subscription yet (or fully canceled) means the
  // next click starts a brand-new Checkout session instead.
  const hasLiveSubscription = profile?.plan_status === "active" || profile?.plan_status === "past_due";

  const NAV: { id: TabId; label: string; icon: (props: SVGProps<SVGSVGElement>) => React.JSX.Element }[] = [
    { id: "account", label: s.account, icon: AccountIcon },
    { id: "appearance", label: s.appearance, icon: AppearanceIcon },
    { id: "security", label: s.security, icon: SecurityIcon },
    { id: "usage", label: s.usageAndPlan, icon: UsageIcon },
    { id: "brand", label: t.brandRules.tab, icon: BrandIcon },
    { id: "support", label: s.support, icon: SupportIcon },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-lg font-semibold text-atelier-ink">{s.title}</h1>
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
        <nav className="flex flex-shrink-0 gap-1 overflow-x-auto sm:w-52 sm:flex-col sm:gap-0.5 sm:overflow-visible">
          {NAV.map((item) => (
            <Link
              key={item.id}
              href={item.id === "account" ? "/app/settings" : `/app/settings?tab=${item.id}`}
              className={cn(
                "flex flex-shrink-0 items-center gap-2.5 whitespace-nowrap rounded-control px-3 py-2 text-sm transition-colors",
                activeTab === item.id
                  ? "bg-atelier-surface font-medium text-atelier-ink shadow-[inset_2px_0_0_var(--color-atelier-accent)]"
                  : "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink",
              )}
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {activeTab === "account" && (
            <div className="space-y-4">
              <div className={SHEET}>
                <h2 className={SHEET_TITLE}>{s.account}</h2>
                <div className="mt-4 space-y-5">
                  <UsernameForm initialUsername={username} />
                  <EmailForm initialEmail={data.user.email ?? ""} />
                  <div className="border-t border-atelier-rule/60 pt-5">
                    <ProfileForm initialCompany={profile?.company ?? ""} initialGender={profile?.gender ?? ""} />
                  </div>
                </div>
              </div>

              <div className={SHEET}>
                <h2 className={SHEET_TITLE}>{s.aiGeneration}</h2>
                <div className="mt-4">
                  <SkipRefinementToggle initialEnabled={profile?.skip_ai_refinement === true} />
                </div>
              </div>

              <div className={SHEET}>
                <h2 className={SHEET_TITLE}>{s.emailPreferences}</h2>
                <div className="mt-4">
                  {/* enabled = NOT opted out; a missing profile row degrades
                      to the column's default (false → emails on), matching
                      what the blast query would actually do. */}
                  <MarketingEmailsToggle initialEnabled={profile?.marketing_opt_out !== true} />
                </div>
              </div>

              {/* Only shown where it's actually usable — an API-keys card on a
                  Starter account is an advert dressed as a setting. */}
              {apiEnabled && <ApiKeysCard keys={apiKeys} enabled />}

              <div className={SHEET}>
                <form action={logout}>
                  <button
                    type="submit"
                    className="text-sm font-medium text-atelier-muted underline underline-offset-2 hover:text-atelier-ink"
                  >
                    {s.logOut}
                  </button>
                </form>
              </div>

              <div className={SHEET}>
                <h2 className="text-[11px] font-medium uppercase tracking-widest text-red-600 dark:text-red-400">{s.dangerZone}</h2>
                <div className="mt-3">
                  <DeleteAccountForm username={username} />
                </div>
              </div>
            </div>
          )}

          {activeTab === "appearance" && (
            <div className={SHEET}>
              <h2 className={SHEET_TITLE}>{s.appearance}</h2>
              <p className="mt-1 text-xs text-atelier-muted">{s.appearanceSubtitle}</p>
              <div className="mt-4">
                <ThemePicker />
              </div>
              <div className="mt-5 flex items-center justify-between border-t border-atelier-rule/60 pt-4">
                <div>
                  <p className="text-sm font-medium text-atelier-ink">{s.language}</p>
                  <p className="mt-0.5 text-xs text-atelier-muted">{s.languageSubtitle}</p>
                </div>
                <LanguageSwitcher />
              </div>
            </div>
          )}

          {activeTab === "security" && (
            <div className={SHEET}>
              <h2 className={SHEET_TITLE}>{s.security}</h2>
              <p className="mt-1 text-xs text-atelier-muted">{s.securitySubtitle}</p>
              <div className="mt-4">
                <PasswordForm />
              </div>
            </div>
          )}

          {activeTab === "usage" && (
            <div className={SHEET}>
              <h2 className={SHEET_TITLE}>{s.usageAndPlan}</h2>
              <div className="mt-3 flex items-center justify-between">
                <p className="text-sm text-atelier-muted">
                  {plan === "none" ? s.noActivePlan : formatMsg(s.planSuffix, { plan: PLAN_LABELS[plan] })}
                </p>
                <p className="font-numeral text-sm tabular-nums text-atelier-ink">{limit > 0 ? formatMsg(s.percentUsed, { pct }) : ""}</p>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-atelier-ink/10">
                <div
                  className="h-full rounded-full bg-atelier-accent transition-[width]"
                  style={{ width: `${limit > 0 ? Math.max(pct, usedThisMonth > 0 ? 3 : 0) : 0}%` }}
                />
              </div>
              <p className="mt-2 font-numeral text-xs tabular-nums text-atelier-muted">
                {usedThisMonth === 1 ? s.generationCountOne : formatMsg(s.generationCountOther, { n: usedThisMonth })}
                {limit > 0 && ` ${formatMsg(s.ofLimitThisMonth, { limit })}`}
              </p>

              {/* Everything below is omitted inside the iOS/Android app.

                  Apple's reader rules let an app sign existing subscribers in
                  and let them use what they've paid for, but it must sell
                  nothing and must not point anywhere that does — no upgrade
                  button, no checkout, no "manage your plan on our website",
                  not even a link to a page that eventually reaches pricing.
                  Breaking that means either a rejection or handing 15-30% of
                  every subscription to the store. Stripe's billing portal
                  counts: it can change plans and take payment.

                  Rendered on the server rather than hidden with CSS, so the
                  purchase UI never exists in the app's DOM at all. */}
              {nativeApp ? (
                <div className="mt-4 rounded-control border border-atelier-rule bg-atelier-paper p-4">
                  <p className="text-sm font-semibold text-atelier-ink">
                    {profile?.plan_status === "past_due"
                      ? s.paymentFailed
                      : plan === "none"
                        ? PLAN_LABELS.none
                        : formatMsg(s.planSuffix, { plan: PLAN_LABELS[plan] })}
                  </p>
                </div>
              ) : hasLiveSubscription ? (
                <div className="mt-4 flex items-center justify-between gap-4 rounded-control bg-atelier-ink p-4 text-atelier-paper">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {profile?.plan_status === "past_due" ? s.paymentFailed : formatMsg(s.planSuffix, { plan: PLAN_LABELS[plan] })}
                    </p>
                    <p className="mt-0.5 text-xs text-atelier-paper/70">
                      {profile?.plan_status === "past_due" ? s.paymentFailedDesc : s.managePlanDesc}
                    </p>
                  </div>
                  <form action={createPortalSession}>
                    <button
                      type="submit"
                      className="flex-shrink-0 rounded-control bg-atelier-paper px-4 py-2 text-sm font-medium text-atelier-ink transition-opacity hover:opacity-90"
                    >
                      {s.manageBilling}
                    </button>
                  </form>
                </div>
              ) : (
                nextTier && (
                  <div className="mt-4 flex items-center justify-between gap-4 rounded-control bg-atelier-ink p-4 text-atelier-paper">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {plan === "none"
                          ? formatMsg(s.getStartedWith, { tier: t.pricingTiers[nextTier.id].name })
                          : formatMsg(s.upgradeTo, { tier: t.pricingTiers[nextTier.id].name })}
                      </p>
                      <p className="mt-0.5 font-numeral text-xs tabular-nums text-atelier-paper/70">
                        {formatMsg(s.priceLine, {
                          price: `${currencySymbol}${nextTier.price}`,
                          credits: nextTier.credits,
                        })}
                      </p>
                    </div>
                    <form action={createCheckoutSession}>
                      <input type="hidden" name="plan" value={nextTier.id} />
                      <button
                        type="submit"
                        className="flex-shrink-0 rounded-control bg-atelier-paper px-4 py-2 text-sm font-medium text-atelier-ink transition-opacity hover:opacity-90"
                      >
                        {plan === "none" ? s.getStarted : s.upgrade}
                      </button>
                    </form>
                  </div>
                )
              )}
            </div>
          )}

          {/* Buying credits is a purchase, so it can't exist in the app at
              all — same reader-app reasoning as the plan card above. */}
          {activeTab === "usage" && !nativeApp && (
            <BuyCreditsPanel purchasedCredits={purchasedCredits} currencySymbol={currencySymbol} />
          )}

          {activeTab === "brand" && <BrandRulesPanel rules={brandRules} enforcementPaused={brandRulesPaused} />}

          {activeTab === "support" && (
            <div className={SHEET}>
              <h2 className={SHEET_TITLE}>{s.support}</h2>
              {/* Feedback is a form, not a mailto — it lands in the
                  /admin/feedback queue instead of an inbox, and doesn't
                  depend on the person having a mail client set up. Help
                  stays an email: that's a conversation needing a reply,
                  which a write-only form can't give them. */}
              <div className="mt-4">
                <FeedbackForm />
              </div>
              <div className="mt-4 border-t border-atelier-rule/60 pt-4 text-sm">
                <a
                  href={`mailto:${supportEmail}?subject=${encodeURIComponent("Picacho help")}`}
                  className="text-atelier-muted underline underline-offset-2 hover:text-atelier-ink"
                >
                  {s.getHelp}
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
