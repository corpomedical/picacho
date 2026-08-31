-- =====================================================================
-- 2026-08-31  Ledger audit fixes: the Basic tier can actually be bought,
-- and the referral reward becomes what the site says it is.
--
-- RUN BEFORE ANY BASIC MARKETING. Verified against production during the
-- 2026-08-31 ledger audit:
--
-- 1. profiles.plan's CHECK constraint predates the Basic tier and rejects
--    'basic'. The site sells Basic today (live Stripe prices, Play
--    sub_basic). The first buyer would be billed while the webhook's
--    UPDATE hits the constraint and 500s — and Stripe redelivers into the
--    same wall forever: paid, plan stays 'none', no billing anchor, and
--    even admin comping fails on the same constraint. Zero Basic
--    subscribers exist yet (checked against Stripe, both price ids, all
--    statuses), so this fires on the FIRST sale. 'elite' needed this exact
--    migration in August; 'basic' never got one.
--
-- 2. The referral reward paid into bonus_credits — which core.ts treats as
--    a MONTHLY allowance raiser that never depletes. "You both get 1 bonus
--    credit" was actually +1 credit per month, forever, per referral:
--    rate-capped at 20/month of growth but unbounded in total, farmable
--    with disposable emails, and it silently DOWNGRADED free referrers —
--    any bonus_credits > 0 switches a free account off its 1-per-day lane
--    onto a "1 per month" allowance. Paying into purchased_credits instead
--    makes it one-time and depleting (matching the promise), keeps the
--    referred account's daily free render, and free accounts can spend
--    purchased credits by design. bonus_credits stays what it was built
--    for: admin comps.
--
--    Nothing has accrued yet (0 referred profiles), so there is nothing to
--    unwind — this only changes what future rewards pay.
-- =====================================================================

-- 1. Basic joins the plan enum.
alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles add constraint profiles_plan_check
  check (plan in ('none', 'basic', 'starter', 'growth', 'studio', 'elite'));

-- 2. Referral rewards become one-time purchased credits.
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
