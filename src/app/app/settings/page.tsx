import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getMonthlyUsage } from "@/lib/generations/actions";
import { monthlyWindowStart, nextMonthlyReset } from "@/lib/generations/core";
import { PLAN_LIMITS, PLAN_LABELS, freeSlotOpen, onDailyFreeTier, type PlanId } from "@/lib/plans";
import { PRICING_TIERS } from "@/lib/pricing";
import { getBrandRules } from "@/lib/brand-rules/actions";
import { SettingsSection } from "@/components/settings/settings-section";
import { BrandRulesPanel } from "@/components/brand-rules-panel";
import { BuyCreditsPanel } from "@/components/buy-credits-panel";
import { NativeStore } from "@/components/native-store";
import { isNativeApp } from "@/lib/native/server";
import { allowExternalPurchaseLink, EXTERNAL_PURCHASE_URL } from "@/lib/native/external-purchase";
import { ExternalCheckoutButton } from "@/components/external-checkout-button";
import { ProfileForm } from "@/components/profile-form";
import { InviteCard } from "@/components/invite-card";
import { UsernameForm } from "@/components/settings/username-form";
import { EmailForm } from "@/components/settings/email-form";
import { PasswordForm } from "@/components/settings/password-form";
import { MfaCard } from "@/components/settings/mfa-card";
import { ConnectedAccountsCard } from "@/components/settings/connected-accounts-card";
import { SessionsCard } from "@/components/settings/sessions-card";
import { ThemePicker } from "@/components/settings/theme-picker";
import { DeleteAccountForm } from "@/components/settings/delete-account-form";
import { SkipRefinementToggle } from "@/components/settings/skip-refinement-toggle";
import { MarketingEmailsToggle } from "@/components/settings/marketing-emails-toggle";
import { NotificationsPanel } from "@/components/settings/notifications-panel";
import { GenerationDefaultsForm } from "@/components/settings/generation-defaults-form";
import { buildVideoModelOptions, readExperimentalModelsFlag } from "@/lib/generations/workspace-data";
import { readGenerationDefaults } from "@/lib/generations/generation-defaults-server";
import {
  BlockedAccountsList,
  CookieChoiceControl,
  SharedPostsList,
  type BlockedRow,
  type SharedPostRow,
} from "@/components/settings/privacy-panel";
import { toMediaUrl, thumbUrl, isRenderableUrl } from "@/lib/media/url";
import { ApiKeysCard } from "@/components/settings/api-keys-card";
import { LanguageSwitcher } from "@/components/language-switcher";
import { createCheckoutSession } from "@/lib/stripe/actions";
import { getServerMessages } from "@/lib/i18n/server";
import { formatMsg } from "@/lib/i18n/format";
import { LOCALES } from "@/lib/i18n/locales";
import { isEUVisitor } from "@/lib/geo";
import { SUPPORT_EMAIL_FALLBACK } from "@/lib/domains";
import { isSetsEnabled } from "@/lib/sets/enabled";
import { setsEligible } from "@/lib/sets/set-config";
import { resolveSettingsTab, settingsHref, type SettingsTab } from "@/lib/settings/tabs";
import { loadAllowances, loadCreditSpend } from "@/lib/settings/account-data";
import type { CreditsModel, NeedModel } from "@/components/settings/hub/overview";
import type { ReceiptRow } from "@/components/settings/hub/billing";
import { BillingTab, OverviewTab, SettingsShell } from "@/components/settings/hub/tabs-view";
import {
  CustomerCards,
  InvoicesCard,
  LatestInvoiceCard,
  PlanFacts,
  PlanLineSkeleton,
  PlanStripeLine,
  StripeCardSkeleton,
} from "@/components/settings/hub/stripe-parts";
import { PortalButton } from "@/components/settings/hub/portal-button";
import { BUTTON_PRIMARY } from "@/components/settings/hub/parts";
import { HelpPanel } from "@/components/settings/hub/help-panel";

