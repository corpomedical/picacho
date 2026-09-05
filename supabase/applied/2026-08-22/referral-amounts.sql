-- =====================================================================
-- 2026-08-22  Referral amounts: 5 + 5 → 1 + 1 (operator decision — the
-- 2026-08-19 credits restructure made 5 credits ≈ five full renders per
-- referral, which is richer than intended; 1 + 1 keeps the give-get
-- framing at a sane cost).
--
-- Everything else is unchanged and deliberate: the reward still fires on
-- the referred account's FIRST SUCCESSFUL RENDER (never at registration —
-- signup-time rewards are farmable for free with disposable inboxes; a
-- real render costs a farmer provider money first), the referred side
-- always pays, the referrer stays behind the 20-rewards-per-month abuse
-- ceiling, and the row lock + referral_rewarded_at marker keep the payout
-- exactly-once under concurrency. Function body identical to
-- pending-2026-08-21/referrals.sql except the two amounts.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.reward_referral_on_success()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_referred_by uuid;
  v_rewarded_at timestamptz;
  v_rewards_this_month int;
BEGIN
  IF NEW.status <> 'succeeded' THEN
    RETURN NEW;
  END IF;

  SELECT referred_by, referral_rewarded_at
    INTO v_referred_by, v_rewarded_at
    FROM public.profiles
   WHERE id = NEW.user_id
     FOR UPDATE;

  IF v_referred_by IS NULL OR v_rewarded_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Mark first, unconditionally — the referred side's +1 always pays (they
  -- earned it by actually using the product), and the marker is what makes
  -- every later success a no-op.
  UPDATE public.profiles
     SET referral_rewarded_at = now(),
         bonus_credits = COALESCE(bonus_credits, 0) + 1
   WHERE id = NEW.user_id;

  -- The referrer's +1 is capped at 20 rewarded referrals per calendar month
  -- — an abuse ceiling, not a growth ceiling; legitimate referrers rarely
  -- brush it and the cap resets monthly.
  SELECT count(*)
    INTO v_rewards_this_month
    FROM public.profiles
   WHERE referred_by = v_referred_by
     AND referral_rewarded_at >= date_trunc('month', now())
     AND id <> NEW.user_id;

  IF v_rewards_this_month < 20 THEN
    UPDATE public.profiles
       SET bonus_credits = COALESCE(bonus_credits, 0) + 1
     WHERE id = v_referred_by;
  END IF;

  RETURN NEW;
END;
$$;

-- CREATE OR REPLACE preserves the original ACL, but re-state the lockdown
-- explicitly so the function is never directly callable by a session even
-- if this file is ever applied to a fresh database: only the trigger runs it.
REVOKE ALL ON FUNCTION public.reward_referral_on_success() FROM anon, authenticated;
