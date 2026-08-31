import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/client";
import { planIdForPriceId } from "@/lib/stripe/plans";
import { creditsForPriceId } from "@/lib/stripe/credit-packs";
import { createAdminClient } from "@/lib/supabase/server";
import { notifyAdmins } from "@/lib/push/web-push";

// Stripe → us. No user session here (Stripe calls this directly), so the
// signature check below is the only auth — never skip it. Register this
// endpoint in Stripe Dashboard > Developers > Webhooks once deployed, and
// put the signing secret it gives you into STRIPE_WEBHOOK_SECRET. Make sure
// the endpoint's event list includes everything handled below — notably
// checkout.session.async_payment_succeeded / _failed and
// charge.dispute.created, added 2026-08-19; if the endpoint only subscribes
// to the original events, async payments never grant and chargebacks never
// claw back.
export const runtime = "nodejs";

function statusToPlanStatus(
  status: Stripe.Subscription.Status,
): "active" | "past_due" | "canceled" | "inactive" {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "inactive";
  }
}

// Stripe's own "this thing doesn't exist" error — used to tolerate objects
// that were already deleted/purged on Stripe's side.
function isStripeMissingError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "resource_missing"
  );
}

// Subscriptions created through our Checkout flow always carry
// metadata.supabase_user_id (set in createCheckoutSession). This falls back
// to matching on stripe_customer_id for the rare case that's missing. Also
// returns the profile's STORED stripe_subscription_id, so the subscription
// handlers can refuse events about a subscription that isn't the one this
// profile is actually on (a stale event for a deleted-and-replaced
// subscription must not overwrite the live one's state).
async function resolveProfile(
  supabase: ReturnType<typeof createAdminClient>,
  metadata: Stripe.Metadata | null | undefined,
  customerId: string | null,
): Promise<{ id: string; stripeSubscriptionId: string | null } | null> {
  const query = supabase.from("profiles").select("id, stripe_subscription_id");
  const { data } = metadata?.supabase_user_id
    ? await query.eq("id", metadata.supabase_user_id).single()
    : customerId
      ? await query.eq("stripe_customer_id", customerId).single()
      : { data: null };
  if (!data) return null;
  return { id: data.id, stripeSubscriptionId: data.stripe_subscription_id ?? null };
}

