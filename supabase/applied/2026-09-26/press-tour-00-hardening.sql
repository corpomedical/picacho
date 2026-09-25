-- Press Tour, SQL 0 of the rollout: the money half of Cut 0's hardening
-- (2026-09-25; press-tour-synthesis.md §3.4 Cut 0, "re-revoke the bonus RPCs
-- from public"). The products half of Cut 0 (people read products and never
-- write them, and the guard that holds every path under the owner's folder)
-- lives in press-tour-02-products.sql, which needs its new columns first.
--
-- RUN THIS FIRST, before 01 and 02 and before the push. Idempotent: a second
-- paste is harmless.
--
-- WHY. spend_bonus_credits and add_bonus_credits are SECURITY DEFINER: they
-- run as their owner and move profiles.bonus_credits for ANY user id they are
-- handed. applied/2026-09-23/bonus-credits-deplete.sql created both and then
-- revoked them from anon and authenticated only. PostgreSQL grants EXECUTE to
-- PUBLIC when a function is created, and anon and authenticated inherit from
-- PUBLIC, so that revoke took nothing away (the drip_candidates lesson in
-- supabase/README.md, rule 1). While PUBLIC holds EXECUTE, anyone with the
-- site's public anon key can POST /rest/v1/rpc/add_bonus_credits with their
-- own id and any amount, and spend those credits on paid renders; or call
-- spend_bonus_credits against someone else's id and empty their balance.
--
-- The app reaches both through the service role only
-- (src/lib/generations/core.ts consumeBonusCredits, job-runner.ts
-- refundGenerationCosts), so nothing the app does changes here.
--
-- After it runs, `node scripts/verify-db.mjs` probes both with the anon key
-- ("anon key may NOT execute"); each must print ok.

begin;

revoke all on function public.spend_bonus_credits(uuid, integer) from public, anon, authenticated;
revoke all on function public.add_bonus_credits(uuid, integer) from public, anon, authenticated;
grant execute on function public.spend_bonus_credits(uuid, integer) to service_role;
grant execute on function public.add_bonus_credits(uuid, integer) to service_role;

commit;

-- ---------------------------------------------------------------------
-- Verify. Fails loudly, naming what is wrong; changes nothing.
-- ---------------------------------------------------------------------
do $$
declare
  fn text;
  who text;
begin
  foreach fn in array array[
    'public.spend_bonus_credits(uuid, integer)',
    'public.add_bonus_credits(uuid, integer)'
  ] loop
    -- 'public' here is the PUBLIC pseudo-role every role inherits from.
    foreach who in array array['public', 'anon', 'authenticated'] loop
      if has_function_privilege(who, fn, 'EXECUTE') then
        raise exception '% can still execute %', who, fn;
      end if;
    end loop;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception 'service_role cannot execute % (the app spends and refunds bonus credits through it)', fn;
    end if;
  end loop;
end $$;

-- One result (the SQL editor shows only the last one). Expect 2 rows, each
-- "public: no, anon: no, authenticated: no, service_role: yes".
select p.proname as function,
       'public: ' || case when has_function_privilege('public', p.oid, 'EXECUTE') then 'YES' else 'no' end
       || ', anon: ' || case when has_function_privilege('anon', p.oid, 'EXECUTE') then 'YES' else 'no' end
       || ', authenticated: ' || case when has_function_privilege('authenticated', p.oid, 'EXECUTE') then 'YES' else 'no' end
       || ', service_role: ' || case when has_function_privilege('service_role', p.oid, 'EXECUTE') then 'yes' else 'NO' end
         as execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('spend_bonus_credits', 'add_bonus_credits')
order by 1;
