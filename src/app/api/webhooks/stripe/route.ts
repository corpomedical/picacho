import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/client";
import { planIdForPriceId } from "@/lib/stripe/plans";
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
        const planId = priceId ? planIdForPriceId(priceId) : undefined;
        if (priceId && !planId) {
          console.error("Stripe webhook: price has no matching plan in PLAN_PRICE_IDS", priceId);
        }

        await supabase
          .from("profiles")
          .update({
            stripe_customer_id: customerId,
            stripe_subscription_id: subscription.id,
            stripe_price_id: priceId ?? null,
            plan_status: statusToPlanStatus(subscription.status),
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
          })
          .eq("id", userId);
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
