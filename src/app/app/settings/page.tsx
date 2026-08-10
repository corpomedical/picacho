import type { SVGProps } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMonthlyUsage } from "@/lib/generations/actions";
import { PLAN_LIMITS, PLAN_LABELS, type PlanId } from "@/lib/plans";
import { PRICING_TIERS } from "@/lib/pricing";
import { getBrandRules } from "@/lib/brand-rules/actions";
import { BrandRulesPanel } from "@/components/brand-rules-panel";
import { Card } from "@/components/ui/card";
import { ProfileForm } from "@/components/profile-form";
import { UsernameForm } from "@/components/settings/username-form";
import { EmailForm } from "@/components/settings/email-form";
import { PasswordForm } from "@/components/settings/password-form";
import { ThemePicker } from "@/components/settings/theme-picker";
import { DeleteAccountForm } from "@/components/settings/delete-account-form";
import { SkipRefinementToggle } from "@/components/settings/skip-refinement-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";
import { logout } from "@/lib/auth/actions";
import { createCheckoutSession, createPortalSession } from "@/lib/stripe/actions";
import { getServerMessages } from "@/lib/i18n/server";
import { formatMsg } from "@/lib/i18n/format";
import { isEUVisitor } from "@/lib/geo";
import { cn } from "@/lib/cn";

