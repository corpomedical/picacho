// The buyer's email on a promo sale, erased when their account is deleted
// (2026-09-19).
//
// promo_redemptions is the record of which salesperson brought a paying
// customer in: the code, the rep, the amounts, the rate the sale closed at
// and Stripe's checkout id, written by the Stripe webhook. It outlives the
// account on purpose (user_id is ON DELETE SET NULL, so a rep's commission
// history never loses a sale), but it also carried the email the buyer paid
// with, and nothing removed that. A deleted account's email stayed on the
// sales list for good, while the public deletion page names no such record
// among what is kept.
//
// Erased by account id, so it has to run while the id is still on the row:
// BEFORE the auth delete, whose cascade nulls user_id and leaves nothing to
// find the rows by. Both deletion paths call it after their Play-billing
// guard and before Stripe is touched, and abort on an error, so a failure
// leaves the account exactly as it was. The sale itself stays whole: the
// checkout id still finds the payment in Stripe if a rep ever disputes a
// commission.
//
// Relative imports only and the client passed in: tested with a fake.

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Clears the email on every promo sale of this account. Never throws:
 * answers null once it is done, or what went wrong, for the caller to
 * abort the deletion on.
 */
export async function erasePromoRedemptionEmail(admin: SupabaseClient, userId: string): Promise<string | null> {
  try {
    const { error } = await admin.from("promo_redemptions").update({ user_email: null }).eq("user_id", userId);
    return error ? error.message : null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
