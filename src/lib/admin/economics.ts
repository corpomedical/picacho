import type { SupabaseClient } from "@supabase/supabase-js";
import { PRICING_TIERS } from "@/lib/pricing";
import { COST_BASIS_USD_PER_CREDIT } from "@/lib/generations/providers/video-models";
import type { PlanId } from "@/lib/plans";

// Per-account money: what an account pays us, what it costs us to serve, and
// what is left.
//
// Everything on the cost side is an ESTIMATE and the UI says so. We do not
// receive a per-request invoice from OpenAI or fal, so cost is reconstructed
// from what each generation is known to consume. The estimate is built from
// the product's own existing numbers rather than new guesses:
//
//   • COST_BASIS_USD_PER_CREDIT (0.28) — the peg every video credit weight in
//     video-models.ts was derived from. A video's cost is its credit weight
//     times that, which is exactly how the weights were set.
//   • IMAGE_COST_USD (0.17) — the figure the pricing analysis used for a GPT
//     Image render, and the same one PLAN_REFERENCE_IMAGE_LIMITS is built on.
//
// Revenue is what the account's plan is worth per month plus any one-off
// credit purchases. It is NOT read from Stripe invoices — we do not sync
// those — so treat it as "what this plan bills", not "what cleared".

const IMAGE_COST_USD = 0.17;

// A Claude draft plus, for the image mode, a vision read. Cents, not euros —
// listed for completeness rather than because it moves the total.
const PROMPT_ASSIST_COST_USD = 0.01;

// Static and documented rather than fetched: a live FX rate would make two
// runs of the same report disagree, and the precision is false anyway on top
// of estimated costs. Revenue is in euros, provider bills are in dollars.
const EUR_PER_USD = 0.92;

function usdToEurCents(usd: number): number {
  return Math.round(usd * EUR_PER_USD * 100);
}

// Revenue rows (credit purchases, promo redemptions) store an amount in cents
// AND the currency it was charged in. This whole report is denominated in
// euros (see EUR_PER_USD above), so a dollar-charged purchase or a
// dollar-denominated promo subtotal must be converted before it is folded into
// a euro total — otherwise a $100 purchase and a €100 purchase are summed as if
// they were the same, and a rep's commission is computed against a subtotal in
// the wrong currency. Only EUR and USD are billed; an unrecognised currency is
// left at par rather than invented away, and the report's "estimate" framing
// covers that rare case.
function amountToEurCents(amountCents: number, currency: string | null | undefined): number {
  const cents = Number(amountCents) || 0;
  const cur = (currency ?? "eur").toLowerCase();
  if (cur === "usd") return Math.round(cents * EUR_PER_USD);
  return cents;
}

export type MonthEconomics = {
  /** First day of the month, ISO — the key and the sort order. */
  month: string;
  label: string;
  revenueCents: number;
  planRevenueCents: number;
  purchaseRevenueCents: number;
  costCents: number;
  imageCostCents: number;
  videoCostCents: number;
  referencePhotoCostCents: number;
  assistCostCents: number;
  marginCents: number;
  images: number;
  videos: number;
  failed: number;
  referencePhotos: number;
  assists: number;
  creditsUsed: number;
};

export type UserEconomics = {
  months: MonthEconomics[];
  lifetime: {
    revenueCents: number;
    costCents: number;
    marginCents: number;
    generations: number;
  };
  /** Set when this account arrived through a salesperson's promo code. */
  acquisition: {
    code: string;
    repName: string;
    discountGivenCents: number;
    commissionOwedCents: number;
  } | null;
  planMonthlyCents: number;
};

function monthKey(iso: string): string {
  return iso.slice(0, 7) + "-01";
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en", {
    month: "short",
    year: "numeric",
  });
}

function emptyMonth(month: string): MonthEconomics {
  return {
    month,
    label: monthLabel(month),
    revenueCents: 0,
    planRevenueCents: 0,
    purchaseRevenueCents: 0,
    costCents: 0,
    imageCostCents: 0,
    videoCostCents: 0,
    referencePhotoCostCents: 0,
    assistCostCents: 0,
    marginCents: 0,
    images: 0,
    videos: 0,
    failed: 0,
    referencePhotos: 0,
    assists: 0,
    creditsUsed: 0,
  };
}

