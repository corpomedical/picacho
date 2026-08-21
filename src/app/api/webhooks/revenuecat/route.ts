import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { planForPlayProduct, packForPlayProduct, normalizePlayProductId } from "@/lib/play/products";

// RevenueCat webhook — Google Play Billing's server-side truth, the Play
// counterpart of /api/webhooks/stripe. RevenueCat receives Play's real-time
// developer notifications, normalizes them, and delivers events here;
// renewals, cancellations, refunds and billing issues all arrive as typed
// events with absolute timestamps, so handlers write absolute state and stay
// idempotent under RC's retries (any non-2xx is redelivered, same contract
// as Stripe).
//
// Discipline carried over from the Stripe route:
//  - DB failures return 500 so the event is redelivered — silently acking a
//    failed write would strand a paying customer on the free tier.
//  - Credit grants ride the SAME idempotent RPC (record_credit_purchase),
//    keyed "play:<transaction_id>" in the unique session column, so a
//    redelivered event can never double-grant.
//  - plan_source guards: a Play event never touches a Stripe-owned plan and
//    vice versa — each system resets only what it owns.

type RevenueCatEvent = {
  type?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  product_id?: string;
  new_product_id?: string;
  purchased_at_ms?: number;
  expiration_at_ms?: number | null;
  transaction_id?: string;
  price_in_purchased_currency?: number;
  currency?: string;
  period_type?: string;
};

