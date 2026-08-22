import { redirect } from "next/navigation";
import type Stripe from "stripe";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/client";
import { PLAN_PRICE_IDS, PLAN_PRICE_IDS_EUR } from "@/lib/stripe/plans";
import { PRICING_TIERS } from "@/lib/pricing";
import {
  getCreditPack,
  CREDIT_PACK_PRICE_IDS,
  CREDIT_PACK_PRICE_IDS_EUR,
} from "@/lib/stripe/credit-packs";
import type { PlanId } from "@/lib/plans";
import { getOrigin } from "@/lib/origin";
import { isEUVisitor } from "@/lib/geo";
import { isNativeApp } from "@/lib/native/server";

// The ONE place checkout sessions are built — used by the hosted-redirect
// server actions (lib/stripe/actions.ts) AND the embedded checkout page
// (app/app/checkout, 2026-08-22: Stripe's form now renders inside a
// Frost-styled page on picacho.ai instead of a full redirect to stripe.com).
// Every guard lives here exactly once: the reader-app block, the
// one-customer-per-account rule, the no-second-subscription rule, the
// EUR/USD price split, the annual inline price, promo codes and automatic
// tax. The two modes differ ONLY in how Stripe hands control back:
// hosted → session.url to redirect to; embedded → session.client_secret for
// the in-page iframe, with return_url as the way home.

export type CheckoutUi = "hosted" | "embedded";
export type CheckoutStart = { url: string | null; clientSecret: string | null };

// Reader-app policy (Apple App Store 3.1.1 / Google Play): inside the native
// app we may NOT sell digital goods or open any purchase/billing flow —
// subscriptions, credit top-ups, or the Customer Portal (which can change
// plans and take payment). Hiding the buttons isn't enough: a Server Action
// is a POST endpoint reachable from anything that has its id (and the
// checkout page is a URL anyone can type), so every purchase entry point
// refuses server-side when the request comes from the app.
export async function blockInNativeApp(): Promise<void> {
  if (await isNativeApp()) redirect("/app/settings?tab=usage");
}

// Ensures the profile has exactly ONE Stripe customer and returns its id.
//
// Created up front rather than left to Checkout's customer_email path: with
// customer_email, Stripe mints a brand-new customer per completed session, so
// someone who bought a credit pack and then subscribed (or topped up twice
// quickly) ended up split across duplicate customer records — breaking the
// Customer Portal, the webhook's stripe_customer_id fallback lookup, and the
// deletion cleanup in cancel-customer.ts, none of which can see past the one
// id the profile stores.
//
// The write goes through the service-role client (authenticated has no UPDATE
// grant on stripe_customer_id — see the column lockdown in schema.sql), and
// it's guarded against two concurrent checkouts racing each other: the update
// only claims the column while it's still NULL, and the loser deletes its
// just-created duplicate and uses the winner's id instead.
export async function ensureStripeCustomer(
  userId: string,
  email: string | null | undefined,
  existingCustomerId: string | null | undefined,
): Promise<string> {
  if (existingCustomerId) return existingCustomerId;

  const customer = await stripe.customers.create({
    email: email ?? undefined,
    metadata: { supabase_user_id: userId },
  });

  const admin = createAdminClient();
  const { data: claimed } = await admin
    .from("profiles")
    .update({ stripe_customer_id: customer.id })
    .eq("id", userId)
    .is("stripe_customer_id", null)
    .select("id");

  if (!claimed || claimed.length === 0) {
    // Lost the race (or the profile row is missing): another request already
    // stored a customer. Use theirs and clean up ours — best-effort, an
    // orphaned empty customer is cosmetic, not money.
    const { data: profile } = await admin
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", userId)
      .single();
    if (profile?.stripe_customer_id && profile.stripe_customer_id !== customer.id) {
      try {
        await stripe.customers.del(customer.id);
      } catch {
        // ignore — see above
      }
      return profile.stripe_customer_id;
    }
  }

  return customer.id;
}

