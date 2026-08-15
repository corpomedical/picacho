"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/client";
import { PLAN_PRICE_IDS, PLAN_PRICE_IDS_EUR } from "@/lib/stripe/plans";
import {
  getCreditPack,
  CREDIT_PACK_PRICE_IDS,
  CREDIT_PACK_PRICE_IDS_EUR,
} from "@/lib/stripe/credit-packs";
import type { PlanId } from "@/lib/plans";
import { getOrigin } from "@/lib/origin";
import { isEUVisitor } from "@/lib/geo";

// Starts a Stripe Checkout session for a brand-new subscription. Existing
// subscribers should use createPortalSession instead — Stripe's Customer
// Portal handles upgrades, downgrades, and cancellation for accounts that
// already have one. Native <form> action, so it uses redirect() throughout.
export async function createCheckoutSession(formData: FormData) {
  const planId = formData.get("plan") as PlanId | null;

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
    .select("stripe_customer_id")
    .eq("id", userData.user.id)
    .single();

  const origin = await getOrigin();
  let checkoutUrl: string | null = null;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: profile?.stripe_customer_id ?? undefined,
      customer_email: profile?.stripe_customer_id ? undefined : (userData.user.email ?? undefined),
      client_reference_id: userData.user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      // Stripe Tax activated 2026-08-09 (Dashboard > Settings > Tax) — this
      // is what actually turns that on for real charges. Stripe collects
      // whatever address it needs and calculates VAT/sales tax itself based
      // on the registrations configured there; nothing else on our end
      // depends on which jurisdictions those are.
      automatic_tax: { enabled: true },
      // Shows Stripe's own "Add promotion code" field on the payment page —
      // the promo system's entire client-facing UI. Codes are created and
      // managed in Admin > Promo codes (see lib/admin/promo-actions.ts).
      allow_promotion_codes: true,
      success_url: `${origin}/app/settings?tab=usage&saved=1`,
      cancel_url: `${origin}/app/settings?tab=usage`,
      subscription_data: { metadata: { supabase_user_id: userData.user.id } },
      metadata: { supabase_user_id: userData.user.id },
    });
    checkoutUrl = session.url;
  } catch (err) {
    console.error("Stripe checkout session creation failed:", err);
  }

  if (!checkoutUrl) {
    redirect(`/app/settings?tab=usage&error=${encodeURIComponent("Couldn't start checkout — try again.")}`);
  }

  redirect(checkoutUrl);
}

// One-time credit top-up. mode: "payment", not "subscription" — the credits
// are granted once by the webhook and then deplete as they're used (see
// profiles.purchased_credits). Kept as a separate action rather than a flag
// on the one above, because almost every field differs and conflating them
// risks accidentally starting a recurring charge for a one-off purchase.
export async function createCreditCheckoutSession(formData: FormData) {
  const packId = formData.get("pack") as string | null;
  const pack = packId ? getCreditPack(packId) : undefined;

  // Where to land after paying. Someone who tops up from the composer because
  // they were short for a generation should come back to that composer, not
  // be dumped in Settings to find their way home.
  //
  // Allowlisted to in-app paths, not just "starts with /": a caller-supplied
  // redirect target that isn't constrained is an open-redirect, and this one
  // is reachable from a form anybody can submit.
  const requestedReturn = (formData.get("return_to") as string | null) ?? "";
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
  let checkoutUrl: string | null = null;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: profile?.stripe_customer_id ?? undefined,
      customer_email: profile?.stripe_customer_id ? undefined : (userData.user.email ?? undefined),
      client_reference_id: userData.user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      automatic_tax: { enabled: true },
      success_url: `${origin}${returnTo}${returnTo.includes("?") ? "&" : "?"}credits=1`,
      cancel_url: `${origin}${returnTo}`,
      // The webhook credits the account off this, so it has to be present.
      // client_reference_id is also set above as a belt-and-braces second
      // copy — a payment that can't be attributed to an account is money
      // taken for nothing, which is the one outcome worth being paranoid about.
      metadata: { supabase_user_id: userData.user.id, credit_pack: pack.id },
    });
    checkoutUrl = session.url;
  } catch (err) {
    console.error("Stripe credit checkout session creation failed:", err);
  }

  if (!checkoutUrl) {
    redirect(`/app/settings?tab=usage&error=${encodeURIComponent("Couldn't start checkout — try again.")}`);
  }

  redirect(checkoutUrl);
}

// Opens Stripe's hosted Customer Portal for an existing subscriber — lets
// them change plans, update their payment method, view invoices, or cancel,
// all without us building any of that UI ourselves.
export async function createPortalSession() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", userData.user.id)
    .single();

  if (!profile?.stripe_customer_id) {
    redirect(
      `/app/settings?tab=usage&error=${encodeURIComponent("No billing account yet — start with a plan below.")}`,
    );
  }

  const origin = await getOrigin();
  let portalUrl: string | null = null;

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${origin}/app/settings?tab=usage`,
    });
    portalUrl = session.url;
  } catch (err) {
    console.error("Stripe billing portal session creation failed:", err);
  }

  if (!portalUrl) {
    redirect(`/app/settings?tab=usage&error=${encodeURIComponent("Couldn't open billing — try again.")}`);
  }

  redirect(portalUrl);
}
