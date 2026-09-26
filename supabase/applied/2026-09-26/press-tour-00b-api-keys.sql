-- Press Tour, SQL 0b of the rollout: people stop writing api_keys with their
-- own session (2026-09-25; press-tour-critique.md #3, MCP fix #6;
-- press-tour-synthesis.md §3.4 Cut 0).
--
-- PASTE THIS AFTER THE CUT 0 PUSH IS LIVE, never before. Until that push,
-- Settings revokes a key with the person's own client, which is exactly the
-- write this file takes away: pasted early, "Revoke" would answer done and
-- change nothing. After the push, revoking goes through the service role
-- (src/lib/api/keys.ts revokeOwnApiKey), creating goes through
-- create_api_key_capped (service role), and last_used_at is written by the
-- API's own service-role client. Nothing the app does needs these policies.
--
-- Idempotent: a second paste is harmless.
--
-- WHY. schema.sql still carries two policies from the first API cut:
--   "Insert own api keys"  (INSERT, with check auth.uid() = user_id)
--   "Update own api keys"  (UPDATE, using and with check auth.uid() = user_id)
-- and the table-level grants give anon and authenticated every privilege.
-- With both policies live, a person can, with their own JWT:
--   PATCH /rest/v1/api_keys?id=eq.<id>  {"revoked_at": null}
-- and a key they revoked because it leaked authenticates again for /api/mcp
-- and /api/v1; or INSERT rows past the 5-key cap create_api_key_capped holds.
--
-- Reading stays as it is: people read their own keys ("Read own api keys or
-- admin reads all") and admins read all ("Admins can view all api keys").

begin;

drop policy if exists "Insert own api keys" on public.api_keys;
drop policy if exists "Update own api keys" on public.api_keys;

revoke insert, update, delete, truncate, references, trigger on public.api_keys from public, anon, authenticated;
revoke select on public.api_keys from public, anon;
grant select on public.api_keys to authenticated;
grant all on public.api_keys to service_role;

commit;

-- ---------------------------------------------------------------------
-- Verify. Fails loudly, naming what is wrong; changes nothing.
-- ---------------------------------------------------------------------
do $$
declare
  bad text;
  who text;
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'api_keys' and c.relrowsecurity
  ) then
    raise exception 'RLS is not on for public.api_keys';
  end if;

  select string_agg(format('%s (%s)', policyname, cmd), '; ') into bad
  from pg_policies
  where schemaname = 'public' and tablename = 'api_keys' and cmd <> 'SELECT';
  if bad is not null then
    raise exception 'public.api_keys still has a policy that writes: %', bad;
  end if;

  foreach who in array array['public', 'anon', 'authenticated'] loop
    if has_table_privilege(who, 'public.api_keys', 'INSERT, UPDATE, DELETE, TRUNCATE') then
      raise exception '% can still write public.api_keys', who;
    end if;
  end loop;

  if not has_table_privilege('authenticated', 'public.api_keys', 'SELECT') then
    raise exception 'authenticated cannot read public.api_keys (Settings lists a person''s own keys with it)';
  end if;
  if not has_table_privilege('service_role', 'public.api_keys', 'INSERT, UPDATE, SELECT') then
    raise exception 'service_role cannot write public.api_keys (revoking and last_used_at go through it)';
  end if;
end $$;

-- One result (the SQL editor shows only the last one). Expect only SELECT
-- policies: "Admins can view all api keys" and "Read own api keys or admin
-- reads all".
select policyname, cmd, array_to_string(roles, ',') as roles
from pg_policies
where schemaname = 'public' and tablename = 'api_keys'
order by policyname;
