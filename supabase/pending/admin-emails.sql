-- Emails sent and received (2026-10-03). Operator: "I need to see emails
-- sent and received. I sent the email but im not sure if it went through."
-- → his picks: on each person AND a Sent & replies list on Admin → Emails;
-- replies come into Picacho with a copy to hello@picacho.ai.
-- Code: src/lib/email/threads.ts, src/app/api/webhooks/resend/route.ts.
--
-- One table: every note an admin writes from the site (direction 'out'),
-- what Resend says happened to it (delivered, opened, bounced…), and every
-- reply that comes back (direction 'in'), threaded under the note it
-- answers. Admins read it; only the server writes it. A person's rows go
-- with their account (ON DELETE CASCADE).
--
-- RUN THIS BEFORE PUSHING THE CODE. Idempotent: a second paste is harmless.
-- Before it runs, notes still send; they just aren't listed.

begin;

create table if not exists public.admin_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  admin_id uuid references public.profiles (id) on delete set null,
  direction text not null check (direction in ('out', 'in')),
  from_email text not null check (char_length(from_email) <= 320),
  to_email text not null check (char_length(to_email) <= 320),
  subject text not null default '' check (char_length(subject) <= 300),
  body text not null default '' check (char_length(body) <= 20000),
  -- Resend's id for the email (sent or received): webhooks find the row by it.
  resend_id text unique,
  -- A reply points at the note it answers.
  reply_to_id uuid references public.admin_emails (id) on delete set null,
  status text not null default 'sending' check (status in (
    'sending', 'sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'received'
  )),
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists admin_emails_user_idx on public.admin_emails (user_id, created_at desc);
create index if not exists admin_emails_recent_idx on public.admin_emails (created_at desc);
alter table public.admin_emails enable row level security;
drop policy if exists "Admins can view admin emails" on public.admin_emails;
create policy "Admins can view admin emails" on public.admin_emails for select to public
  using ((select is_admin() as is_admin));

commit;
