-- =====================================================================
-- 2026-09-05  Email truth — PENDING, apply to live DB.
--
-- Round-two audit, two findings with one root: the address a blast
-- sends to and the consent state it requires both live in auth.users,
-- but the blast read profiles.email (written once at signup, never
-- synced after an email change) and never checked email_confirmed_at
-- at all — so marketing went to unconfirmed strangers' addresses, and
-- service notices went to abandoned pre-change addresses.
--
-- RUN BEFORE the matching deploy lands: sendEmailBlast now FAILS CLOSED
-- with a pointer at this file until the function below exists.
-- =====================================================================

-- 1 ── The one lookup a blast needs: confirmed, CURRENT addresses ─────
-- Service definer: auth.users is not reachable through PostgREST
-- otherwise. Takes the already-filtered audience (profiles-side rules:
-- status, opt-out, plan) and returns only members whose address is
-- confirmed — at whatever address auth currently holds.
create or replace function public.blast_recipient_emails(p_user_ids uuid[])
returns table (id uuid, email text)
language sql security definer set search_path = public as $$
  select u.id, u.email::text
    from auth.users u
   where u.id = any(p_user_ids)
     and u.email_confirmed_at is not null
     and u.email is not null;
$$;

revoke execute on function public.blast_recipient_emails(uuid[]) from public, anon, authenticated;
grant execute on function public.blast_recipient_emails(uuid[]) to service_role;

-- 2 ── Keep profiles.email true from now on ───────────────────────────
-- handle_new_user writes it once, AFTER INSERT; nothing fired on the
-- email-change flow (supabase.auth.updateUser rewrites auth.users.email
-- after double opt-in), so every other reader of profiles.email drifted.
create or replace function public.sync_profile_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;

drop trigger if exists on_auth_user_email_change on auth.users;
create trigger on_auth_user_email_change
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.sync_profile_email();

-- 3 ── Heal the rows that already drifted ─────────────────────────────
update public.profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id
   and p.email is distinct from u.email::text;
