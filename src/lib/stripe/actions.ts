"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/client";
import { getOrigin } from "@/lib/origin";
import {
  blockInNativeApp,
  startPlanCheckout,
  startCreditCheckout,
  reportCheckoutFailure,
} from "@/lib/stripe/checkout-core";

// The checkout machinery itself — every guard, the price geo-split, the
// annual inline price, session fields — lives in ONE place now:
// lib/stripe/checkout-core.ts, shared with the embedded checkout page
// (app/app/checkout). These actions are the legacy hosted-redirect wrappers
// kept for any surface that still POSTs a form at them.

// Starts a Stripe Checkout session for a brand-new subscription. Existing
// subscribers should use createPortalSession instead — Stripe's Customer
// Portal handles upgrades, downgrades, and cancellation for accounts that
// already have one. Native <form> action, so it uses redirect() throughout.
export async function createCheckoutSession(formData: FormData) {
  const planId = (formData.get("plan") as string | null) ?? "";
  // "annual" bills yearly at the tier's annualPrice x 12 (~15% off since
  // 2026-08-19); anything else is the monthly default.
  const interval = formData.get("billing_interval") === "annual" ? "annual" : "month";
  // Since 2026-08-22 checkout renders EMBEDDED on our own page — this action
  // survives as the stable POST target the plan buttons already submit to,
  // and simply forwards there. The page re-runs every guard via
  // startPlanCheckout, so nothing is trusted from this hop.
  redirect(`/app/checkout?plan=${encodeURIComponent(planId)}&interval=${interval}`);
}

// One-time credit top-up. mode: "payment", not "subscription" — the credits
// are granted once by the webhook and then deplete as they're used (see
// profiles.purchased_credits). Kept as a separate action rather than a flag
// on the one above, because almost every field differs and conflating them
// risks accidentally starting a recurring charge for a one-off purchase.
export async function createCreditCheckoutSession(formData: FormData) {
  const packId = (formData.get("pack") as string | null) ?? "";
  const requestedReturn = (formData.get("return_to") as string | null) ?? "";
  // Same forwarding as createCheckoutSession above — the embedded page owns
  // session creation now (and re-validates pack and return path itself).
  redirect(
    `/app/checkout?pack=${encodeURIComponent(packId)}&return_to=${encodeURIComponent(requestedReturn)}`,
  );
}

// Opens Stripe's hosted Customer Portal for an existing subscriber — lets
// them change plans, update their payment method, view invoices, or cancel,
// all without us building any of that UI ourselves.
export async function createPortalSession() {
  await blockInNativeApp();
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
  let failure: "config" | "transient" | null = null;

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${origin}/app/settings?tab=usage`,
    });
    portalUrl = session.url;
  } catch (err) {
    // Same sink as checkout: a portal outage is how a subscriber fails to fix
    // a failed payment, and it used to be a log line nobody read.
    failure = await reportCheckoutFailure(
      userData.user.id,
      "portal",
      `portal customer=${profile.stripe_customer_id}`,
      err,
    );
  }

  if (!portalUrl) {
    // Codes, not copy — mapped in settings/page.tsx KNOWN_ERRORS. A
    // deterministic failure stops promising that a retry will help.
    const code =
      failure === "config"
        ? "Billing is unavailable right now — we've been alerted. Email support and we'll sort it out."
        : "Couldn't open billing — try again.";
    redirect(`/app/settings?tab=usage&error=${encodeURIComponent(code)}`);
  }

  redirect(portalUrl);
}