// Drops a profile back to the free tier — the shared endpoint of
// customer.subscription.deleted AND of an update handler discovering the
// subscription is already dead. Throws on failure so the webhook 500s and
// Stripe redelivers; silently acking a failed write here would leave a
// canceled subscriber marked as paying forever.
async function resetProfileToFree(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<void> {
  // Play Billing guard (2026-08-21): if the plan is now OWNED BY PLAY —
  // the user let the Stripe subscription lapse and re-subscribed in the
  // app — a straggling Stripe deletion event must only clear the Stripe
  // columns, not wipe the live Play plan.
  const { data: profile, error: readError } = await supabase
    .from("profiles")
    .select("plan_source")
    .eq("id", userId)
    .single();
  if (readError) throw new Error(`couldn't read profile ${userId} before reset: ${readError.message}`);

  const stripeColumnsOnly = {
    stripe_subscription_id: null,
    stripe_price_id: null,
  };
  const { error } = await supabase
    .from("profiles")
    .update(
      profile?.plan_source === "play"
        ? stripeColumnsOnly
        : {
            plan: "none",
            plan_status: "canceled",
            plan_source: null,
            ...stripeColumnsOnly,
            plan_currency: null,
            plan_interval: null,
            current_period_start: null,
            current_period_end: null,
          },
    )
    .eq("id", userId);
  if (error) throw new Error(`couldn't reset profile ${userId} to free: ${error.message}`);
}

// Finds the credit purchase behind a payment intent and reverses its grant.
// Shared by charge.refunded and charge.dispute.created — a chargeback has to
// take the credits back exactly like a refund does, or disputing the charge
// becomes strictly better than asking for a refund: keep the credits AND get
// the money back. Returns false when the caller should 500 so Stripe retries.
async function clawbackCreditPurchase(
  supabase: ReturnType<typeof createAdminClient>,
  paymentIntentId: string,
): Promise<boolean> {
  // A charge/dispute doesn't name the Checkout Session, so the purchase is
  // found via the payment intent recorded against it.
  const sessions = await stripe.checkout.sessions.list({
    payment_intent: paymentIntentId,
    limit: 1,
  });
  const sessionId = sessions.data[0]?.id;
  if (!sessionId) return true;

  // maybeSingle, and the error is checked BEFORE the null check: with
  // .single() a transient DB failure and "no matching row" both surface as
  // data: null, and treating them alike acks the event (Stripe never
  // redelivers an acked event) — a Supabase blip during a dispute would
  // permanently lose the clawback. A real error must 500 so Stripe retries.
  const { data: purchase, error: lookupError } = await supabase
    .from("credit_purchases")
    .select("id, refunded_at")
    .eq("stripe_session_id", sessionId)
    .maybeSingle();
  if (lookupError) {
    console.error("Stripe webhook: clawback purchase lookup failed", lookupError.message);
    return false;
  }

  // Not a credit purchase (an ordinary subscription refund/dispute), or one
  // already reversed.
  if (!purchase || purchase.refunded_at) return true;

  // Atomic mark-and-decrement (public.clawback_credit_purchase): claims the
  // row with a refunded_at IS NULL guard and decrements the balance in ONE
  // transaction, so a redelivered event can never claw back twice — the old
  // two-step version could crash between decrement and marker (double
  // clawback on retry) and ignored the marker write's error entirely.
  const { data: clawed, error } = await supabase.rpc("clawback_credit_purchase", {
    p_purchase_id: purchase.id,
  });
  if (error) {
    console.error("Stripe webhook: credit clawback failed", error.message);
    return false;
  }
  if (clawed !== true) {
    console.log("Stripe webhook: duplicate clawback ignored", sessionId);
  }
  return true;
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();

  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Missing signature or webhook secret" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabase = createAdminClient();

  try {
    switch (event.type) {
      // "completed" fires right after Checkout finishes — but finishing
      // Checkout is NOT the same as being paid. Delayed-notification methods
      // (SEPA debit, some bank redirects) complete the session with
      // payment_status "unpaid" and only settle days later, arriving as
      // async_payment_succeeded (or _failed, below). Everything money-shaped
      // in this block is therefore gated on payment_status, and the two
      // events share one handler so the paid path can't drift: granting on
      // "completed" alone would mint credits for payments that never clear.
      // Subscription-level details arrive via customer.subscription.created
      // right after this.
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.supabase_user_id ?? session.client_reference_id ?? null;
        const customerId =
          typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null);
        if (userId && customerId) {
          await supabase.from("profiles").update({ stripe_customer_id: customerId }).eq("id", userId);
        }

        // Promo attribution. The session's total_details say whether any
        // discount applied; the discounts array says which promotion code.
        // Recorded for subscriptions only — that's what reps sell and what
        // commission is defined against. Gated on the payment actually
        // existing: "paid", or "no_payment_required" (a trialing
        // subscription — still a real sale, the charge just comes later).
        // An unpaid async session records nothing yet; if the payment lands,
        // async_payment_succeeded re-enters this block and the UNIQUE
        // stripe_session_id keeps it single-count. Best-effort by design: a
        // logging failure must never 500 the webhook and make Stripe retry a
        // checkout that actually succeeded.
        if (
          session.mode === "subscription" &&
          (session.payment_status === "paid" || session.payment_status === "no_payment_required") &&
          (session.total_details?.amount_discount ?? 0) > 0
        ) {
          try {
            const discount = (session.discounts ?? [])[0];
            const promotionCodeId =
              typeof discount?.promotion_code === "string"
                ? discount.promotion_code
                : (discount?.promotion_code?.id ?? null);

            if (promotionCodeId) {
              const { data: promo } = await supabase
                .from("promo_codes")
                .select("id, code, rep_name, commission_percent")
                .eq("stripe_promotion_code_id", promotionCodeId)
                .single();

              if (promo) {
                // stripe_session_id is UNIQUE — same retry-safety pattern as
                // credit_purchases above: a redelivered webhook can't count
                // the same sale (and its commission) twice.
                const { error: redemptionError } = await supabase.from("promo_redemptions").insert({
                  promo_code_id: promo.id,
                  code: promo.code,
                  rep_name: promo.rep_name,
                  // Snapshot, not a live lookup: commission is a fact about
                  // this sale. Editing a rep's rate later must not rewrite
                  // what they were owed on business already closed.
                  commission_percent: promo.commission_percent,
                  user_id: userId,
                  user_email: session.customer_details?.email ?? null,
                  amount_subtotal: session.amount_subtotal ?? 0,
                  amount_total: session.amount_total ?? 0,
                  discount_amount: session.total_details?.amount_discount ?? 0,
                  currency: session.currency ?? "eur",
                  stripe_session_id: session.id,
                });
                if (redemptionError && redemptionError.code !== "23505") {
                  console.error("Stripe webhook: couldn't record promo redemption", redemptionError);
                }
                if (userId && !redemptionError) {
                  await supabase
                    .from("profiles")
                    // promo_rep, NOT referred_by. This used to write a
                    // human name ("Jenny") into the column the referral
                    // trigger reads as a user id, which made that account's
                    // every future render abort its own terminal write —
                    // paid for, billed by fal, and stranded at 'generating'
                    // forever. See pending-2026-08-31/referral-column-type.sql.
                    .update({ promo_code: promo.code, promo_rep: promo.rep_name })
                    .eq("id", userId);
                }
              }
            }
          } catch (err) {
            console.error("Stripe webhook: promo attribution failed", err);
          }
        }

        // A one-time credit top-up rather than a subscription (see
        // createCreditCheckoutSession). Subscriptions are handled by the
        // customer.subscription.* cases below and must not fall through to
        // here, hence the explicit mode check.
        if (session.mode === "payment" && userId) {
          // Only "paid" mints credits. "unpaid" means an async payment still
          // in flight (the grant happens when async_payment_succeeded
          // re-enters this block — or never, if it fails).
          // "no_payment_required" should be impossible for a credit pack
          // (no free packs, no promo codes on this flow), so it deliberately
          // does NOT grant: credits nobody paid for are exactly what this
          // gate exists to prevent. Loud log so a legitimate new zero-cost
          // flow would be noticed, not silently eaten.
          if (session.payment_status !== "paid") {
            console.log(
              "Stripe webhook: credit session not paid — no grant",
              session.id,
              session.payment_status,
            );
            break;
          }

          // stripe_session_id is UNIQUE on credit_purchases, so a webhook
          // Stripe retries — which it does, routinely, on any non-2xx or
          // timeout — can't grant the same credits twice. Insert first and
          // let the constraint decide; checking-then-inserting would leave a
          // race between two concurrent deliveries.
          const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
          const line = lineItems.data[0];
          const priceId = line?.price?.id ?? null;
          const packCredits = priceId ? creditsForPriceId(priceId) : null;

          if (!packCredits) {
            console.error("Stripe webhook: paid session has no matching credit pack", session.id, priceId);
            break;
          }

          // Quantity-aware: Checkout is created with quantity: 1 today, but
          // if adjustable quantities are ever switched on, granting one
          // pack's credits against a multi-pack payment would silently short
          // the customer on money already taken.
          const credits = packCredits * (line?.quantity ?? 1);

          // Atomic record-and-grant (public.record_credit_purchase): inserts the
          // purchase row AND adds the credits in ONE transaction. The old code
          // inserted, then separately read-and-updated the balance — a crash in
          // between left the purchase recorded with no credits, and Stripe's
          // retry hit the unique constraint and skipped the grant forever.
          // Idempotent on stripe_session_id; returns true only on the first grant.
          const { data: granted, error: purchaseError } = await supabase.rpc("record_credit_purchase", {
            p_user_id: userId,
            p_session_id: session.id,
            p_amount_cents: session.amount_total ?? 0,
            p_currency: session.currency ?? "eur",
            p_credits: credits,
          });

          if (purchaseError) {
            // Let Stripe retry — record_credit_purchase is idempotent, so a
            // retry can never double-grant.
            console.error("Stripe webhook: couldn't record credit purchase", purchaseError.message);
            return NextResponse.json({ received: false }, { status: 500 });
          }
          if (granted !== true) {
            console.log("Stripe webhook: duplicate credit purchase ignored", session.id);
          } else {
            // First grant only — a redelivered webhook must not re-notify.
            await notifyAdmins({
              title: "Payment received",
              body: `${((session.amount_total ?? 0) / 100).toFixed(2)} ${(session.currency ?? "eur").toUpperCase()} — ${credits} credits`,
              path: "#money",
            });
          }
        }
        break;
      }

      // The delayed payment behind an already-"completed" session never
      // cleared. Nothing was granted (the payment_status gate above made
      // sure of that), so there is nothing to reverse — logged so a failed
      // top-up can be traced when a customer writes in about it.
      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log(
          "Stripe webhook: async payment failed — nothing was granted",
          session.id,
          session.metadata?.supabase_user_id ?? session.client_reference_id ?? "unknown user",
        );
        break;
      }

      // The source of truth for plan + billing status — fires on new
      // subscriptions and on every change (upgrade, downgrade, past-due,
      // reactivation) made via the Customer Portal or the Stripe dashboard.
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const eventSubscription = event.data.object as Stripe.Subscription;
        const customerId =
          typeof eventSubscription.customer === "string"
            ? eventSubscription.customer
            : eventSubscription.customer.id;
        const profile = await resolveProfile(supabase, eventSubscription.metadata, customerId);
        if (!profile) {
          console.error("Stripe webhook: no Picacho user found for subscription", eventSubscription.id);
          break;
        }
        const userId = profile.id;

        // Only the subscription the profile is actually on may write its
        // state. Without this, an event about some OTHER subscription on the
        // same customer (an old one deleted and replaced, or one created by
        // hand in the dashboard) would overwrite the live subscription's
        // plan and status. A profile with nothing stored yet accepts any —
        // that's the brand-new-subscriber case, before created has landed.
        //
        // But "different id" alone isn't grounds to ignore: the stored
        // subscription can be a DEAD one that hasn't been reset yet (an
        // async-payment checkout leaves an `incomplete` sub stored; the user
        // retries with a card and pays for a NEW sub while the old id still
        // occupies the profile). Ignoring the new sub's events here and then
        // letting the old sub's incomplete_expired reset the profile would
        // leave a paying customer on the free tier until the new sub's next
        // lifecycle event — a month away. So on mismatch, ask Stripe whether
        // the STORED sub is still live: only a live one may veto the event.
        if (profile.stripeSubscriptionId && profile.stripeSubscriptionId !== eventSubscription.id) {
          let storedIsLive = false;
          try {
            const stored = await stripe.subscriptions.retrieve(profile.stripeSubscriptionId);
            storedIsLive = stored.status !== "canceled" && stored.status !== "incomplete_expired";
          } catch (err) {
            // Gone entirely → not live; the event's sub takes over. Any other
            // error → rethrow (500 → retry) rather than guess.
            if (!isStripeMissingError(err)) throw err;
          }
          if (storedIsLive) {
            console.log(
              "Stripe webhook: ignoring event for non-current subscription",
              eventSubscription.id,
              "profile is on",
              profile.stripeSubscriptionId,
            );
            break;
          }
          console.log(
            "Stripe webhook: stored subscription",
            profile.stripeSubscriptionId,
            "is dead — adopting replacement",
            eventSubscription.id,
          );
        }

        // Ordering guard: Stripe retries failed deliveries for days and makes
        // no ordering promise, so a redelivered "updated" (status active) can
        // arrive AFTER "deleted" and resurrect a dead plan. Rather than
        // trusting the event's snapshot, re-fetch the subscription — the API
        // answer is the authoritative CURRENT state, so however stale the
        // event that woke us, what gets written can't be.
        let subscription: Stripe.Subscription;
        try {
          subscription = await stripe.subscriptions.retrieve(eventSubscription.id);
        } catch (err) {
          if (isStripeMissingError(err)) {
            // Gone entirely on Stripe's side — same outcome as deleted.
            await resetProfileToFree(supabase, userId);
            break;
          }
          throw err;
        }
        if (subscription.status === "canceled" || subscription.status === "incomplete_expired") {
          // The event was stale: the subscription has since ended. Apply the
          // CURRENT truth (the same reset the deleted handler does), never
          // the snapshot.
          await resetProfileToFree(supabase, userId);
          break;
        }

        const priceId = subscription.items.data[0]?.price.id;
        // Annual subscriptions use an inline price (no entry in
        // PLAN_PRICE_IDS) — their plan travels in subscription metadata,
        // written by createCheckoutSession. Price mapping stays first so a
        // tampered metadata value can never override a real known price.
        const metadataPlan = ((): ReturnType<typeof planIdForPriceId> => {
          const p = subscription.metadata?.plan;
          return p === "basic" || p === "starter" || p === "growth" || p === "studio" || p === "elite"
            ? p
            : undefined;
        })();
        const planId = (priceId ? planIdForPriceId(priceId) : undefined) ?? metadataPlan;
        if (priceId && !planId) {
          console.error("Stripe webhook: price has no matching plan in PLAN_PRICE_IDS", priceId);
        }

        // Recent API versions moved current_period_start/end off the
        // Subscription object itself and onto each line item (Stripe now
        // lets different items in the same subscription bill on different
        // cycles) — read it from the same item priceId came from, not
        // subscription.current_period_end, which no longer exists here.
        // This is what anchors "resets on <date>" to the customer's real
        // billing date instead of the calendar-month approximation
        // getMonthlyUsage() falls back to when these are null.
        const item = subscription.items.data[0];
        const currentPeriodStart = item ? new Date(item.current_period_start * 1000).toISOString() : null;
        const currentPeriodEnd = item ? new Date(item.current_period_end * 1000).toISOString() : null;

        const { error: profileError } = await supabase
          .from("profiles")
          .update({
            stripe_customer_id: customerId,
            stripe_subscription_id: subscription.id,
            stripe_price_id: priceId ?? null,
            // The price's OWN currency and interval, snapshotted for revenue
            // reporting (Admin > Billing): annual subscriptions bill on an
            // inline price with no entry in PLAN_PRICE_IDS, so
            // currencyForPriceId() can't classify them — before these two
            // columns the MRR report bucketed EUR annual subscribers as USD
            // and valued every annual subscriber at the full monthly rate.
            plan_currency: item?.price.currency ?? null,
            plan_interval: item?.price.recurring?.interval ?? null,
            plan_status: statusToPlanStatus(subscription.status),
            current_period_start: currentPeriodStart,
            current_period_end: currentPeriodEnd,
            // A live Stripe subscription owns the plan — and clears any Play
            // remnant, since Google won't sell a second subscription to
            // someone the app already shows as subscribed (the store UI is
            // hidden for active plans; this is the belt to that suspender).
            plan_source: "stripe",
            play_product_id: null,
            ...(planId ? { plan: planId } : {}),
          })
          .eq("id", userId);
        // Throw (→ 500 → Stripe redelivers) rather than ack a write that
        // didn't happen — a silently dropped status change here is a wrong
        // plan/quota until the NEXT subscription event, which for a healthy
        // subscription is a month away.
        if (profileError) {
          throw new Error(`couldn't update profile ${userId} from subscription: ${profileError.message}`);
        }
        // A brand-new paying subscriber (not the routine updated-event noise)
        // — the one Stripe moment always worth buzzing the operator's phone.
        if (
          event.type === "customer.subscription.created" &&
          planId &&
          (subscription.status === "active" || subscription.status === "trialing")
        ) {
          await notifyAdmins({
            title: "New subscription",
            body: `${planId.charAt(0).toUpperCase() + planId.slice(1)} plan just started`,
            path: "#money",
          });
        }
        break;
      }

      // Subscription fully ended (canceled and the period ran out, or
      // canceled immediately) — drop them back to the free tier.
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId =
          typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
        const profile = await resolveProfile(supabase, subscription.metadata, customerId);
        if (!profile) break;

        // Same non-current-subscription guard as the update handler: a stale
        // "deleted" for a subscription this profile has already REPLACED must
        // not tear down the live one it's now on.
        if (profile.stripeSubscriptionId && profile.stripeSubscriptionId !== subscription.id) {
          console.log(
            "Stripe webhook: ignoring deletion of non-current subscription",
            subscription.id,
            "profile is on",
            profile.stripeSubscriptionId,
          );
          break;
        }

        await resetProfileToFree(supabase, profile.id);
        break;
      }

      // Refunding a credit purchase has to take the credits back, or the
      // top-up is free money: buy a pack, spend the credits, refund the
      // charge, repeat. Fine while the only buyer is Wigly; not fine the
      // moment strangers can do it.
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const paymentIntentId =
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : (charge.payment_intent?.id ?? null);
        if (!paymentIntentId) break;

        // Only reverse credits on a FULL refund. A partial refund (e.g. a
        // goodwill gesture) used to claw back the ENTIRE pack, stripping a
        // customer of credits they still paid for. On a partial refund we leave
        // the credits untouched; only a full refund reverses the grant.
        const fullyRefunded = charge.refunded === true && charge.amount_refunded >= charge.amount;
        if (!fullyRefunded) {
          console.log("Stripe webhook: partial refund — credits left intact", paymentIntentId);
          break;
        }

        const ok = await clawbackCreditPurchase(supabase, paymentIntentId);
        // Let Stripe retry — clawback_credit_purchase is idempotent, so a
        // redelivery can never double-reverse.
        if (!ok) return NextResponse.json({ received: false }, { status: 500 });
        break;
      }

      // A chargeback is a refund the customer forced through their bank —
      // same money gone, so same clawback, or disputing becomes strictly
      // better than asking us for a refund (keep the credits AND the money).
      // No partial-refund carve-out here, unlike charge.refunded: a dispute
      // contests the purchase itself, and the funds are pulled the moment it
      // opens. If we later win the dispute, re-granting is a manual support
      // step — rare enough not to automate yet.
      case "charge.dispute.created": {
        const dispute = event.data.object as Stripe.Dispute;
        const paymentIntentId =
          typeof dispute.payment_intent === "string"
            ? dispute.payment_intent
            : (dispute.payment_intent?.id ?? null);
        if (!paymentIntentId) break;

        const ok = await clawbackCreditPurchase(supabase, paymentIntentId);
        if (!ok) return NextResponse.json({ received: false }, { status: 500 });
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error(`Stripe webhook handler failed for ${event.type}:`, err);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
