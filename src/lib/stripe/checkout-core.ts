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
import { after } from "next/server";
import { notifyAdmins } from "@/lib/push/web-push";
import {
  classifyStripeFailure,
  REPORT_MARKERS,
  REPORT_SURFACE_LABELS,
  type CheckoutFailureKind,
  type ReportSurface,
} from "@/lib/stripe/failure";

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
export type CheckoutStart = {
  url: string | null;
  clientSecret: string | null;
  /** Set when session creation failed: "config" = the same click will fail
   *  again (our bug — tell the user we've been alerted), "transient" = worth
   *  a retry. */
  failure?: CheckoutFailureKind | null;
};

// Every money-path failure lands in Admin → Reports with a push, the same
// sink every other failure class already has. Until 2026-09-03 the checkout
// catch blocks were console.error-and-return-null: a total outage for new
// buyers (customer_tax_location_invalid, see startPlanCheckout) ran for
// fifteen days because nothing but a Vercel log line ever knew.
//
// The row is written on the request (it is the record); the push goes out
// AFTER the response so a buyer's redirect never waits on twenty device
// endpoints, and it is damped to one push per failure code per half hour —
// a person retrying a deterministic failure files rows, not alarms. Never
// throws; returns the failure kind for the caller's copy.
export async function reportCheckoutFailure(
  userId: string,
  surface: ReportSurface,
  what: string,
  err: unknown,
): Promise<CheckoutFailureKind> {
  const failure = classifyStripeFailure(err);
  const marker = REPORT_MARKERS[surface];
  console.error(`Stripe ${surface} failed (${failure.code}) — ${what}:`, err);
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("generation_reports").insert({
      generation_id: null,
      user_id: userId,
      reason: "technical_error",
      // Marker first, then the diagnosis, then the ids — the PWA and the
      // report drawer truncate, and the code is what an admin needs to see.
      details: `${marker} ${failure.code} · ${what} — ${failure.message}`.slice(0, 1000),
      source: "auto",
    });
    if (error) {
      console.error("reportCheckoutFailure insert failed:", error.message);
      return failure.kind;
    }
    after(async () => {
      try {
        const since = new Date();
        since.setMinutes(since.getMinutes() - 30);
        const { count } = await admin
          .from("generation_reports")
          .select("id", { count: "exact", head: true })
          .eq("source", "auto")
          .like("details", `${marker} ${failure.code}%`)
          .gte("created_at", since.toISOString());
        // Our own row is one of them; a second means an admin was already told.
        if ((count ?? 0) > 1) return;
        await notifyAdmins({
          title: REPORT_SURFACE_LABELS[surface],
          body: `${failure.code} — ${what}`.slice(0, 140),
          path: "#content",
        });
      } catch (pushErr) {
        console.error("reportCheckoutFailure push failed:", pushErr);
      }
    });
  } catch (reportErr) {
    console.error("reportCheckoutFailure failed:", reportErr);
  }
  return failure.kind;
}

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
  if (existingCustomerId) {
    // A stored id can be dead: the customer was deleted in the Stripe
    // Dashboard. Trusting it blindly made every checkout for that account
    // fail forever behind the generic error (2026-09-03 review). Stripe
    // answers a deleted customer with a 200 `{ deleted: true }` stub — that
    // is the ONLY signal we heal on. A thrown resource_missing means the id
    // never existed under THIS key (other mode, other account) and is
    // rethrown into the caller's catch, which reports it as a config
    // failure WITHOUT touching the profile — healing on it would let a
    // test key run against production clobber real customer ids. Tight
    // budget on the read so it can't eat the create's.
    const existing = await stripe.customers.retrieve(
      existingCustomerId,
      {},
      { timeout: 10_000, maxNetworkRetries: 1 },
    );
    if (!("deleted" in existing && existing.deleted)) return existingCustomerId;
    console.warn(`Stripe customer ${existingCustomerId} was deleted; re-creating for ${userId}`);
    const { error: clearError } = await createAdminClient()
      .from("profiles")
      .update({ stripe_customer_id: null })
      .eq("id", userId)
      .eq("stripe_customer_id", existingCustomerId);
    // If the clear failed, the NULL-claim below would lose to the dead id
    // and hand it straight back — surface it instead.
    if (clearError) throw new Error(`Could not clear dead Stripe customer: ${clearError.message}`);
  }

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
    .select("stripe_customer_id, stripe_subscription_id, plan_status, plan_source")
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

  // The Play-billed twin of the guard above (2026-08-31 inspection). A
  // subscription bought in the Android app lives at Google — RevenueCat sets
  // plan_source='play' and stripe_subscription_id stays NULL, so the Stripe
  // guard alone waves the checkout through and the person ends up paying for
  // the SAME plan twice, once to Google and once to Stripe, with no portal
  // that can see both. The checkout page is a URL anyone can type; this is
  // the server saying no.
  if (
    profile?.plan_source === "play" &&
    (profile.plan_status === "active" || profile.plan_status === "past_due")
  ) {
    redirect(
      `/app/settings?tab=usage&error=${encodeURIComponent("Your subscription is billed through Google Play — manage or change it in the Play Store on your phone.")}`,
    );
  }

  const origin = await getOrigin();
  let customerId: string | null = null;

  try {
    customerId = await ensureStripeCustomer(
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
      // REQUIRED alongside automatic_tax when `customer` is a pre-created
      // record (2026-09-03, operator report "wigly gets an error each time
      // it tries to get extra credit or get a plan"): Stripe refuses to open
      // Checkout for a customer with no saved address —
      // customer_tax_location_invalid — unless told to collect the billing
      // address in the form and save it onto the customer. ensureStripeCustomer
      // creates every new customer WITHOUT an address, so since the
      // one-customer rule shipped, every first-time buyer hit this and saw
      // "Couldn't start checkout"; only customers whose record already carried
      // an address (the operator's own, from the pre-rule hosted checkout)
      // could pay. Reproduced against live Stripe with the exact params, and
      // fixed by this one field. name: "auto" rides along so invoices carry
      // the buyer's name.
      customer_update: { address: "auto", name: "auto" },
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
    const failure = await reportCheckoutFailure(
      userData.user.id,
      "checkout",
      `plan ${paidPlanId}/${interval} price=${priceId} customer=${customerId ?? profile?.stripe_customer_id ?? "none"}`,
      err,
    );
    return { url: null, clientSecret: null, failure };
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
  let customerId: string | null = null;

  try {
    customerId = await ensureStripeCustomer(
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
      // Same requirement as startPlanCheckout above — see the comment there.
      customer_update: { address: "auto", name: "auto" },
      // One-time payments create NO invoice by default — a business customer
      // buying a credit pack had nothing proper for their books. This mints a
      // real numbered invoice per pack purchase (2026-08-22, operator:
      // "What about the invoice sent to customers?"); the account-level
      // branding and the Jeartecnica/CIF footer apply to it automatically.
      invoice_creation: { enabled: true },
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
    const failure = await reportCheckoutFailure(
      userData.user.id,
      "checkout",
      `pack ${pack.id} price=${priceId} customer=${customerId ?? profile?.stripe_customer_id ?? "none"}`,
      err,
    );
    return { url: null, clientSecret: null, returnTo, failure };
  }
}
