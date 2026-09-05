-- =====================================================================
-- 2026-09-05  Audit hardening — PENDING, apply to live DB.
--
-- Two fixes from the full-codebase audit, both pure tightenings (no
-- schema changes, no data rewrites) — safe to run before or after the
-- matching deploy, and idempotent.
--
--   1. reward_referral_on_success: restore the referrer row lock that
--      hygiene.sql added and ledger-fixes.sql (the operative final
--      version, with the purchased-credits payout) accidentally dropped
--      by not being rebased on it. Without the lock the 20-per-month
--      referrer ceiling is a read-check-write race: two referred users'
--      first successes landing together both count 19 and both pay.
--
--   2. report_community_post: the 10/min report ceiling lived only in
--      the Next server action — a direct PostgREST rpc call (anon key +
--      the caller's own session JWT, both present in any browser)
--      bypassed it entirely, allowing unbounded inserts into the admin
--      reports queue. Enforced in the function now, with a per-post
--      dedupe on top.
-- =====================================================================

-- 1 ────────────────────────────────────────────────────────────────────
create or replace function public.reward_referral_on_success()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_referred_by uuid;
  v_rewarded_at timestamptz;
  v_rewards_this_month int;
begin
  if new.status <> 'succeeded' then
    return new;
  end if;

  begin
    select referred_by, referral_rewarded_at
      into v_referred_by, v_rewarded_at
      from public.profiles
     where id = new.user_id
       for update;

    if v_referred_by is null or v_rewarded_at is not null then
      return new;
    end if;

    -- Mark first, then pay via the same atomic add the store uses.
    -- purchased_credits DEPLETES when spent — that is the whole fix.
    update public.profiles
       set referral_rewarded_at = now()
     where id = new.user_id;
    perform public.add_purchased_credits(new.user_id, 1);

    -- Serialise concurrent rewards against the same referrer before the
    -- count below — without this the ceiling was advisory under load
    -- (hygiene.sql added this line the same day; ledger-fixes.sql lost it).
    perform 1 from public.profiles where id = v_referred_by for update;

    -- The referrer's +1 keeps the 20-per-month abuse ceiling.
    select count(*)
      into v_rewards_this_month
      from public.profiles
     where referred_by = v_referred_by
       and referral_rewarded_at >= date_trunc('month', now())
       and id <> new.user_id;

    if v_rewards_this_month < 20 then
      perform public.add_purchased_credits(v_referred_by, 1);
    end if;
  exception when others then
    -- Never let a reward failure roll back a paid render (2026-08-31).
    raise warning 'reward_referral_on_success skipped for generation %: % (%)',
      new.id, sqlerrm, sqlstate;
  end;

  return new;
end;
$$;

revoke all on function public.reward_referral_on_success() from anon, authenticated;

-- 2 ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.report_community_post(p_post_id uuid, p_reason text, p_details text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE gid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required.'; END IF;
  IF p_reason NOT IN ('wrong_result', 'inappropriate', 'technical_error', 'other') THEN
    RAISE EXCEPTION 'Pick a reason for the report.';
  END IF;
  SELECT generation_id INTO gid FROM public.community_posts WHERE id = p_post_id;
  IF gid IS NULL THEN RAISE EXCEPTION 'Post not found.'; END IF;

  -- The ceiling the app already advertises, now where it can't be walked
  -- around. Same message the server action's limiter uses, so the client's
  -- error handling doesn't change.
  IF (SELECT count(*)
        FROM public.generation_reports
       WHERE user_id = auth.uid()
         AND created_at > now() - interval '1 minute') >= 10 THEN
    RAISE EXCEPTION 'You''re reporting quickly — give it a moment.';
  END IF;

  -- One report per reporter per post per day: a repeat adds nothing to the
  -- moderation queue but noise. Silent, not an error — their report IS in
  -- the queue, which is the outcome they asked for.
  IF EXISTS (SELECT 1
               FROM public.generation_reports
              WHERE generation_id = gid
                AND user_id = auth.uid()
                AND source = 'community'
                AND created_at > now() - interval '24 hours') THEN
    RETURN;
  END IF;

  INSERT INTO public.generation_reports (generation_id, user_id, reason, details, source)
  VALUES (gid, auth.uid(), p_reason, left(coalesce(p_details, ''), 1000), 'community');
END $$;

REVOKE EXECUTE ON FUNCTION public.report_community_post(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.report_community_post(uuid, text, text) TO authenticated;