// Settings, direction A "Front desk" (operator's pick on the Settings &
// Invoices canvas, 2026-09-19): it opens on an Overview — who is signed in,
// the plan, what is left of every allowance, anything that needs them, the
// latest invoice — and the forms live in eight rooms:
//
//   Overview · Plan & billing · Profile · Generation · Preferences ·
//   Security · Privacy & data · Help
//
// Plan & billing (was Usage & plan) gained the invoices, the card, the
// billing details and where the month's credits went. Brand rules moved into
// Generation (they shape every take), Appearance and Notifications into
// Preferences, the danger zone into Privacy & data, Support became Help.
// Every old tab name still works — see lib/settings/tabs.ts.

// The upsell ladder for the "next tier" card below — each plan nudges toward
// the one after it. Basic slots in as the first paid step (2026-08-19): a
// plan-less account is offered the $9 entry, and a Basic account is offered
// Starter, which is the whole point of Basic's deliberately-worst per-credit
// rate (see PLAN_LIMITS in plans.ts). Ends at "studio" on purpose — Studio
// accounts aren't nudged toward Elite, and Elite has nowhere to go.
const TIER_ORDER: PlanId[] = ["none", "basic", "starter", "growth", "studio"];

// Credit packs got a Stripe invoice from this day (commit ade8cf7). Older
// packs came with a receipt only, and are listed as such.
const PACK_INVOICES_SINCE = Date.parse("2026-08-23T00:00:00Z");

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; tab?: string; credits?: string }>;
}) {
  const { t, locale } = await getServerMessages();
  const s = t.settings;
  const h = t.settingsHub;
  const params = await searchParams;
  const resolution = resolveSettingsTab(params.tab, params);
  if (resolution.redirect) redirect(resolution.redirect);
  const activeTab: SettingsTab = resolution.tab;
  const { saved, error } = params;

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
    // Server-side refusal from deleteAccount when the typed confirmation
    // does not match. A code, not a sentence, so it cannot be phished.
    delete_confirm: s.errorDeleteConfirm,
    "That plan isn't available.": s.errorPlanUnavailable,
    "This plan isn't set up for checkout yet.": s.errorPlanNotConfigured,
    "Couldn't start checkout — try again.": s.errorCheckoutFailed,
    "Checkout is unavailable right now — we've been alerted. Email support if you need credits today.":
      s.errorCheckoutUnavailable,
    "That credit pack isn't available.": s.errorPackUnavailable,
    "Credit packs aren't set up for checkout yet.": s.errorPackNotConfigured,
    "No billing account yet — start with a plan below.": s.errorNoBillingAccount,
    "Couldn't open billing — try again.": s.errorBillingFailed,
    "Billing is unavailable right now — we've been alerted. Email support and we'll sort it out.":
      s.errorBillingUnavailable,
    "You already have a subscription — use Manage billing to change plans.": s.errorAlreadySubscribed,
    // deleteAccount's abort notice — the one message on this page that must
    // never collapse to the generic line: it's how the user learns the
    // account still exists (and still bills) after a failed deletion.
    "We couldn't cancel your subscription just now, so your account was NOT deleted — try again in a minute, or contact support and we'll sort it out.":
      s.errorDeletionAborted,
    // The Play-billing guards (checkout-core.ts / profile deleteAccount).
    // Their entire purpose is the instruction in the text — collapsing them
    // to "Something went wrong" told a Play subscriber nothing about WHERE
    // their subscription actually lives.
    "Your subscription is billed through Google Play — manage or change it in the Play Store on your phone.":
      s.errorPlayBilledCheckout,
    "Your subscription is billed through Google Play, and we can't cancel it from here. Cancel it in the Play Store first (Play Store → Payments & subscriptions), then delete your account.":
      s.errorPlayBilledDeletion,
  };
  const errorMessage = error ? (KNOWN_ERRORS[error] ?? s.errorGeneric) : null;

  // Drives the reader-app gating below — see lib/native/platform.ts.
  const nativeApp = await isNativeApp();
  // US-only external checkout link (per-request geo; false everywhere else
  // and on the web) — see lib/native/external-purchase.
  const externalPurchase = await allowExternalPurchaseLink();

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const userId = data.user.id;

  const [{ data: profile }, { data: supportEmailSetting }] = await Promise.all([
    // marketing_opt_out reads fine with the session client: the 2026-08-18
    // profiles lockdown (bottom of schema.sql) narrowed the UPDATE grant,
    // not SELECT — only the WRITE goes through the service role, in
    // setMarketingEmails.
    supabase
      .from("profiles")
      .select(
        "username, full_name, company, gender, plan, plan_status, plan_source, stripe_customer_id, stripe_subscription_id, skip_ai_refinement, marketing_opt_out, bonus_credits, purchased_credits, role, api_access, current_period_start, current_period_end, created_at, free_generation_last_at, free_reference_generations_used",
      )
      .eq("id", userId)
      .single(),
    supabase.from("app_settings").select("value").eq("key", "support_email").single(),
  ]);

  // No username is NO USERNAME — never the email prefix dressed up as one.
  // The old fallback asked people to confirm deletion with a string that was
  // not their username, pre-filled the username form with a value the server
  // would reject, and minted /r/<email-prefix> referral links that resolve
  // for nobody. Where a username is genuinely absent (legacy rows), the
  // delete confirmation asks for the email address and the invite card
  // simply waits until one is chosen.
  const username = (profile?.username as string | null) ?? null;
  const plan = (profile?.plan ?? "none") as PlanId;
  const planStatus = (profile?.plan_status ?? null) as string | null;
  const planSource = (profile?.plan_source ?? null) as "stripe" | "play" | null;
  const isAdmin = profile?.role === "admin";
  const supportEmail = supportEmailSetting?.value ?? SUPPORT_EMAIL_FALLBACK;
  const customerId = (profile?.stripe_customer_id as string | null) ?? null;
  const subscriptionId = (profile?.stripe_subscription_id as string | null) ?? null;
  const periodStart = (profile?.current_period_start as string | null) ?? null;
  const bonus = (profile?.bonus_credits ?? 0) as number;
  const purchasedCredits = (profile?.purchased_credits ?? 0) as number;

  // Display-only mirror of the actual enforcement in checkGenerationAllowance
  // (generations/core.ts): the plan's monthly allowance only counts while
  // plan_status is NULL (comped / pre-Stripe grants) or "active" — a
  // past_due or canceled subscription has its plan credits paused. Bonus
  // credits (admin-granted) stack on top and are never paused — same rule as
  // the enforcement.
  const planAllowanceActive = planStatus == null || planStatus === "active";
  const limit = (planAllowanceActive ? PLAN_LIMITS[plan] : 0) + bonus;
  // A "live" Stripe subscription (active or behind on payment) means all
  // plan changes go through the Customer Portal, which handles proration.
  // Stripe-owned plans only: a Play-billed subscriber has no Stripe
  // subscription, and manages billing in the Play Store.
  const hasLiveSubscription =
    (planStatus === "active" || planStatus === "past_due") && planSource !== "play" && subscriptionId != null;

  const needsCredits = activeTab === "overview" || activeTab === "billing";
  // AFTER the profile, not alongside it: the meter must count the BILLING
  // month (current_period_start — what checkGenerationAllowance enforces),
  // not the calendar month.
  const usedThisMonth = needsCredits ? await getMonthlyUsage(userId, periodStart) : 0;
  // Enforcement compares everything spent in the window with the limit and
  // takes the overflow from extra credits (core.ts). So the plan's part of
  // the spend is capped at the limit — the old meter printed the raw sum and
  // could read "160 of 140".
  const credits: CreditsModel = onDailyFreeTier(plan, bonus)
    ? { mode: "free", slotOpen: freeSlotOpen(profile?.free_generation_last_at as string | null | undefined), extra: purchasedCredits }
    : {
        mode: "plan",
        limit,
        left: Math.max(0, limit - Math.min(usedThisMonth, limit)),
        paused: !planAllowanceActive && plan !== "none",
        resetsOn: limit > 0 ? nextMonthlyReset(periodStart).toISOString() : null,
        bonus,
        extra: purchasedCredits,
      };
  const buyHref = nativeApp ? null : `${settingsHref("billing")}#buy`;

  const planLabel = plan === "none" ? h.noPlan : PLAN_LABELS[plan];
  const planTone: "good" | "warn" | "off" =
    planStatus === "past_due" ? "warn" : planStatus === "canceled" || planStatus === "inactive" ? "off" : "good";
  const planStatusText =
    plan === "none"
      ? null
      : planStatus === "past_due"
        ? h.statusPastDue
        : planStatus === "canceled" || planStatus === "inactive"
          ? h.statusEnded
          : h.statusActive;
  const planLine =
    plan === "none" ? null : hasLiveSubscription && subscriptionId ? (
      <Suspense fallback={<PlanLineSkeleton />}>
        <PlanStripeLine subscriptionId={subscriptionId} locale={locale} h={h} />
      </Suspense>
    ) : planSource === "play" ? (
      h.planViaPlay
    ) : planStatus == null ? (
      h.planGranted
    ) : null;

  const setsOn =
    (activeTab === "overview" || activeTab === "preferences") &&
    setsEligible(profile?.plan ?? null, isAdmin) &&
    (await isSetsEnabled(supabase));

  // ── Overview ──────────────────────────────────────────────────────────
  let overview: {
    twoStepOn: boolean;
    allowances: Awaited<ReturnType<typeof loadAllowances>>;
  } | null = null;
  if (activeTab === "overview") {
    const [factors, allowances] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      loadAllowances(supabase, {
        userId,
        plan,
        planStatus,
        isAdmin,
        periodStart,
        setsOn,
        freeReferenceUsed: (profile?.free_reference_generations_used ?? 0) as number,
      }),
    ]);
    overview = { twoStepOn: (factors.data?.totp ?? []).length > 0, allowances };
  }

  // ── Plan & billing ────────────────────────────────────────────────────
  let spend: Awaited<ReturnType<typeof loadCreditSpend>> = null;
  let receipts: ReceiptRow[] = [];
  if (activeTab === "billing") {
    const [spendResult, { data: rows }] = await Promise.all([
      loadCreditSpend(supabase, userId, periodStart),
      supabase
        .from("credit_purchases")
        .select("id, credits, amount_cents, currency, created_at, refunded_at, stripe_session_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    spend = spendResult;
    receipts = (rows ?? [])
      .map((r) => {
        const play = typeof r.stripe_session_id === "string" && r.stripe_session_id.startsWith("play:");
        return {
          id: r.id as string,
          createdAt: r.created_at as string,
          credits: r.credits as number,
          amountCents: r.amount_cents as number,
          currency: ((r.currency as string | null) || "usd").toLowerCase(),
          refunded: r.refunded_at != null,
          source: play ? ("play" as const) : ("stripe" as const),
        };
      })
      // Packs bought on the website since invoices began have their own
      // invoice in the list; only the older ones need their receipt row.
      .filter((r) => r.source === "play" || Date.parse(r.createdAt) < PACK_INVOICES_SINCE);
  }

  // ── Profile: referral outcome for the invite card ─────────────────────
  // Profiles are readable only by their owner, so the count of who joined
  // through this link is taken with the service role — scoped to rows naming
  // THIS account as referrer, returning nothing but two numbers.
  let referralStats: { joined: number; rewarded: number } | null = null;
  if (activeTab === "profile" && username) {
    try {
      const { data: referred } = await createAdminClient()
        .from("profiles")
        .select("referral_rewarded_at")
        .eq("referred_by", userId)
        .limit(1000);
      referralStats = {
        joined: (referred ?? []).length,
        rewarded: (referred ?? []).filter((r) => r.referral_rewarded_at != null).length,
      };
    } catch {
      referralStats = null;
    }
  }

  // ── Generation ────────────────────────────────────────────────────────
  let generationModels: ReturnType<typeof buildVideoModelOptions> = [];
  let generationGlobalModel = "kling";
  const generationDefaults = activeTab === "generation" ? await readGenerationDefaults(supabase, userId) : null;
  let brandRules: Awaited<ReturnType<typeof getBrandRules>> = [];
  let brandRulesPaused = false;
  if (activeTab === "generation") {
    const [flagOn, { data: gm }, rules, { data: brandFlag }] = await Promise.all([
      readExperimentalModelsFlag(supabase),
      supabase.from("app_settings").select("value").eq("key", "video_model").maybeSingle(),
      getBrandRules(),
      // Brand-rule enforcement kill switch — the panel shows a notice when off.
      supabase.from("feature_flags").select("enabled").eq("key", "brand_rules_enforcement").single(),
    ]);
    generationModels = buildVideoModelOptions(flagOn);
    generationGlobalModel = (gm?.value as string | undefined) ?? "kling";
    brandRules = rules;
    brandRulesPaused = !brandFlag?.enabled;
  }

  // ── Preferences: the notification switches ───────────────────────────
  // Read on their own so that a database without the columns degrades to
  // "everything on" instead of failing the main profile select above.
  const { data: notifyRow } =
    activeTab === "preferences"
      ? await supabase
          .from("profiles")
          .select("notify_render_ready, notify_render_failed, notify_low_credits")
          .eq("id", userId)
          .maybeSingle()
      : { data: null };
  const notifyPrefs = {
    notify_render_ready: (notifyRow as { notify_render_ready?: boolean } | null)?.notify_render_ready !== false,
    notify_render_failed: (notifyRow as { notify_render_failed?: boolean } | null)?.notify_render_failed !== false,
    notify_low_credits: (notifyRow as { notify_low_credits?: boolean } | null)?.notify_low_credits !== false,
  };

  // ── Security ──────────────────────────────────────────────────────────
  // Whether an email+password identity exists — a Google-only account gets
  // the set-a-password variant of the form.
  const hasPassword = (data.user.identities ?? []).some((i) => i.provider === "email");
  // API access: Elite includes it, an admin grant covers the exceptions.
  const apiEnabled = profile?.plan === "elite" || profile?.api_access === true || isAdmin;
  const { data: apiKeyRows } =
    activeTab === "security" && apiEnabled
      ? await supabase
          .from("api_keys")
          .select("id, name, prefix, created_at, last_used_at")
          .eq("user_id", userId)
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

  // ── Privacy & data ────────────────────────────────────────────────────
  // Only when the tab is open: a list of every shared post is not worth two
  // queries on every other settings visit. Both fail open.
  let sharedPosts: SharedPostRow[] = [];
  let blocked: BlockedRow[] = [];
  if (activeTab === "privacy") {
    const [{ data: postRows }, { data: blockRows }] = await Promise.all([
      supabase
        .from("community_posts")
        .select("id, generation_id, media_url, content_type, caption, prompt, hearts_count, created_at")
        .eq("user_id", userId)
        // What anyone else can see: a post moderation hid is visible to no
        // one but its owner, and RLS would not let the owner remove it.
        .is("hidden_at", null)
        .order("created_at", { ascending: false })
        .limit(60),
      supabase
        .from("community_blocks")
        .select("blocked_id, blocked_username")
        .eq("blocker_id", userId)
        .order("created_at", { ascending: false }),
    ]);
    sharedPosts = (postRows ?? [])
      .filter((r) => isRenderableUrl(r.media_url as string))
      .map((r) => {
        const display = toMediaUrl(r.media_url as string) ?? (r.media_url as string);
        const isVideo = r.content_type === "video";
        return {
          id: r.id as string,
          generationId: r.generation_id as string,
          thumb: isVideo ? display : (thumbUrl(display, 320) ?? display),
          isVideo,
          text: ((r.caption as string | null) ?? (r.prompt as string | null)) || null,
          hearts: (r.hearts_count as number | null) ?? 0,
          createdAt: r.created_at as string,
        };
      });
    blocked = (blockRows ?? []).map((b) => ({
      blockedId: b.blocked_id as string,
      username: (b.blocked_username as string | null) ?? null,
    }));
  }

  const nextPlanId = TIER_ORDER[TIER_ORDER.indexOf(plan) + 1];
  const nextTier = nextPlanId ? PRICING_TIERS.find((tier) => tier.id === nextPlanId) : undefined;
  // Same-number swap (€19 not a $->€ conversion) — matches the price this
  // person would actually be charged at checkout, see stripe/actions.ts.
  const currencySymbol = (await isEUVisitor()) ? "€" : "$";

  // Everything below that could take a payment is omitted inside the
  // iOS/Android app. Apple's reader rules let an app sign existing
  // subscribers in and let them use what they've paid for, but it must sell
  // nothing and must not point anywhere that does — no upgrade button, no
  // checkout, no "manage your plan on our website", not even a link to a
  // page that eventually reaches pricing. Stripe's billing portal counts: it
  // can change plans and take payment. Rendered on the server rather than
  // hidden with CSS, so the purchase UI never exists in the app's DOM at all.
  const upgradeCard =
    !nativeApp && !hasLiveSubscription && !(planSource === "play" && plan !== "none") && nextTier ? (
      <div className="flex items-center justify-between gap-4 rounded-control bg-atelier-ink p-4 text-atelier-paper">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {plan === "none"
              ? formatMsg(s.getStartedWith, { tier: t.pricingTiers[nextTier.id].name })
              : formatMsg(s.upgradeTo, { tier: t.pricingTiers[nextTier.id].name })}
          </p>
          <p className="mt-0.5 font-numeral text-xs tabular-nums text-atelier-paper/70">
            {formatMsg(s.priceLine, { price: `${currencySymbol}${nextTier.price}`, credits: nextTier.credits })}
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
    ) : null;

  const needs: NeedModel[] = [];
  if (planStatus === "past_due" && planSource !== "play" && !nativeApp && customerId) needs.push({ key: "payment", portal: true });
  if (overview && !overview.twoStepOn) needs.push({ key: "twoStep", href: settingsHref("security") });
  if (!username) needs.push({ key: "username", href: settingsHref("profile") });

  const languageName = LOCALES.find((l) => l.code === locale)?.label ?? null;

  const planHeader = { label: planLabel, tone: planTone, statusText: planStatusText };

  return (
    <SettingsShell activeTab={activeTab} t={t} saved={Boolean(saved)} errorMessage={errorMessage}>
      {activeTab === "overview" && overview && (
        <OverviewTab
          t={t}
          locale={locale}
          identity={{
            name: (profile?.full_name as string | null) ?? null,
            username,
            email: data.user.email ?? "",
            company: (profile?.company as string | null) ?? null,
            memberSince: (profile?.created_at as string | null) ?? data.user.created_at,
          }}
          plan={planHeader}
          planLine={planLine}
          credits={credits}
          allowances={overview.allowances}
          needs={needs}
          latestInvoice={
            customerId ? (
              <Suspense fallback={null}>
                <LatestInvoiceCard customerId={customerId} locale={locale} h={h} />
              </Suspense>
            ) : null
          }
          sections={[
            { tab: "billing", hint: planLabel, warn: planStatus === "past_due" },
            { tab: "profile", hint: username ? `@${username}` : null },
            { tab: "generation", hint: null },
            { tab: "preferences", hint: languageName },
            { tab: "security", hint: overview.twoStepOn ? h.hintTwoStepOn : h.hintTwoStepOff, warn: !overview.twoStepOn },
            { tab: "privacy", hint: null },
            { tab: "help", hint: h.hintHelp },
          ]}
          buyHref={buyHref}
        />
      )}

      {activeTab === "billing" && (
        <BillingTab
          t={t}
          locale={locale}
          plan={planHeader}
          planAction={
            !nativeApp && hasLiveSubscription ? (
              <div className="flex flex-col items-end gap-1.5">
                <PortalButton className={BUTTON_PRIMARY}>{h.changeOrCancel}</PortalButton>
                <span className="text-[11.5px] text-atelier-muted">{h.opensStripe}</span>
              </div>
            ) : null
          }
          planBody={
            <>
              {hasLiveSubscription && subscriptionId ? (
                <Suspense fallback={<PlanLineSkeleton />}>
                  <PlanFacts subscriptionId={subscriptionId} locale={locale} h={h} nativeApp={nativeApp} />
                </Suspense>
              ) : planSource === "play" && plan !== "none" ? (
                <p className="text-sm text-atelier-ink">{formatMsg(s.playStoreManagedElsewhere, { plan: PLAN_LABELS[plan] })}</p>
              ) : plan !== "none" && planStatus == null ? (
                <p className="text-sm text-atelier-muted">{h.planGranted}</p>
              ) : null}
              {planStatus === "past_due" && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-atelier-ink">{s.paymentFailedDesc}</p>
                  {!nativeApp && customerId && planSource !== "play" && (
                    <PortalButton flow="payment_method" className={BUTTON_PRIMARY}>
                      {h.updateCard}
                    </PortalButton>
                  )}
                </div>
              )}
              {upgradeCard}
              {nativeApp && externalPurchase && (
                // US requests only (see lib/native/external-purchase): the
                // court-permitted external link to website checkout.
                <ExternalCheckoutButton url={EXTERNAL_PURCHASE_URL} label={t.common.webPurchaseCta} note={t.common.webPurchaseNote} />
              )}
            </>
          }
          credits={credits}
          spend={spend}
          spendSince={formatMsg(h.sinceDate, {
            date: monthlyWindowStart(periodStart).toLocaleDateString(locale, {
              day: "numeric",
              month: "long",
              timeZone: "UTC",
            }),
          })}
          store={
            // Buying credits is a purchase, so it can't exist in the app
            // at all. The Play store component shows nothing unless the
            // installed binary can bill (lib/native/purchases.ts).
            nativeApp ? <NativeStore userId={userId} currentPlan={plan} /> : <BuyCreditsPanel currencySymbol={currencySymbol} />
          }
          invoices={
            <Suspense fallback={<StripeCardSkeleton title={h.invoicesTitle} rows={3} />}>
              <InvoicesCard customerId={customerId} receipts={receipts} locale={locale} h={h} supportEmail={supportEmail} />
            </Suspense>
          }
          customer={
            customerId ? (
              <Suspense
                fallback={
                  <div className="grid gap-4 md:grid-cols-2">
                    <StripeCardSkeleton title={h.paymentMethodTitle} />
                    <StripeCardSkeleton title={h.billingDetailsTitle} />
                  </div>
                }
              >
                <CustomerCards customerId={customerId} t={t} locale={locale} editable={!nativeApp} />
              </Suspense>
            ) : null
          }
        />
      )}

      {activeTab === "profile" && (
        <div className="space-y-4">
          <SettingsSection title={s.account} description={s.accountDesc}>
            <div className="space-y-5">
              <UsernameForm initialUsername={username ?? ""} />
              <div className="border-t border-atelier-rule/60 pt-5">
                <ProfileForm
                  initialFullName={(profile?.full_name as string | null) ?? ""}
                  initialCompany={profile?.company ?? ""}
                  initialGender={profile?.gender ?? ""}
                />
              </div>
            </div>
          </SettingsSection>
          {/* Only with a real username: a link built from anything else
              resolves for nobody (the /r route matches profiles.username
              exactly). */}
          {username && <InviteCard username={username} stats={referralStats} />}
        </div>
      )}

      {activeTab === "generation" && generationDefaults && (
        <div className="space-y-4">
          <SettingsSection title={s.generationDefaultsTitle} description={s.generationDefaultsDesc}>
            <GenerationDefaultsForm
              models={generationModels}
              globalDefaultModelId={generationGlobalModel}
              initial={generationDefaults}
            />
          </SettingsSection>
          <SettingsSection title={s.aiGeneration} description={s.aiGenerationDesc}>
            <SkipRefinementToggle initialEnabled={profile?.skip_ai_refinement === true} />
          </SettingsSection>
          {/* Brand rules are part of how every take is made, so they live
              here now (they were a tab of their own until 2026-09-19). */}
          <div id="brand-rules" className="scroll-mt-24">
            <BrandRulesPanel rules={brandRules} enforcementPaused={brandRulesPaused} />
          </div>
        </div>
      )}

      {activeTab === "preferences" && (
        <div className="space-y-4">
          <SettingsSection title={s.appearance} description={s.appearanceDesc}>
            <div>
              <ThemePicker />
              <p className="mt-2 text-xs text-atelier-muted">{s.appearanceSubtitle}</p>
            </div>
            <div className="flex items-center justify-between border-t border-atelier-rule/60 pt-5">
              <div>
                <p className="text-sm font-medium text-atelier-ink">{s.language}</p>
                <p className="mt-0.5 text-xs text-atelier-muted">{s.languageSubtitle}</p>
              </div>
              <LanguageSwitcher />
            </div>
          </SettingsSection>
          <div id="notifications" className="scroll-mt-24 space-y-4">
            <SettingsSection title={s.notificationsTitle} description={s.notificationsDesc}>
              <NotificationsPanel
                initial={notifyPrefs}
                vapidPublicKey={process.env.VAPID_PUBLIC_KEY ?? null}
                nativeApp={nativeApp}
                // Sets are on the web only (the Android app shows webOnly): the app never names them.
                setsOn={setsOn && !nativeApp}
              />
            </SettingsSection>
            {/* Email beside push: both answer "what is Picacho allowed to
                send me". enabled = NOT opted out. */}
            <SettingsSection title={s.emailPreferences} description={s.emailPreferencesDesc}>
              <MarketingEmailsToggle initialEnabled={profile?.marketing_opt_out !== true} />
            </SettingsSection>
          </div>
        </div>
      )}

      {activeTab === "security" && (
        <div className="space-y-4">
          <SettingsSection title={s.security} description={s.securitySubtitle}>
            <div className="space-y-5">
              <PasswordForm hasPassword={hasPassword} />
              <div className="border-t border-atelier-rule/60 pt-5">
                <EmailForm initialEmail={data.user.email ?? ""} />
              </div>
              <div className="border-t border-atelier-rule/60 pt-5">
                <MfaCard />
              </div>
              <div className="border-t border-atelier-rule/60 pt-5">
                <ConnectedAccountsCard />
              </div>
              <div className="border-t border-atelier-rule/60 pt-5">
                <SessionsCard />
              </div>
            </div>
          </SettingsSection>
          {apiEnabled && <ApiKeysCard keys={apiKeys} enabled />}
        </div>
      )}

      {activeTab === "privacy" && (
        <div className="space-y-4">
          <SettingsSection title={s.sharedPostsTitle} description={s.sharedPostsDesc}>
            <SharedPostsList initial={sharedPosts} />
          </SettingsSection>
          <SettingsSection title={s.blockedTitle} description={s.blockedDesc}>
            <BlockedAccountsList initial={blocked} />
          </SettingsSection>
          <SettingsSection title={s.cookieTitle} description={s.cookieDesc}>
            <CookieChoiceControl />
          </SettingsSection>
          {/* tone="danger" rather than a hardcoded red pair: atelier-accent
              already has both themes. */}
          <SettingsSection tone="danger" title={s.dangerZone} description={s.dangerDesc}>
            <DeleteAccountForm confirmWith={username ?? (data.user.email ?? "").toLowerCase()} />
          </SettingsSection>
        </div>
      )}

      {activeTab === "help" && (
        <HelpPanel t={t} locale={locale} supportEmail={supportEmail} showApiDocs={apiEnabled} />
      )}
    </SettingsShell>
  );
}
