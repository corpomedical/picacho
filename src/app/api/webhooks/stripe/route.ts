import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/client";
import { planIdForPriceId } from "@/lib/stripe/plans";
import { creditsForPriceId } from "@/lib/stripe/credit-packs";
import { createAdminClient } from "@/lib/supabase/server";

// Stripe → us. No user session here (Stripe calls this directly), so the
// signature check below is the only auth — never skip it. Register this
// endpoint in Stripe Dashboard > Developers > Webhooks once deployed, and
// put the signing secret it gives you into STRIPE_WEBHOOK_SECRET.
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

// Subscriptions created through our Checkout flow always carry
// metadata.supabase_user_id (set in createCheckoutSession). This falls back
// to matching on stripe_customer_id for the rare case that's missing.
async function resolveUserId(
  supabase: ReturnType<typeof createAdminClient>,
  metadata: Stripe.Metadata | null | undefined,
  customerId: string | null,
): Promise<string | null> {
  if (metadata?.supabase_user_id) return metadata.supabase_user_id;
  if (!customerId) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .single();
  return data?.id ?? null;
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
      // Fires right after a successful Checkout. Subscription-level details
      // arrive via customer.subscription.created right after this — here we
      // just make sure the new Stripe customer is linked to the profile.
      case "checkout.session.completed": {
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
        // commission is defined against. Best-effort by design: a logging
        // failure must never 500 the webhook and make Stripe retry a
        // checkout that actually succeeded.
        if (session.mode === "subscription" && (session.total_details?.amount_discount ?? 0) > 0) {
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
                    .update({ promo_code: promo.code, referred_by: promo.rep_name })
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
          // stripe_session_id is UNIQUE on credit_purchases, so a webhook
          // Stripe retries — which it does, routinely, on any non-2xx or
          // timeout — can't grant the same credits twice. Insert first and
          // let the constraint decide; checking-then-inserting would leave a
          // race between two concurrent deliveries.
          const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
          const priceId = lineItems.data[0]?.price?.id ?? null;
          const credits = priceId ? creditsForPriceId(priceId) : null;

          if (!credits) {
            console.error("Stripe webhook: paid session has no matching credit pack", session.id, priceId);
            break;
          }

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
          }
        }
        break;
      }

      // The source of truth for plan + billing status — fires on new
      // subscriptions and on every change (upgrade, downgrade, past-due,
      // reactivation) made via the Customer Portal or the Stripe dashboard.
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId =
          typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
        const userId = await resolveUserId(supabase, subscription.metadata, customerId);
        if (!userId) {
          console.error("Stripe webhook: no Picacho user found for subscription", subscription.id);
          break;
        }

        const priceId = subscription.items.data[0]?.price.id;
        // Annual subscriptions use an inline price (no entry in
        // PLAN_PRICE_IDS) — their plan travels in subscription metadata,
        // written by createCheckoutSession. Price mapping stays first so a
        // tampered metadata value can never override a real known price.
        const metadataPlan = ((): ReturnType<typeof planIdForPriceId> => {
          const p = subscription.metadata?.plan;
          return p === "starter" || p === "growth" || p === "studio" || p === "elite"
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

        await supabase
          .from("profiles")
          .update({
            stripe_customer_id: customerId,
            stripe_subscription_id: subscription.id,
            stripe_price_id: priceId ?? null,
            plan_status: statusToPlanStatus(subscription.status),
            current_period_start: currentPeriodStart,
            current_period_end: currentPeriodEnd,
            ...(planId ? { plan: planId } : {}),
          })
          .eq("id", userId);
        break;
      }

      // Subscription fully ended (canceled and the period ran out, or
      // canceled immediately) — drop them back to the free tier.
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId =
          typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
        const userId = await resolveUserId(supabase, subscription.metadata, customerId);
        if (!userId) break;

        await supabase
          .from("profiles")
          .update({
            plan: "none",
            plan_status: "canceled",
            stripe_subscription_id: null,
            stripe_price_id: null,
            current_period_start: null,
            current_period_end: null,
          })
          .eq("id", userId);
        break;
      }

      // Refunding a credit purchase has to take the credits back, or the
      // top-up is free money: buy a pack, spend the credits, refund the
      // charge, repeat. Fine while the only buyer is Wigly; not fine the
      // moment strangers can do it.
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        // A charge doesn't name the Checkout Session, so the purchase is
        // found via the payment intent recorded against it.
        const paymentIntentId =
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : (charge.payment_intent?.id ?? null);
        if (!paymentIntentId) break;

        const sessions = await stripe.checkout.sessions.list({
          payment_intent: paymentIntentId,
          limit: 1,
        });
        const sessionId = sessions.data[0]?.id;
        if (!sessionId) break;

        const { data: purchase } = await supabase
          .from("credit_purchases")
          .select("id, user_id, credits, refunded_at")
          .eq("stripe_session_id", sessionId)
          .single();

        // Not a credit purchase (an ordinary subscription refund), or one
        // already reversed — Stripe re-sends charge.refunded for each
        // partial refund on the same charge, so this has to be idempotent.
        if (!purchase || purchase.refunded_at) break;

        // Only reverse credits on a FULL refund. A partial refund (e.g. a
        // goodwill gesture) used to claw back the ENTIRE pack, stripping a
        // customer of credits they still paid for. On a partial refund we leave
        // the credits untouched; only a full refund reverses the grant.
        const fullyRefunded = charge.refunded === true && charge.amount_refunded >= charge.amount;
        if (!fullyRefunded) {
          console.log("Stripe webhook: partial refund — credits left intact", sessionId);
          break;
        }

        // Atomic, floored decrement (public.decrement_purchased_credits): the
        // credits may already be spent, and a negative balance would read as
        // "owes us credits", so it floors at zero — we eat the cost of whatever
        // was already generated. Atomic so it can't lose a concurrent update.
        await supabase.rpc("decrement_purchased_credits", {
          p_user_id: purchase.user_id,
          p_amount: purchase.credits,
        });

        await supabase
          .from("credit_purchases")
          .update({ refunded_at: new Date().toISOString() })
          .eq("id", purchase.id);

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
