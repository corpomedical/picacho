-- Bonus credits become a DEPLETING balance, like purchased credits.
--
-- THE LEAK. checkGenerationAllowance computed the monthly ceiling as
--   limit = PLAN_LIMITS[plan] + bonus_credits
-- while usage was counted from current_period_start. The usage window resets
-- every billing period; the column never did. So a one-time grant of N bonus
-- credits actually granted N credits EVERY MONTH, for the life of the
-- account, and the only way to stop it was to remember to zero the column by
-- hand. core.ts stated the asymmetry in a comment beside the purchased spend
-- without anyone reading it as a bug: "They deplete, unlike bonus_credits."
--
-- AFTER THIS, bonus credits behave exactly like purchased credits: drawn down
-- by a guarded RPC when the generation row is reserved, restored by refunds,
-- and gone until an admin grants more. The plan's own monthly allowance is
-- the only thing that renews.
--
-- SQL-FIRST: paste and confirm this BEFORE pushing the code that calls these
-- RPCs. The code fails CLOSED without it (a missing RPC returns no data,
-- which reads as false, which aborts the spend) — it will not silently run
-- unmetered. Idempotent; a double-paste is harmless.

-- 1. What each generation drew from the bonus balance, so a refund can put
--    back exactly what the row took. Mirrors purchased_credits_used.
--    Rows written before this column exists default to 0, which is correct:
--    nothing was ever spent from the balance under the old scheme.
alter table public.generations
  add column if not exists bonus_credits_used integer not null default 0;

-- 2. Guarded spend. Decrements only when the balance covers it and reports
--    whether it did, so two requests racing each other cannot drive the
--    balance negative or both pass on one stale read. Mirrors
--    spend_purchased_credits exactly.
create or replace function public.spend_bonus_credits(p_user_id uuid, p_amount integer)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare updated int;
begin
  if p_amount is null or p_amount <= 0 then return true; end if;
  update public.profiles
     set bonus_credits = bonus_credits - p_amount
   where id = p_user_id and coalesce(bonus_credits,0) >= p_amount;
  get diagnostics updated = row_count;
  return updated > 0;
end $function$;

-- 3. Atomic restore for refunds. Mirrors add_purchased_credits — a
--    read-then-write here would race a concurrent spend and lose one of them.
create or replace function public.add_bonus_credits(p_user_id uuid, p_amount integer)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update public.profiles
     set bonus_credits = coalesce(bonus_credits,0) + p_amount
   where id = p_user_id and p_amount <> 0;
$function$;

-- 4. bonus_credits is a money column: only the service role may move it.
--    Same posture as reward_referral_on_success and record_agent_units.
revoke all on function public.spend_bonus_credits(uuid, integer) from anon, authenticated;
revoke all on function public.add_bonus_credits(uuid, integer) from anon, authenticated;
