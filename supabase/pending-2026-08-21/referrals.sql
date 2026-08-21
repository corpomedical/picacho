-- Referral loop (2026-08-21). Run in the Supabase SQL editor.
--
-- Give 5, get 5: a referred signup earns BOTH sides 5 bonus credits when the
-- referred account produces its FIRST successful generation — not at signup,
-- which would be free to farm; a real render costs real provider money and
-- proves a human. The whole reward lives in ONE database trigger so every
-- success path (image action, video job-runner, any future one) pays exactly
-- once, atomically, with no app code to forget.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS referral_rewarded_at timestamptz;

CREATE INDEX IF NOT EXISTS profiles_referred_by_idx
  ON public.profiles (referred_by)
  WHERE referred_by IS NOT NULL;

-- Trigger body. SECURITY DEFINER with a pinned search_path (house rule for
-- definer functions); the row lock on the referred profile makes two
-- simultaneously-succeeding generations pay once, not twice.
CREATE OR REPLACE FUNCTION public.reward_referral_on_success()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Mark first, unconditionally — the referred side's +5 always pays (they
  -- earned it by actually using the product), and the marker is what makes
  -- every later success a no-op.
  UPDATE public.profiles
     SET referral_rewarded_at = now(),
         bonus_credits = COALESCE(bonus_credits, 0) + 5
   WHERE id = NEW.user_id;

  -- The referrer's +5 is capped at 20 rewarded referrals per calendar month
  -- (100 credits) — an abuse ceiling, not a growth ceiling; legitimate
  -- referrers rarely brush it and the cap resets monthly.
  SELECT count(*)
    INTO v_rewards_this_month
    FROM public.profiles
   WHERE referred_by = v_referred_by
     AND referral_rewarded_at >= date_trunc('month', now())
     AND id <> NEW.user_id;

  IF v_rewards_this_month < 20 THEN
    UPDATE public.profiles
       SET bonus_credits = COALESCE(bonus_credits, 0) + 5
     WHERE id = v_referred_by;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reward_referral_on_success ON public.generations;
CREATE TRIGGER reward_referral_on_success
  AFTER INSERT OR UPDATE OF status ON public.generations
  FOR EACH ROW
  EXECUTE FUNCTION public.reward_referral_on_success();

-- Lock the function down: only the trigger should run it.
REVOKE ALL ON FUNCTION public.reward_referral_on_success() FROM anon, authenticated;