const TIER_ORDER: PlanId[] = ["none", "starter", "growth", "studio"];

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
  const brandRules = await getBrandRules();

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const [{ data: profile }, usedThisMonth, { data: supportEmailSetting }] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "username, company, gender, plan, plan_status, stripe_customer_id, skip_ai_refinement, bonus_credits",
      )
      .eq("id", data.user.id)
      .single(),
    getMonthlyUsage(data.user.id),
    supabase.from("app_settings").select("value").eq("key", "support_email").single(),
  ]);

  const username = profile?.username ?? (data.user.email ?? "").split("@")[0];
  const plan = (profile?.plan ?? "none") as PlanId;
  // Bonus credits (admin-granted) stack on top of the plan limit — same rule
  // as the actual enforcement in checkGenerationAllowance.
  const limit = PLAN_LIMITS[plan] + (profile?.bonus_credits ?? 0);
  const pct = limit > 0 ? Math.min(100, Math.round((usedThisMonth / limit) * 100)) : 0;
  const nextPlanId = TIER_ORDER[TIER_ORDER.indexOf(plan) + 1];
  const nextTier = nextPlanId ? PRICING_TIERS.find((t) => t.id === nextPlanId) : undefined;
  // Same-number swap (€19 not a $->€ conversion) — matches the price this
  // person would actually be charged at checkout, see stripe/actions.ts.
  const currencySymbol = (await isEUVisitor()) ? "€" : "$";
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
      <h1 className="text-lg font-semibold text-neutral-900">{s.title}</h1>
      <p className="mt-1 text-sm text-neutral-500">{s.subtitle}</p>

      {saved && (
        <p className="mt-4 rounded-[10px] bg-emerald-50 px-3.5 py-2 text-sm text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
          {s.savedNotice}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-[10px] bg-red-50 px-3.5 py-2 text-sm text-red-600 dark:bg-red-500/15 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-6 sm:flex-row">
        <nav className="flex flex-shrink-0 gap-1 overflow-x-auto sm:w-52 sm:flex-col sm:gap-0.5 sm:overflow-visible">
          {NAV.map((item) => (
            <Link
              key={item.id}
              href={item.id === "account" ? "/app/settings" : `/app/settings?tab=${item.id}`}
              className={cn(
                "flex flex-shrink-0 items-center gap-2.5 whitespace-nowrap rounded-[10px] px-3 py-2 text-sm transition-colors",
                activeTab === item.id
                  ? "bg-neutral-100 font-medium text-neutral-900"
                  : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900",
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
              <Card>
                <h2 className="text-sm font-semibold text-neutral-900">{s.account}</h2>
                <div className="mt-4 space-y-5">
                  <UsernameForm initialUsername={username} />
                  <EmailForm initialEmail={data.user.email ?? ""} />
                  <div className="border-t border-neutral-100 pt-5">
                    <ProfileForm initialCompany={profile?.company ?? ""} initialGender={profile?.gender ?? ""} />
                  </div>
                </div>
              </Card>

              <Card>
                <h2 className="text-sm font-semibold text-neutral-900">{s.aiGeneration}</h2>
                <div className="mt-4">
                  <SkipRefinementToggle initialEnabled={profile?.skip_ai_refinement === true} />
                </div>
              </Card>

              <Card>
                <form action={logout}>
                  <button
                    type="submit"
                    className="text-sm font-medium text-neutral-700 underline hover:text-neutral-900"
                  >
                    {s.logOut}
                  </button>
                </form>
              </Card>

              <Card>
                <h2 className="text-sm font-semibold text-red-600 dark:text-red-400">{s.dangerZone}</h2>
                <div className="mt-3">
                  <DeleteAccountForm username={username} />
                </div>
              </Card>
            </div>
          )}

          {activeTab === "appearance" && (
            <Card>
              <h2 className="text-sm font-semibold text-neutral-900">{s.appearance}</h2>
              <p className="mt-1 text-xs text-neutral-500">{s.appearanceSubtitle}</p>
              <div className="mt-4">
                <ThemePicker />
              </div>
              <div className="mt-5 flex items-center justify-between border-t border-neutral-100 pt-4">
                <div>
                  <p className="text-sm font-medium text-neutral-900">{s.language}</p>
                  <p className="mt-0.5 text-xs text-neutral-500">{s.languageSubtitle}</p>
                </div>
                <LanguageSwitcher />
              </div>
            </Card>
          )}

          {activeTab === "security" && (
            <Card>
              <h2 className="text-sm font-semibold text-neutral-900">{s.security}</h2>
              <p className="mt-1 text-xs text-neutral-500">{s.securitySubtitle}</p>
              <div className="mt-4">
                <PasswordForm />
              </div>
            </Card>
          )}

          {activeTab === "usage" && (
            <Card>
              <h2 className="text-sm font-semibold text-neutral-900">{s.usageAndPlan}</h2>
              <div className="mt-3 flex items-center justify-between">
                <p className="text-sm text-neutral-500">
                  {plan === "none" ? s.noActivePlan : formatMsg(s.planSuffix, { plan: PLAN_LABELS[plan] })}
                </p>
                <p className="text-sm text-neutral-500">{limit > 0 ? formatMsg(s.percentUsed, { pct }) : ""}</p>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-full rounded-full bg-neutral-900 transition-[width]"
                  style={{ width: `${limit > 0 ? Math.max(pct, usedThisMonth > 0 ? 3 : 0) : 0}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-neutral-500">
                {usedThisMonth === 1 ? s.generationCountOne : formatMsg(s.generationCountOther, { n: usedThisMonth })}
                {limit > 0 && ` ${formatMsg(s.ofLimitThisMonth, { limit })}`}
              </p>

              {hasLiveSubscription ? (
                <div className="mt-4 flex items-center justify-between gap-4 rounded-[14px] bg-neutral-900 p-4 text-white">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {profile?.plan_status === "past_due" ? s.paymentFailed : formatMsg(s.planSuffix, { plan: PLAN_LABELS[plan] })}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-300">
                      {profile?.plan_status === "past_due" ? s.paymentFailedDesc : s.managePlanDesc}
                    </p>
                  </div>
                  <form action={createPortalSession}>
                    <button
                      type="submit"
                      className="flex-shrink-0 rounded-[10px] bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-100"
                    >
                      {s.manageBilling}
                    </button>
                  </form>
                </div>
              ) : (
                nextTier && (
                  <div className="mt-4 flex items-center justify-between gap-4 rounded-[14px] bg-neutral-900 p-4 text-white">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {plan === "none"
                          ? formatMsg(s.getStartedWith, { tier: t.pricingTiers[nextTier.id].name })
                          : formatMsg(s.upgradeTo, { tier: t.pricingTiers[nextTier.id].name })}
                      </p>
                      <p className="mt-0.5 text-xs text-neutral-300">
                        {formatMsg(s.priceLine, {
                          price: `${currencySymbol}${nextTier.price}`,
                          generations: nextTier.generations,
                        })}
                      </p>
                    </div>
                    <form action={createCheckoutSession}>
                      <input type="hidden" name="plan" value={nextTier.id} />
                      <button
                        type="submit"
                        className="flex-shrink-0 rounded-[10px] bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-100"
                      >
                        {plan === "none" ? s.getStarted : s.upgrade}
                      </button>
                    </form>
                  </div>
                )
              )}
            </Card>
          )}

          {activeTab === "brand" && <BrandRulesPanel rules={brandRules} />}

          {activeTab === "support" && (
            <Card>
              <h2 className="text-sm font-semibold text-neutral-900">{s.support}</h2>
              <div className="mt-3 space-y-2 text-sm">
                <a
                  href={`mailto:${supportEmail}?subject=${encodeURIComponent("Picacho feedback")}`}
                  className="block text-neutral-700 underline hover:text-neutral-900"
                >
                  {s.sendFeedback}
                </a>
                <a
                  href={`mailto:${supportEmail}?subject=${encodeURIComponent("Picacho help")}`}
                  className="block text-neutral-700 underline hover:text-neutral-900"
                >
                  {s.getHelp}
                </a>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
