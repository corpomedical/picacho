-- =====================================================================
-- 2026-08-31  Inspection hygiene: three small schema pieces.
--
-- Safe to run any time, before or after the deploy — the code that writes
-- the new column already ships (jsonb_populate_record drops the key until
-- the column exists), and both constraints only tighten behaviour.
-- =====================================================================

-- 1. The chat-attachment paths a send carried, so deleting a generation can
--    finally clean its uploads (they were never recorded anywhere; the
--    bucket only ever grew).
alter table public.generations
  add column if not exists attachments jsonb;

-- 2. The multi-angle duplicate guard becomes a database invariant. The
--    action pre-checks the client-supplied group id with a SELECT, but the
--    seconds between that check and the insert let a replayed request (a
--    retried POST, a double-tap racing the check) reserve a SECOND full
--    batch of the same angles. Unique per user + group + angle: the replay
--    loses deterministically at insert time.
create unique index if not exists generations_angle_group_unique
  on public.generations (user_id, angle_group_id, angle)
  where angle_group_id is not null;

-- 3. The referral trigger's 20-per-month referrer ceiling was a
--    read-check-write with no lock on the REFERRER (the referred user's row
--    is locked, the referrer's is not), so two referred accounts succeeding
--    in the same instant could both read 19 and both award. Lock the
--    referrer's row before counting. Same function as
--    referral-column-type.sql, with only this lock added — re-running that
--    file after this one would undo the lock, so run them in order.
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

    update public.profiles
       set referral_rewarded_at = now(),
           bonus_credits = coalesce(bonus_credits, 0) + 1
     where id = new.user_id;

    -- Serialise concurrent rewards against the same referrer before the
    -- count below — without this the ceiling was advisory under load.
    perform 1 from public.profiles where id = v_referred_by for update;

    select count(*)
      into v_rewards_this_month
      from public.profiles
     where referred_by = v_referred_by
       and referral_rewarded_at >= date_trunc('month', now())
       and id <> new.user_id;

    if v_rewards_this_month < 20 then
      update public.profiles
         set bonus_credits = coalesce(bonus_credits, 0) + 1
       where id = v_referred_by;
    end if;
  exception when others then
    -- Never let a reward failure roll back a paid render.
    raise warning 'reward_referral_on_success skipped for generation %: % (%)',
      new.id, sqlerrm, sqlstate;
  end;

  return new;
end;
$$;

revoke all on function public.reward_referral_on_success() from anon, authenticated;