// Starts a subscription checkout for a brand-new subscriber. Existing
// subscribers are turned away toward the Customer Portal — see the guard
// below. Redirects (never returns) on every validation failure.
export async function startPlanCheckout(
  planIdRaw: string | null,
  interval: "annual" | "month",
  ui: CheckoutUi,
): Promise<CheckoutStart> {
  await blockInNativeApp();
  const planId = planIdRaw as PlanId | null;

  if (!planId || planId === "none" || !(planId in PLAN_PRICE_IDS)) {
    redirect(`/app/settings?tab=usage&error=${encodeURIComponent("That plan isn't available.")}`);
  }

  const paidPlanId = planId as Exclude<PlanId, "none">;
  // EU visitors get charged in EUR directly (real Stripe Price in that
  // currency, not Adaptive Pricing) when that plan's EUR price exists yet —
  // see PLAN_PRICE_IDS_EUR in stripe/plans.ts. Falls back to the USD price
  // for everyone else, and for EU visitors too until setup-eur-pricing.js
  // has been run.
  const wantsEUR = await isEUVisitor();
  const priceId = (wantsEUR ? PLAN_PRICE_IDS_EUR[paidPlanId] : null) ?? PLAN_PRICE_IDS[paidPlanId];
  if (!priceId) {
    redirect(`/app/settings?tab=usage&error=${encodeURIComponent("This plan isn't set up for checkout yet.")}`);
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id, stripe_subscription_id, plan_status")
    .eq("id", userData.user.id)
    .single();

  // Server-side twin of the UI rule ("straight to Checkout only if they have
  // no live subscription") — a hidden button is not a guard. A second
  // Checkout for an existing subscriber wouldn't upgrade them, it would
  // start a SECOND subscription billing in parallel; plan changes go through
  // the Customer Portal, which prorates correctly. past_due counts as live,
  // matching hasLiveSubscription in pricing-card.tsx — a failed payment is
  // fixed in the portal, not by stacking a fresh subscription on top.
  if (
    profile?.stripe_subscription_id &&
    (profile.plan_status === "active" || profile.plan_status === "past_due")
  ) {
    redirect(
      `/app/settings?tab=usage&error=${encodeURIComponent("You already have a subscription — use Manage billing to change plans.")}`,
    );
  }

  const origin = await getOrigin();

  try {
    const customerId = await ensureStripeCustomer(
      userData.user.id,
      userData.user.email,
      profile?.stripe_customer_id,
    );

    // Annual has no pre-created Stripe Price: the line item is built inline
    // (price_data) against the SAME Product as the monthly price, so Stripe
    // reporting groups them and the currency follows the same USD/EUR
    // geo-split as monthly. The webhook can't map an ad-hoc price id back to
    // a plan, so the plan id rides on subscription metadata instead — see
    // the metadata fallback in webhooks/stripe/route.ts.
    let lineItem: Record<string, unknown> = { price: priceId, quantity: 1 };
    if (interval === "annual") {
      const tier = PRICING_TIERS.find((p) => p.id === paidPlanId);
      if (!tier) throw new Error(`No pricing tier for ${paidPlanId}`);
      const monthlyPrice = await stripe.prices.retrieve(priceId!);
      lineItem = {
        price_data: {
          currency: monthlyPrice.currency,
          product:
            typeof monthlyPrice.product === "string"
              ? monthlyPrice.product
              : monthlyPrice.product.id,
          unit_amount: tier.annualPrice * 12 * 100,
          recurring: { interval: "year" },
        },
        quantity: 1,
      };
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      // Always a real, pre-created customer (ensureStripeCustomer above) —
      // never customer_email, which mints a fresh Stripe customer per
      // completed session and split one person across duplicate records.
      customer: customerId,
      client_reference_id: userData.user.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      line_items: [lineItem as any],
      // Stripe Tax activated 2026-08-09 (Dashboard > Settings > Tax).
      automatic_tax: { enabled: true },
      // Stripe's own "Add promotion code" field — the promo system's entire
      // client-facing UI, in both hosted and embedded modes. Codes are
      // managed in Admin > Promo codes (see lib/admin/promo-actions.ts).
      allow_promotion_codes: true,
      subscription_data: {
        metadata: { supabase_user_id: userData.user.id, plan: paidPlanId },
      },
      metadata: { supabase_user_id: userData.user.id, plan: paidPlanId },
      ...(ui === "embedded"
        ? {
            // "embedded_page" is the 2026 API's name for what the docs long
            // called embedded mode — the account's pinned version
            // (2026-07-29.dahlia) rejects the old literal outright.
            ui_mode: "embedded_page" as Stripe.Checkout.SessionCreateParams.UiMode,
            return_url: `${origin}/app/settings?tab=usage&saved=1`,
          }
        : {
            success_url: `${origin}/app/settings?tab=usage&saved=1`,
            cancel_url: `${origin}/app/settings?tab=usage`,
          }),
    });
    return { url: session.url ?? null, clientSecret: session.client_secret ?? null };
  } catch (err) {
    console.error("Stripe checkout session creation failed:", err);
    return { url: null, clientSecret: null };
  }
}

