-- =====================================================================
-- 2026-08-31  URGENT. profiles.referred_by is TEXT in production while the
-- referral reward trigger treats it as a uuid. The first referral signup or
-- the first promo-code sale will permanently break that account's renders.
--
-- RUN THIS BEFORE ANYONE REDEEMS JENNY20 OR JAD10.
--
-- WHAT IS WRONG, verified against production on 2026-08-31:
--
--   profiles.id           uuid
--   profiles.referred_by  TEXT      <- not uuid
--
-- pending-2026-08-21/referrals.sql tried to create it with
--   ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES profiles(id)
-- but the column ALREADY EXISTED as text, created earlier by the promo-code
-- feature to hold a sales rep's NAME. IF NOT EXISTS made that a silent
-- no-op: no type change, no foreign key. One column, two meanings.
--
-- The trigger reward_referral_on_success declares `v_referred_by uuid` and
-- then runs `WHERE referred_by = v_referred_by`. Postgres has no text = uuid
-- operator and will not coerce, so that raises and ABORTS THE ENCLOSING
-- UPDATE — which is the statement that marks a generation 'succeeded'.
--
-- The damage that causes, per affected account, forever:
--   - fal has already rendered and billed the video
--   - the credit is already spent
--   - the terminal write rolls back, so the row sits at 'generating'
--   - job-runner keeps the job row, so no sweep ever writes it off
--   - referral_rewarded_at can never commit, so EVERY later render by that
--     account fails exactly the same way
--
-- Two live paths arm it. auth/actions.ts writes a real uuid on referral
-- signup (fails at the comparison). The Stripe webhook writes a rep's NAME
-- (fails even earlier, at SELECT ... INTO a uuid variable). Both JENNY20
-- and JAD10 are ACTIVE with Stripe coupons attached.
--
-- It has never fired: 0 profiles have referred_by set and 0 generations are
-- stuck. This is a fix before the fact, not a cleanup after it.
-- =====================================================================

-- 1. Give the promo rep its own column. One column cannot be both a foreign
--    key to a user and a free-text human name.
alter table public.profiles
  add column if not exists promo_rep text;

-- Move any rep names that are already there. (Expected to move zero rows
-- today; written so it is correct whenever this is run.)
update public.profiles
   set promo_rep = referred_by
 where referred_by is not null
   and referred_by !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

-- 2. Clear anything left that is not a uuid, so the cast below cannot fail.
update public.profiles
   set referred_by = null
 where referred_by is not null
   and referred_by !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

-- 3. Make the column what every reader already assumed it was.
alter table public.profiles
  alter column referred_by type uuid using nullif(referred_by, '')::uuid;

-- The foreign key and index referrals.sql intended, now that the type allows
-- them. Guarded so re-running is safe.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_referred_by_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_referred_by_fkey
      foreign key (referred_by) references public.profiles (id) on delete set null;
  end if;
end $$;

create index if not exists profiles_referred_by_idx on public.profiles (referred_by);

-- 4. A REWARD TRIGGER MUST NEVER BE ABLE TO BREAK THE THING IT WATCHES.
--
-- Even with the types fixed, this function runs inside the UPDATE that marks
-- a paid render succeeded. Any future error in it — a renamed column, a
-- constraint, a deadlock — would roll that write back and strand a render
-- the user has paid for and fal has already billed. A missed +1 credit is a
-- rounding error; a stranded paid render is not.
--
-- So the whole body is now wrapped: if anything at all goes wrong, the
-- reward is skipped, a warning is logged, and the generation still lands.
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

    -- Mark first, unconditionally — the referred side's +1 always pays (they
    -- earned it by actually using the product), and the marker is what makes
    -- every later success a no-op.
    update public.profiles
       set referral_rewarded_at = now(),
           bonus_credits = coalesce(bonus_credits, 0) + 1
     where id = new.user_id;

    -- The referrer's +1 is capped at 20 rewarded referrals per calendar month
    -- — an abuse ceiling, not a growth ceiling.
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