function isUuid(v: string | undefined): v is string {
  return !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function iso(ms: number | null | undefined): string | null {
  return typeof ms === "number" && ms > 0 ? new Date(ms).toISOString() : null;
}

export async function POST(request: Request) {
  // RC sends a static Authorization header configured in its dashboard —
  // no signature scheme like Stripe's, so the shared secret IS the auth.
  const auth = request.headers.get("authorization");
  const expected = process.env.REVENUECAT_WEBHOOK_AUTH;
  if (!expected || auth !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { event?: RevenueCatEvent };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const event = body.event;
  if (!event?.type) return NextResponse.json({ received: true });

  // The SDK logs in with the Supabase user id, so app_user_id is our uuid.
  // RC anonymous ids ($RCAnonymousID:…) mean a purchase before login — the
  // SDK aliases them to the real id and RC re-sends under it, so skipping
  // here is safe, and loud.
  const userId = isUuid(event.app_user_id)
    ? event.app_user_id
    : isUuid(event.original_app_user_id)
      ? event.original_app_user_id
      : null;
  if (!userId) {
    console.log("RevenueCat webhook: no usable app_user_id", event.type, event.app_user_id);
    return NextResponse.json({ received: true });
  }

  const supabase = createAdminClient();

  try {
    switch (event.type) {
      // Subscription became (or stayed) entitled — write the plan as
      // absolute state. PRODUCT_CHANGE carries the NEW product in
      // new_product_id; everything else uses product_id.
      case "INITIAL_PURCHASE":
      case "RENEWAL":
      case "UNCANCELLATION":
      case "PRODUCT_CHANGE": {
        const productRaw = event.type === "PRODUCT_CHANGE" ? (event.new_product_id ?? event.product_id) : event.product_id;
        if (!productRaw) break;

        const pack = packForPlayProduct(productRaw);
        if (pack) {
          // Consumable pack arriving as INITIAL_PURCHASE — grant below in
          // the shared pack path.
          const ok = await grantPack(supabase, userId, pack.credits, event);
          if (!ok) return NextResponse.json({ received: false }, { status: 500 });
          break;
        }

        const plan = planForPlayProduct(productRaw);
        if (!plan) {
          console.error("RevenueCat webhook: unknown product", productRaw);
          break;
        }
        const { error } = await supabase
          .from("profiles")
          .update({
            plan,
            plan_status: "active",
            plan_source: "play",
            play_product_id: normalizePlayProductId(productRaw),
            plan_interval: "month",
            plan_currency: event.currency?.toLowerCase() ?? null,
            current_period_start: iso(event.purchased_at_ms),
            current_period_end: iso(event.expiration_at_ms),
          })
          .eq("id", userId);
        if (error) {
          console.error("RevenueCat webhook: plan update failed", error.message);
          return NextResponse.json({ received: false }, { status: 500 });
        }
        break;
      }

      // One-time consumable (credit pack).
      case "NON_RENEWING_PURCHASE": {
        const pack = event.product_id ? packForPlayProduct(event.product_id) : null;
        if (!pack) {
          console.error("RevenueCat webhook: non-renewing purchase with no matching pack", event.product_id);
          break;
        }
        const ok = await grantPack(supabase, userId, pack.credits, event);
        if (!ok) return NextResponse.json({ received: false }, { status: 500 });
        break;
      }

      // Auto-renew switched off. Access runs to the period end — EXPIRATION
      // is the event that actually ends it, so entitlement stays untouched
      // here (Stripe's cancel_at_period_end behaves the same way).
      case "CANCELLATION":
        console.log("RevenueCat webhook: cancellation noted (access until expiration)", userId);
        break;

      // Renewal failed and Play is retrying — mirror Stripe's past_due,
      // which pauses the monthly allowance until payment recovers.
      case "BILLING_ISSUE": {
        const { error } = await supabase
          .from("profiles")
          .update({ plan_status: "past_due" })
          .eq("id", userId)
          .eq("plan_source", "play");
        if (error) {
          console.error("RevenueCat webhook: billing-issue update failed", error.message);
          return NextResponse.json({ received: false }, { status: 500 });
        }
        break;
      }

      // Entitlement actually ended. Reset ONLY a Play-owned plan, and only
      // the plan fields — Stripe columns are not this webhook's to touch.
      case "EXPIRATION": {
        const { error } = await supabase
          .from("profiles")
          .update({
            plan: "none",
            plan_status: "canceled",
            plan_source: null,
            play_product_id: null,
            plan_interval: null,
            plan_currency: null,
            current_period_start: null,
            current_period_end: null,
          })
          .eq("id", userId)
          .eq("plan_source", "play");
        if (error) {
          console.error("RevenueCat webhook: expiration reset failed", error.message);
          return NextResponse.json({ received: false }, { status: 500 });
        }
        break;
      }

      // Money went back — for a pack, credits go back too (same rule as the
      // Stripe clawback: refunding must not be strictly better than keeping
      // the purchase). Subscription refunds arrive alongside EXPIRATION,
      // which handles the plan itself.
      case "REFUND": {
        const pack = event.product_id ? packForPlayProduct(event.product_id) : null;
        if (!pack || !event.transaction_id) break;
        const { data: purchase, error: lookupError } = await supabase
          .from("credit_purchases")
          .select("id, refunded_at")
          .eq("stripe_session_id", `play:${event.transaction_id}`)
          .maybeSingle();
        if (lookupError) {
          console.error("RevenueCat webhook: refund lookup failed", lookupError.message);
          return NextResponse.json({ received: false }, { status: 500 });
        }
        if (!purchase || purchase.refunded_at) break;
        const { error } = await supabase.rpc("clawback_credit_purchase", { p_purchase_id: purchase.id });
        if (error) {
          console.error("RevenueCat webhook: clawback failed", error.message);
          return NextResponse.json({ received: false }, { status: 500 });
        }
        break;
      }

      default:
        console.log("RevenueCat webhook: unhandled event type", event.type);
    }
  } catch (err) {
    console.error("RevenueCat webhook: handler crashed", err);
    return NextResponse.json({ received: false }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// Shared consumable grant — the Stripe route's atomic record-and-grant RPC,
// keyed into the same unique column with a "play:" prefix so the two
// billing systems can never collide and a redelivered event never
// double-grants. Returns false when the caller should 500 for a retry.
async function grantPack(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  credits: number,
  event: RevenueCatEvent,
): Promise<boolean> {
  if (!event.transaction_id) {
    console.error("RevenueCat webhook: pack purchase without transaction_id");
    return true; // nothing to key idempotency on; acking beats a retry loop
  }
  const amountCents = Math.round((event.price_in_purchased_currency ?? 0) * 100);
  const { data: granted, error } = await supabase.rpc("record_credit_purchase", {
    p_user_id: userId,
    p_session_id: `play:${event.transaction_id}`,
    p_amount_cents: amountCents,
    p_currency: event.currency?.toLowerCase() ?? "usd",
    p_credits: credits,
  });
  if (error) {
    console.error("RevenueCat webhook: credit grant failed", error.message);
    return false;
  }
  if (granted !== true) {
    console.log("RevenueCat webhook: duplicate pack grant ignored", event.transaction_id);
  }
  return true;
}
