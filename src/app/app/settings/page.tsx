import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMonthlyUsage } from "@/lib/generations/actions";
import { PLAN_LIMITS, PLAN_LABELS, type PlanId } from "@/lib/plans";
import { PRICING_TIERS } from "@/lib/pricing";
import { Card } from "@/components/ui/card";
import { ProfileForm } from "@/components/profile-form";
import { UsernameForm } from "@/components/settings/username-form";
import { EmailForm } from "@/components/settings/email-form";
import { PasswordForm } from "@/components/settings/password-form";
import { ThemePicker } from "@/components/settings/theme-picker";
import { DeleteAccountForm } from "@/components/settings/delete-account-form";
import { LanguageSwitcher } from "@/components/language-switcher";
import { logout } from "@/lib/auth/actions";
import { getServerMessages } from "@/lib/i18n/server";
import { formatMsg } from "@/lib/i18n/format";

const TIER_ORDER: PlanId[] = ["none", "starter", "growth", "studio"];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { t } = await getServerMessages();
  const s = t.settings;
  const { saved, error } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const [{ data: profile }, usedThisMonth, { data: supportEmailSetting }] = await Promise.all([
    supabase.from("profiles").select("username, company, gender, plan").eq("id", data.user.id).single(),
    getMonthlyUsage(data.user.id),
    supabase.from("app_settings").select("value").eq("key", "support_email").single(),
  ]);

  const username = profile?.username ?? (data.user.email ?? "").split("@")[0];
  const plan = (profile?.plan ?? "none") as PlanId;
  const limit = PLAN_LIMITS[plan];
  const pct = limit > 0 ? Math.min(100, Math.round((usedThisMonth / limit) * 100)) : 0;
  const nextPlanId = TIER_ORDER[TIER_ORDER.indexOf(plan) + 1];
  const nextTier = nextPlanId ? PRICING_TIERS.find((t) => t.id === nextPlanId) : undefined;
  const supportEmail = supportEmailSetting?.value ?? "support@picacho.app";

  return (
    <div className="mx-auto max-w-2xl">
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

      <Card className="mt-6">
        <h2 className="text-sm font-semibold text-neutral-900">{s.account}</h2>
        <div className="mt-4 space-y-5">
          <UsernameForm initialUsername={username} />
          <EmailForm initialEmail={data.user.email ?? ""} />
          <div className="border-t border-neutral-100 pt-5">
            <ProfileForm initialCompany={profile?.company ?? ""} initialGender={profile?.gender ?? ""} />
          </div>
        </div>
      </Card>

      <Card className="mt-4">
        <h2 className="text-sm font-semibold text-neutral-900">{s.appearance}</h2>
        <p className="mt-1 text-xs text-neutral-500">{s.appearanceSubtitle}</p>
        <div className="mt-4">
          <ThemePicker />
        </div>
        <div className="mt-5 flex items-center justify-between border-t border-neutral-100 pt-4">
          <div>
            <p className="text-sm font-medium text-neutral-900">{s.language}</p>
            <p className="mt-0.5 text-xs text-neutral-500">
              {s.languageSubtitle}
            </p>
          </div>
          <LanguageSwitcher />
        </div>
      </Card>

      <Card className="mt-4">
        <h2 className="text-sm font-semibold text-neutral-900">{s.security}</h2>
        <p className="mt-1 text-xs text-neutral-500">{s.securitySubtitle}</p>
        <div className="mt-4">
          <PasswordForm />
        </div>
      </Card>

      <Card className="mt-4">
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

        {nextTier && (
          <div className="mt-4 flex items-center justify-between gap-4 rounded-[14px] bg-neutral-900 p-4 text-white">
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                {plan === "none"
                  ? formatMsg(s.getStartedWith, { tier: t.pricingTiers[nextTier.id].name })
                  : formatMsg(s.upgradeTo, { tier: t.pricingTiers[nextTier.id].name })}
              </p>
              <p className="mt-0.5 text-xs text-neutral-300">
                {formatMsg(s.priceLine, { price: nextTier.price, generations: nextTier.generations })}
              </p>
            </div>
            {/* Paid plans aren't purchasable yet (billing isn't connected) —
                previously this linked to /pricing, which for an already
                logged-in user silently bounced back here with no
                explanation. Better to be upfront that it's not live yet than
                to send someone through a broken flow. */}
            <span className="flex-shrink-0 rounded-[10px] bg-white/10 px-4 py-2 text-sm font-medium text-neutral-300">
              {s.upgradeComingSoon}
            </span>
          </div>
        )}
      </Card>

      <Card className="mt-4">
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

      <Card className="mt-4">
        <form action={logout}>
          <button
            type="submit"
            className="text-sm font-medium text-neutral-700 underline hover:text-neutral-900"
          >
            {s.logOut}
          </button>
        </form>
      </Card>

      <Card className="mt-4">
        <h2 className="text-sm font-semibold text-red-600 dark:text-red-400">{s.dangerZone}</h2>
        <div className="mt-3">
          <DeleteAccountForm username={username} />
        </div>
      </Card>
    </div>
  );
}
