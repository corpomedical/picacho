-- Press Tour, SQL 8 of the rollout: "Tell me when <network> opens" (the
-- press line's Coming soon column, design A publish-desktop). 2026-09-26.
-- Code: src/lib/press-tour/waitlist.ts (read and write, the service role's),
-- waitlist-actions.ts ("use server"), components/press-tour/press-line.tsx.
--
-- RUN THIS BEFORE PUSHING THE CODE, after press-tour-04-social.sql.
-- Idempotent: a second paste is harmless.
--
-- WHAT IT ADDS
--   press_network_waitlist: one row per person per network they asked to
--   hear about, once, by email, when posting to it opens to them. The
--   switch on the press line starts OFF; turning it on inserts the row,
--   turning it off deletes it. RLS ON, ZERO policies: people never read or
--   write it themselves; the server does it for them with the service
--   role, after checking who they are. Deleted with the account.
--
-- NOTHING HERE SENDS ANYTHING. When a network opens, the operator writes to
-- the people on its list once, then clears the list (the one email the
-- switch promises):
--   select p.email from public.press_network_waitlist w
--     join public.profiles p on p.id = w.user_id where w.network = 'instagram';
--   delete from public.press_network_waitlist where network = 'instagram';

begin;

create table if not exists public.press_network_waitlist (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  network     text not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, network),
  constraint press_network_waitlist_network check (network in ('x', 'tiktok', 'instagram', 'threads'))
);

alter table public.press_network_waitlist enable row level security;
revoke all on table public.press_network_waitlist from public, anon, authenticated;
grant select, insert, delete on table public.press_network_waitlist to service_role;

commit;

-- Verify: raises an error naming anything wrong.
do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'press_network_waitlist' and c.relrowsecurity
  ) then
    raise exception 'press_network_waitlist is missing or its RLS is off';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'press_network_waitlist') then
    raise exception 'press_network_waitlist must have no policies';
  end if;
  if has_table_privilege('anon', 'public.press_network_waitlist', 'SELECT')
     or has_table_privilege('authenticated', 'public.press_network_waitlist', 'SELECT')
     or has_table_privilege('authenticated', 'public.press_network_waitlist', 'INSERT') then
    raise exception 'people can reach press_network_waitlist directly';
  end if;
end $$;

-- One result. Expect 1 row: press_network_waitlist | RLS on | no policies.
select c.relname as name,
       case when c.relrowsecurity then 'RLS on' else 'RLS OFF' end as state,
       coalesce((select string_agg(p.policyname, ', ') from pg_policies p
                  where p.schemaname = 'public' and p.tablename = c.relname), 'no policies') as detail
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'press_network_waitlist';
