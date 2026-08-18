import Stripe from "stripe";
import { stripe } from "@/lib/stripe/client";

// Winds down everything Stripe knows about a customer when their Picacho
// account is deleted. Called from BOTH deletion paths — admin deleteUser
// (lib/admin/actions.ts) and self-serve deleteAccount (lib/profile/actions.ts)
// — and it must run BEFORE the profile row is removed, while the Stripe ids
// are still readable. Without this, deleting a paying user deleted OUR record
// of the subscription but not the subscription itself: Stripe kept charging a
// card attached to an account that no longer exists — the single worst kind
// of charge to have to explain, and a guaranteed chargeback.
//
// Tolerates already-canceled subscriptions and already-deleted customers
// (deleting twice must be a no-op — a retried deletion, or test data purged
// on Stripe's side), but rethrows anything else. The callers deliberately
// FAIL the whole account deletion when this throws: "account gone,
// subscription still billing" is strictly worse than asking the admin or
// user to try again once Stripe is reachable.

function isMissing(err: unknown): boolean {
  return err instanceof Stripe.errors.StripeError && err.code === "resource_missing";
}

function isCancelable(status: Stripe.Subscription.Status): boolean {
  // The only two states Stripe itself considers terminal — cancel() on
  // either throws, and there's nothing left to stop anyway.
  return status !== "canceled" && status !== "incomplete_expired";
}

async function cancelSubscriptionIfLive(subscriptionId: string): Promise<void> {
  try {
    // Retrieve-then-cancel rather than cancel-and-catch: an "already
    // canceled" cancel() throws a generic invalid_request error with no
    // stable code to match on, so checking the status first is the only
    // tolerant path that doesn't swallow real failures.
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    if (isCancelable(subscription.status)) {
      // cancel(), not update({cancel_at_period_end}): the account is gone
      // NOW, so billing stops now — there is no one left to serve out the
      // period for.
      await stripe.subscriptions.cancel(subscriptionId);
    }
  } catch (err) {
    if (isMissing(err)) return;
    throw err;
  }
}

export async function cancelStripeCustomerBilling(profile: {
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}): Promise<void> {
  // The stored subscription id first — it's the one we know about even if
  // the customer id is somehow missing from the profile.
  if (profile.stripeSubscriptionId) {
    await cancelSubscriptionIfLive(profile.stripeSubscriptionId);
  }

  if (!profile.stripeCustomerId) return;

  try {
    // Belt-and-braces: cancel anything ELSE live on the customer first — a
    // second subscription created by hand in the Stripe dashboard would
    // never be in our profiles row. customers.del below cancels active
    // subscriptions itself, but doing it explicitly keeps the invariant
    // visible and covers every non-terminal status, not just "active".
    const subscriptions = await stripe.subscriptions.list({
      customer: profile.stripeCustomerId,
      status: "all",
      limit: 100,
    });
    for (const subscription of subscriptions.data) {
      if (isCancelable(subscription.status)) {
        await stripe.subscriptions.cancel(subscription.id);
      }
    }

    // Deleting the customer detaches its payment methods too, so nothing
    // can ever charge this person through the dead account again.
    await stripe.customers.del(profile.stripeCustomerId);
  } catch (err) {
    if (isMissing(err)) return;
    throw err;
  }
}