export async function getUserEconomics(
  supabase: SupabaseClient,
  userId: string,
  plan: PlanId,
  planStatus: string | null,
  monthsBack = 6,
): Promise<UserEconomics> {
  const since = new Date();
  since.setMonth(since.getMonth() - (monthsBack - 1));
  since.setDate(1);
  since.setHours(0, 0, 0, 0);
  const sinceIso = since.toISOString();

  const [generations, purchases, refPhotos, assists, redemption] = await Promise.all([
    // Deleted rows included on purpose: the work was done and the money was
    // spent whether or not the user later hid it from their history.
    supabase
      .from("generations")
      .select("created_at, content_type, status, credits_used, attempts, video_model_id")
      .eq("user_id", userId)
      .gte("created_at", sinceIso),
    supabase
      .from("credit_purchases")
      .select("created_at, amount_cents, currency, refunded_at")
      .eq("user_id", userId)
      .gte("created_at", sinceIso),
    supabase
      .from("reference_image_generations")
      .select("created_at")
      .eq("user_id", userId)
      .gte("created_at", sinceIso),
    supabase
      .from("prompt_assists")
      .select("created_at")
      .eq("user_id", userId)
      .gte("created_at", sinceIso),
    supabase
      .from("promo_redemptions")
      .select("code, rep_name, amount_subtotal, discount_amount, commission_percent, currency")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const months = new Map<string, MonthEconomics>();
  const bucket = (iso: string) => {
    const key = monthKey(iso);
    if (!months.has(key)) months.set(key, emptyMonth(key));
    return months.get(key)!;
  };

  // Make sure every month in the window exists, even a silent one — a gap in
  // the table reads as missing data rather than as a quiet month.
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(since);
    d.setMonth(d.getMonth() + i);
    bucket(d.toISOString());
  }

  for (const g of generations.data ?? []) {
    const m = bucket(g.created_at as string);
    const failed = g.status !== "succeeded";
    if (failed) m.failed += 1;

    // Attempts, not credits: a failed generation can have had its credits
    // zeroed by a refund and still have burned three real renders. Floored at
    // 1 because a row exists only once work has started.
    const tries = Math.max(1, Number(g.attempts) || 1);

    if (g.content_type === "video") {
      if (!failed) m.videos += 1;
      // Credit weight is the honest proxy — it was derived from cost.
      const weight = Math.max(1, Number(g.credits_used) || 1);
      m.videoCostCents += usdToEurCents(weight * COST_BASIS_USD_PER_CREDIT);
    } else {
      if (!failed) m.images += 1;
      m.imageCostCents += usdToEurCents(tries * IMAGE_COST_USD);
    }
    m.creditsUsed += Number(g.credits_used) || 0;
  }

  for (const r of refPhotos.data ?? []) {
    const m = bucket(r.created_at as string);
    m.referencePhotos += 1;
    m.referencePhotoCostCents += usdToEurCents(IMAGE_COST_USD);
  }

  for (const a of assists.data ?? []) {
    const m = bucket(a.created_at as string);
    m.assists += 1;
    m.assistCostCents += usdToEurCents(PROMPT_ASSIST_COST_USD);
  }

  for (const p of purchases.data ?? []) {
    if (p.refunded_at) continue;
    const m = bucket(p.created_at as string);
    // Convert to euros: a USD-charged top-up must not be summed at face value
    // into a euro revenue total.
    m.purchaseRevenueCents += amountToEurCents(Number(p.amount_cents), p.currency as string | null);
  }

  // Subscription revenue: the plan's list price, counted for any month in
  // which the account generated or bought something, plus the current month
  // while the subscription is live. Without invoice sync this is the closest
  // honest answer, and the UI labels it "plan value" rather than "billed".
  const planMonthlyCents = Math.round((PRICING_TIERS.find((tier) => tier.id === plan)?.price ?? 0) * 100);
  const subscriptionLive = planStatus === "active" || planStatus === "past_due";
  const thisMonth = monthKey(new Date().toISOString());

  for (const m of months.values()) {
    const active = subscriptionLive && m.month === thisMonth;
    const hadActivity = m.creditsUsed > 0 || m.images > 0 || m.videos > 0 || m.failed > 0;
    m.planRevenueCents = active || (hadActivity && subscriptionLive) ? planMonthlyCents : 0;
    m.revenueCents = m.planRevenueCents + m.purchaseRevenueCents;
    m.costCents =
      m.imageCostCents + m.videoCostCents + m.referencePhotoCostCents + m.assistCostCents;
    m.marginCents = m.revenueCents - m.costCents;
  }

  const ordered = [...months.values()].sort((a, b) => (a.month < b.month ? 1 : -1));

  const red = redemption.data;
  return {
    months: ordered,
    lifetime: {
      revenueCents: ordered.reduce((s, m) => s + m.revenueCents, 0),
      costCents: ordered.reduce((s, m) => s + m.costCents, 0),
      marginCents: ordered.reduce((s, m) => s + m.marginCents, 0),
      generations: ordered.reduce((s, m) => s + m.images + m.videos + m.failed, 0),
    },
    acquisition: red
      ? {
          code: red.code as string,
          repName: red.rep_name as string,
          // Both the discount shown and the commission owed are converted from
          // the redemption's own currency into the report's euros — the
          // commission is a percentage of the euro subtotal, not of a dollar
          // amount treated as euros.
          discountGivenCents: amountToEurCents(
            Number(red.discount_amount),
            red.currency as string | null,
          ),
          commissionOwedCents: amountToEurCents(
            Math.round(((Number(red.amount_subtotal) || 0) * (Number(red.commission_percent) || 0)) / 100),
            red.currency as string | null,
          ),
        }
      : null,
    planMonthlyCents,
  };
}
