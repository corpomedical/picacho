import Link from "next/link";
import { formatMsg } from "@/lib/i18n/format";
import { TicketSubmit } from "@/components/marketing/ticket-submit";
import { SerifNumerals } from "@/components/marketing/serif-numerals";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/cn";
import { PRICING_TIERS } from "@/lib/pricing";
import { getServerMessages } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { createCheckoutSession, createPortalSession } from "@/lib/stripe/actions";
import { isEUVisitor } from "@/lib/geo";

type Tier = (typeof PRICING_TIERS)[number];

export async function PricingCard({
  tier,
  interval = "annual",
  variant = "card",
}: {
  tier: Tier;
  // Which billing cycle this card displays and sells. Annual is the default
  // everywhere on purpose — it's the offer we lead with.
  interval?: "annual" | "month";
  // "card" is the light card /pricing uses; "ticket" is the dark homepage's
  // Ticket Wall (operator-picked board B, 2026-09-02) — same data, same
  // checkout/portal/current-plan machinery, different clothes. The ticket
  // paints with pinned literals (#101014 stage) because the homepage is
  // always dark regardless of the site theme.
  variant?: "card" | "ticket";
}) {
  const { t } = await getServerMessages();
  const localized = t.pricingTiers[tier.id];
  const annual = interval === "annual";
  const savePct = Math.round((1 - tier.annualPrice / tier.price) * 100);

  // Logged-out visitors go through signup first. Logged-in visitors get a
  // real button: straight to Checkout if they have no live subscription
  // yet, or to the Customer Portal if they do — Stripe's portal is what
  // actually handles switching between plans on an existing subscription
  // (with correct proration), so we never start a second Checkout for
  // someone who's already paying.
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  // Same-number swap (€19 not a literal $->€ conversion) — see plans.ts —
  // so only the symbol changes here, not the digits.
  const currencySymbol = (await isEUVisitor()) ? "€" : "$";

  let currentPlan: string | null = null;
  let hasLiveSubscription = false;
  if (userData.user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("plan, plan_status")
      .eq("id", userData.user.id)
      .single();
    currentPlan = profile?.plan ?? null;
    hasLiveSubscription = profile?.plan_status === "active" || profile?.plan_status === "past_due";
  }

  const isCurrentPlan = hasLiveSubscription && currentPlan === tier.id;

  if (variant === "ticket") {
    // The credits feature line is the localized single source ("140 credits
    // ≈ 140 standard videos... / month" in each language); the ticket splits
    // it at the ≈ into the ochre serif credits line and the muted exchange
    // detail. Every locale's line carries the ≈ (pinned by the i18n shape);
    // if one ever drops it, the whole line just renders muted — never wrong.
    const [creditsFeature, ...restFeatures] = localized.features;
    const eqIndex = creditsFeature.indexOf("≈");
    const creditsLead = eqIndex > 0 ? creditsFeature.slice(0, eqIndex).trim() : null;
    // The ochre lead already ends "/ month", so the detail sheds its own
    // trailing "/ month" (per-locale word) — the board prints it once.
    const creditsDetail = (
      eqIndex > 0 ? `≈ ${creditsFeature.slice(eqIndex + 1).trim()}` : creditsFeature
    ).replace(new RegExp(`\\s*/\\s*${t.marketing.home.perMonthWord}\\s*$`), "");

    const cta = isCurrentPlan ? (
      <span className="flex w-full items-center justify-center rounded-[10px] px-4 py-3.5 text-sm font-semibold text-[#f7f6f4]/45 shadow-[inset_0_0_0_1px_rgba(247,246,244,0.14)]">
        {t.marketing.pricing.currentPlan}
      </span>
    ) : !userData.user ? (
      <Link
        href="/signup"
        className={
          tier.highlight
            ? "flex w-full items-center justify-center rounded-[10px] bg-ochre px-4 py-3.5 text-sm font-semibold text-[#f7f6f4] shadow-[0_14px_34px_-10px_rgba(168,78,36,0.6)] transition-colors hover:bg-ochre-deep"
            : "flex w-full items-center justify-center rounded-[10px] px-4 py-3.5 text-sm font-semibold text-[#f7f6f4] shadow-[inset_0_0_0_1px_rgba(247,246,244,0.3)] transition-shadow hover:shadow-[inset_0_0_0_1px_rgba(247,246,244,0.55)]"
        }
      >
        {formatMsg(t.marketing.home.choosePlan, { name: localized.name })}
      </Link>
    ) : hasLiveSubscription ? (
      <form action={createPortalSession}>
        <TicketSubmit filled={tier.highlight}>{t.settings.manageBilling}</TicketSubmit>
      </form>
    ) : (
      <form action={createCheckoutSession}>
        <input type="hidden" name="plan" value={tier.id} />
        <input type="hidden" name="billing_interval" value={annual ? "annual" : "month"} />
        <TicketSubmit filled={tier.highlight}>
          {formatMsg(t.marketing.home.choosePlan, { name: localized.name })}
        </TicketSubmit>
      </form>
    );

    return (
      <div
        className={cn(
          "relative flex flex-col rounded-[16px] border bg-[#f7f6f4]/[0.04]",
          tier.highlight
            ? "border-[#e0a468]/40 shadow-[0_30px_80px_-30px_rgba(224,164,104,0.25)] lg:-mb-2.5 lg:-translate-y-2.5"
            : "border-[#f7f6f4]/[0.08]",
        )}
      >
        {localized.badge && (
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#e0a468] px-3 py-[5px] font-display text-[10px] font-bold uppercase tracking-[0.14em] text-[#101014]">
            {localized.badge}
          </span>
        )}

        <div className="p-5 pb-0">
          <div
            className={cn(
              "flex items-baseline justify-between border-b pb-3",
              tier.highlight ? "border-[#e0a468]/40" : "border-[#f7f6f4]/[0.08]",
            )}
          >
            <span
              className={cn(
                "text-[11px] font-semibold uppercase tracking-[0.16em]",
                tier.highlight ? "text-[#e0a468]" : "text-[#f7f6f4]/45",
              )}
            >
              {t.marketing.home.admitLabel}
            </span>
            <span className="font-display text-[13px] font-bold uppercase tracking-[0.06em] text-[#f7f6f4]">
              {localized.name}
            </span>
          </div>

          <p className="mt-5 flex items-baseline gap-1.5">
            <span
              className={cn(
                "font-numeral text-[44px] leading-none tabular-nums",
                tier.highlight ? "text-[#e0a468]" : "text-[#f7f6f4]",
              )}
            >
              {currencySymbol}
              {annual ? tier.annualPrice : tier.price}
            </span>
            <span className="text-[13px] text-[#f7f6f4]/45">{t.marketing.pricing.perMonth}</span>
          </p>
          {annual ? (
            <p className="mt-2.5 text-xs text-[#f7f6f4]/45">
              <SerifNumerals
                text={formatMsg(t.marketing.home.ticketBilledYr, {
                  sym: currencySymbol,
                  total: (tier.annualPrice * 12).toLocaleString("en-US"),
                })}
              />{" "}
              ·{" "}
              <span className="lowercase text-[#e0a468]">
                <SerifNumerals text={formatMsg(t.marketing.pricing.savePercent, { n: savePct })} />
              </span>
            </p>
          ) : (
            <p className="mt-2.5 text-xs text-[#f7f6f4]/45">
              {formatMsg(t.marketing.pricing.monthlyEquivalent, {
                sym: currencySymbol,
                price: tier.annualPrice,
              })}
            </p>
          )}

          {creditsLead && (
            <p className="mt-5 font-numeral text-base tabular-nums text-[#e0a468]">
              {creditsLead} / {t.marketing.home.perMonthWord}
            </p>
          )}
          <p className={cn("min-h-9 text-xs leading-[18px] text-[#f7f6f4]/62", creditsLead ? "mt-1" : "mt-5")}>
            {creditsDetail}
          </p>

          <ul className="mt-4 flex-1 space-y-2 border-t border-[#f7f6f4]/[0.08] pt-4">
            {restFeatures.map((feature) => (
              <li key={feature} className="text-xs leading-relaxed text-[#f7f6f4]/62">
                {feature}
              </li>
            ))}
          </ul>
        </div>

        {/* The perforation: dashed tear line with punched notches — the
            board's signature treatment (deliberately off the hairline token;
            approved on the design canvas). */}
        <div className="relative mt-auto pt-5">
          <div className="border-t border-dashed border-[#f7f6f4]/[0.16]" />
          <span
            aria-hidden
            className={cn(
              "absolute -left-2 top-5 h-4 w-4 -translate-y-1/2 rounded-full border bg-[#101014]",
              tier.highlight ? "border-[#e0a468]/40" : "border-[#f7f6f4]/[0.08]",
            )}
          />
          <span
            aria-hidden
            className={cn(
              "absolute -right-2 top-5 h-4 w-4 -translate-y-1/2 rounded-full border bg-[#101014]",
              tier.highlight ? "border-[#e0a468]/40" : "border-[#f7f6f4]/[0.08]",
            )}
          />
          <div className="p-5">{cta}</div>
        </div>
      </div>
    );
  }

  return (
    <Card
      className={cn(
        "flex flex-col",
        tier.highlight && "shadow-[0_1px_2px_rgba(0,0,0,0.03),0_16px_36px_-14px_rgba(0,0,0,0.14)] ring-1 ring-ochre",
      )}
    >
      {localized.badge && (
        <span className="mb-4 inline-flex w-fit items-center rounded-full bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white">
          {localized.badge}
        </span>
      )}
      <h3 className="text-sm font-semibold text-neutral-900">{localized.name}</h3>
      <p className="mt-2 flex items-baseline gap-2">
        {annual && (
          <span className="text-base font-medium text-neutral-300 line-through">
            {currencySymbol}
            {tier.price}
          </span>
        )}
        <span className="text-3xl font-semibold text-neutral-900">
          {currencySymbol}
          {annual ? tier.annualPrice : tier.price}
        </span>
        <span className="text-sm text-neutral-500">{t.marketing.pricing.perMonth}</span>
      </p>
      {annual ? (
        <div className="mt-2 space-y-1">
          {/* Just the computed percentage — the "3 months free" badge was
              retired 2026-08-19 when the annual discount was trimmed to
              ~15%: at that rate it stopped being literally true, and a badge
              that needs an asterisk is worse than no badge. */}
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-ochre-soft px-2 py-0.5 text-[11px] font-semibold text-ochre">
              {formatMsg(t.marketing.pricing.savePercent, { n: savePct })}
            </span>
          </p>
          <p className="text-xs text-neutral-400">
            {formatMsg(t.marketing.pricing.billedAnnually, {
              sym: currencySymbol,
              total: tier.annualPrice * 12,
            })}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-neutral-400">
          {formatMsg(t.marketing.pricing.monthlyEquivalent, {
            sym: currencySymbol,
            price: tier.annualPrice,
          })}
        </p>
      )}

      <ul className="mt-6 flex-1 space-y-2.5">
        {localized.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-neutral-600">
            <span className="mt-1 h-1 w-1 flex-shrink-0 rounded-full bg-neutral-400" />
            {feature}
          </li>
        ))}
      </ul>

      {isCurrentPlan ? (
        <span className="mt-6 flex w-full items-center justify-center rounded-[10px] border border-neutral-200 px-5 py-2.5 text-sm font-medium text-neutral-400">
          {t.marketing.pricing.currentPlan}
        </span>
      ) : !userData.user ? (
        <Link href="/signup" className="mt-6 block">
          <Button variant={tier.highlight ? "primary" : "secondary"} className="w-full">
            {t.marketing.pricing.getStarted}
          </Button>
        </Link>
      ) : hasLiveSubscription ? (
        <form action={createPortalSession} className="mt-6">
          <SubmitButton
            variant={tier.highlight ? "primary" : "secondary"}
            className="w-full"
            pendingLabel={t.common.loading}
          >
            {t.settings.manageBilling}
          </SubmitButton>
        </form>
      ) : (
        <form action={createCheckoutSession} className="mt-6">
          <input type="hidden" name="plan" value={tier.id} />
          <input type="hidden" name="billing_interval" value={annual ? "annual" : "month"} />
          <SubmitButton
            variant={tier.highlight ? "primary" : "secondary"}
            className="w-full"
            pendingLabel={t.common.loading}
          >
            {t.marketing.pricing.getStarted}
          </SubmitButton>
        </form>
      )}
    </Card>
  );
}
