"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/client";
import { PLAN_PRICE_IDS, PLAN_PRICE_IDS_EUR } from "@/lib/stripe/plans";
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