// One-time credit top-up. mode: "payment", not "subscription" — the credits
// are granted once by the webhook and then deplete as they're used (see
// profiles.purchased_credits). Separate from the plan creator because almost
// every field differs and conflating them risks accidentally starting a
// recurring charge for a one-off purchase.
export async function startCreditCheckout(
  packIdRaw: string | null,
  requestedReturn: string,
  ui: CheckoutUi,
): Promise<CheckoutStart & { returnTo: string }> {
  await blockInNativeApp();
  const pack = packIdRaw ? getCreditPack(packIdRaw) : undefined;

  // Where to land after paying. Someone who tops up from the composer because
  // they were short for a generation should come back to that composer, not
  // be dumped in Settings to find their way home.
  //
  // Allowlisted to in-app paths, not just "starts with /": a caller-supplied
  // redirect target that isn't constrained is an open-redirect, and this one
  // is reachable from a form anybody can submit.
  const returnTo = /^\/app\/[a-z0-9/-]*$/i.test(requestedReturn)
    ? requestedReturn
    : "/app/settings?tab=usage";

  if (!pack) {
    redirect(`/app/settings?tab=usage&error=${encodeURIComponent("That credit pack isn't available.")}`);
  }

  const wantsEUR = await isEUVisitor();
  const priceId =
    (wantsEUR ? CREDIT_PACK_PRICE_IDS_EUR[pack.id] : null) ?? CREDIT_PACK_PRICE_IDS[pack.id];
  if (!priceId) {
    redirect(
      `/app/settings?tab=usage&error=${encodeURIComponent("Credit packs aren't set up for checkout yet.")}`,
    );
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", userData.user.id)
    .single();

  const origin = await getOrigin();

  try {
    const customerId = await ensureStripeCustomer(
      userData.user.id,
      userData.user.email,
      profile?.stripe_customer_id,
    );

    const successTarget = `${origin}${returnTo}${returnTo.includes("?") ? "&" : "?"}credits=1`;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      // Same single-customer rule as startPlanCheckout above.
      customer: customerId,
      client_reference_id: userData.user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      automatic_tax: { enabled: true },
      // The webhook credits the account off this, so it has to be present.
      // client_reference_id is also set above as a belt-and-braces second
      // copy — a payment that can't be attributed to an account is money
      // taken for nothing, which is the one outcome worth being paranoid
      // about.
      metadata: { supabase_user_id: userData.user.id, credit_pack: pack.id },
      ...(ui === "embedded"
        ? {
            // Same 2026 rename as startPlanCheckout above.
            ui_mode: "embedded_page" as Stripe.Checkout.SessionCreateParams.UiMode,
            return_url: successTarget,
          }
        : { success_url: successTarget, cancel_url: `${origin}${returnTo}` }),
    });
    return { url: session.url ?? null, clientSecret: session.client_secret ?? null, returnTo };
  } catch (err) {
    console.error("Stripe credit checkout session creation failed:", err);
    return { url: null, clientSecret: null, returnTo };
  }
}
