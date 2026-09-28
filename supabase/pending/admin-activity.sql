-- Admin activity log, admin notes, and the one-click render refund
-- (2026-09-28, operator: "Redesign of the admin app with real functionality
-- and features that every admin needs", then picked "Activity log + credits
-- box" first). Code: src/lib/admin/audit.ts (writes and reads the log),
-- src/lib/admin/actions.ts (every admin action records itself),
-- src/app/admin/activity (the page + CSV), src/app/admin/users/[id] (give or
-- take credits, refund a render, notes, this person's admin changes).
--
-- Run it BEFORE the push. Without it the admin still works: every action
-- does what it did before and logs "admin audit: write failed" to the
-- server log, the Activity page says to run this file, and the three new
-- person-page tools answer that this file hasn't run. Idempotent: a second
-- paste is harmless.

-- 1. The log. Append-only: the trigger below refuses every UPDATE and
--    DELETE, whoever asks (the service role included). No foreign keys on
--    purpose: a line must outlive the account it names, and it holds ids,
--    not emails; the page looks names up when it shows them, so a deleted
--    account reads "deleted account" instead of keeping its address here.
create table if not exists public.admin_actions (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  admin_id uuid,
  action text not null check (char_length(action) between 1 and 60),
  target_type text not null check (char_length(target_type) between 1 and 30),
  target_id text check (char_length(target_id) <= 200),
  subject_user_id uuid,
  before_value text check (char_length(before_value) <= 500),
  after_value text check (char_length(after_value) <= 500),
  reason text check (char_length(reason) <= 500),
  amount integer
);

create index if not exists admin_actions_recent on public.admin_actions (created_at desc);
create index if not exists admin_actions_by_subject on public.admin_actions (subject_user_id, created_at desc)
  where subject_user_id is not null;
-- A render is refunded by hand at most once, even with two admins (or two
-- tabs) pressing Refund at the same moment.
create unique index if not exists admin_actions_one_refund_per_render on public.admin_actions (target_id)
  where action = 'render.refund';

create or replace function public.admin_actions_append_only()
returns trigger
language plpgsql
as $function$
begin
  raise exception 'admin_actions is append-only';
end $function$;

drop trigger if exists admin_actions_append_only on public.admin_actions;
create trigger admin_actions_append_only
  before update or delete on public.admin_actions
  for each row execute function public.admin_actions_append_only();

alter table public.admin_actions enable row level security;
revoke all on table public.admin_actions from anon, authenticated;

-- 2. Admin notes on a person. Only admins see them (service role, no
--    policies). Deleted with the account: they are about that person.
create table if not exists public.admin_user_notes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  admin_id uuid,
  body text not null check (char_length(body) between 1 and 2000)
);

create index if not exists admin_user_notes_by_user on public.admin_user_notes (user_id, created_at desc);

alter table public.admin_user_notes enable row level security;
revoke all on table public.admin_user_notes from anon, authenticated;

-- 3. Refund one render by hand. Gives back everything the render took
--    (monthly + bought + bonus credits) as bonus credits, and writes the
--    log line, in one transaction: the unique index above makes a second
--    refund of the same render fail before anything moves. The render row
--    itself is left as it was: it may have been delivered and billed by the
--    provider, and its spend fields are the record of what it cost.
create or replace function public.admin_refund_render(p_generation_id uuid, p_admin_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid;
  v_amount integer;
  v_before integer;
begin
  select user_id,
         coalesce(credits_used, 0) + coalesce(purchased_credits_used, 0) + coalesce(bonus_credits_used, 0)
    into v_user, v_amount
    from public.generations
   where id = p_generation_id
   for update;
  if v_user is null then
    raise exception 'render not found' using errcode = 'P0002';
  end if;
  if v_amount <= 0 then
    raise exception 'nothing to refund' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.admin_actions where action = 'render.refund' and target_id = p_generation_id::text) then
    raise exception 'already refunded' using errcode = 'P0001';
  end if;

  select coalesce(bonus_credits, 0) into v_before from public.profiles where id = v_user for update;
  update public.profiles set bonus_credits = coalesce(bonus_credits, 0) + v_amount where id = v_user;

  insert into public.admin_actions (admin_id, action, target_type, target_id, subject_user_id, before_value, after_value, reason, amount)
  values (p_admin_id, 'render.refund', 'render', p_generation_id::text, v_user,
          v_before::text, (v_before + v_amount)::text, left(p_reason, 500), v_amount);

  return v_amount;
end $function$;

revoke all on function public.admin_refund_render(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_refund_render(uuid, uuid, text) to service_role;

-- Check (a separate paste): expect four rows, every one true.
-- select 'admin_actions' as object, to_regclass('public.admin_actions') is not null as ok
-- union all select 'admin_user_notes', to_regclass('public.admin_user_notes') is not null
-- union all select 'admin_refund_render', to_regprocedure('public.admin_refund_render(uuid,uuid,text)') is not null
-- union all select 'append-only trigger', exists (select 1 from pg_trigger where tgname = 'admin_actions_append_only');
