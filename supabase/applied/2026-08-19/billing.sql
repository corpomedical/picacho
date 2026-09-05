-- =====================================================================
-- Billing hardening — 2026-08-19 code-review fixes. Idempotent; apply
-- BEFORE deploying the matching app changes:
--
--   * The Stripe webhook (api/webhooks/stripe) now writes plan_currency /
--     plan_interval on every customer.subscription.* event and calls
--     clawback_credit_purchase on charge.refunded / charge.dispute.created.
--     Deployed against a database without these, the webhook 500s and
--     Stripe retries — safe (nothing is lost) but noisy, so apply first.
--   * Admin > Billing selects the two new profiles columns.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Persist the subscription price's own currency and interval.
--
-- Annual subscriptions bill on an INLINE price (price_data in
-- createCheckoutSession) with no entry in PLAN_PRICE_IDS, so
-- currencyForPriceId() couldn't classify them: the MRR report bucketed EUR
-- annual subscribers as USD and valued every annual subscriber at the full
-- monthly rate. The webhook now snapshots currency ("usd"/"eur") and
-- interval ("month"/"year") straight off the subscription's price object,
-- and Admin > Billing reads these instead of guessing from the price id.
-- Nullable on purpose: rows from before this change stay NULL until their
-- subscription's next customer.subscription.updated event backfills them,
-- and the report has a documented fallback for that window.
-- ---------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan_currency text,
  ADD COLUMN IF NOT EXISTS plan_interval text;

-- ---------------------------------------------------------------------
-- 2) Atomic refund/chargeback clawback.
--
-- The webhook used to decrement purchased_credits and THEN mark
-- credit_purchases.refunded_at in two separate statements, ignoring the
-- marker write's error — a crash (or failed marker write) between the two
-- left refunded_at NULL, so Stripe's retry decremented the same purchase
-- again. This does both in ONE transaction, claiming the row with a
-- refunded_at IS NULL guard: exactly one caller ever decrements, and a
-- redelivered charge.refunded / charge.dispute.created is a no-op (returns
-- false). Floors at zero for the same reason decrement_purchased_credits
-- does — the credits may already be spent, and a negative balance would
-- read as "owes us credits".
--
-- SECURITY DEFINER + service_role-only EXECUTE, matching every other
-- balance mutation in supabase/schema.sql: authenticated must never be
-- able to mark its own purchases refunded (or anyone else's).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clawback_credit_purchase(p_purchase_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid;
  v_credits int;
BEGIN
  UPDATE public.credit_purchases SET refunded_at = now()
   WHERE id = p_purchase_id AND refunded_at IS NULL
   RETURNING user_id, credits INTO v_user_id, v_credits;
  IF v_user_id IS NULL THEN
    RETURN false;  -- already clawed back (or no such purchase)
  END IF;
  UPDATE public.profiles
     SET purchased_credits = greatest(0, coalesce(purchased_credits, 0) - v_credits)
   WHERE id = v_user_id;
  RETURN true;
END $$;
REVOKE EXECUTE ON FUNCTION public.clawback_credit_purchase(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clawback_credit_purchase(uuid) TO service_role;
