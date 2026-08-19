-- =====================================================================
-- 2026-08-19  Announcement email system — PENDING, apply to live DB.
--
-- Companion SQL for:
--   src/lib/email/send.ts + render.ts        (Resend client + templates)
--   src/lib/admin/email-actions.ts           (template CRUD, test send, blast)
--   src/app/admin/emails/page.tsx            (admin UI)
--   src/app/api/email/unsubscribe/route.ts   (signed logged-out opt-out)
--
-- Ordering: apply BEFORE deploying the matching app changes — everything
-- fails CLOSED until then (the admin Emails page shows an error banner
-- instead of templates, a blast attempt errors on the missing
-- marketing_opt_out column and sends nothing, the unsubscribe route
-- errors rather than pretending to opt someone out), so deploying first
-- is safe but useless. Nothing sends automatically anywhere: the only
-- two code paths that hand mail to Resend are the two admin actions,
-- and Supabase Auth's own emails are untouched by all of this.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Templates + audit log.
--
-- email_templates is keyed by a human slug (e.g. 'credits-tripled') —
-- that's what the admin actions upsert on and what email_sends refers
-- back to. DELIBERATELY no FK from email_sends.template_key to
-- email_templates.key: the audit log must survive a template being
-- deleted or renamed (same reason promo_redemptions carries plain
-- columns instead of leaning on its FK — history outlives the thing
-- that made it).
--
-- email_sends.recipient_count records recipients Resend ACCEPTED, not
-- the audience size at the time — the truthful number when chunks fail.
-- ---------------------------------------------------------------------
create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  subject text not null,
  body text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.email_sends (
  id uuid primary key default gen_random_uuid(),
  template_key text,
  subject text,
  audience text,
  recipient_count int,
  sent_by uuid,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2) RLS posture: service-role only, on purpose.
--
-- RLS is ENABLED with no policies, and every table grant is revoked from
-- the client-facing roles — belt and braces, the same double lock the
-- credit ledger uses. Neither table has any browser-facing read: the
-- admin Emails page and the two send actions all run requireAdmin()
-- first and then read/write with createAdminClient() (service role),
-- exactly like the rest of the admin-only data. A template body is an
-- email that will be sent AS US to thousands of inboxes — the write
-- path for that must not exist for `authenticated` at all, not merely
-- be policy-guarded.
-- ---------------------------------------------------------------------
alter table public.email_templates enable row level security;
alter table public.email_sends enable row level security;

revoke all on public.email_templates from public, anon, authenticated;
revoke all on public.email_sends from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) Marketing opt-out flag on profiles.
--
-- Set to true by the signed unsubscribe route (service role — the link
-- must work logged out); every blast excludes rows where it's true.
-- Deliberately NOT in the authenticated column grant list (see the
-- 2026-08-18 profiles lockdown at the bottom of schema.sql), so a
-- browser session can't flip it for someone else — and nothing in the
-- app needs it client-writable today. If a Settings toggle is added
-- later, widen the grant then, deliberately.
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists marketing_opt_out boolean not null default false;

-- ---------------------------------------------------------------------
-- 4) Seed template: the credits announcement (2026-08-19 restructure —
-- see the PLAN_LIMITS comment in src/lib/plans.ts for the numbers).
--
-- The old→new figures differ per plan, and template variables are
-- per-recipient, so the copy stays generic ("multiplied") and lets
-- {{credits}} state each reader's OWN new allowance — no template can
-- claim a number that's wrong for the plan reading it. ON CONFLICT DO
-- NOTHING so a re-run never overwrites the operator's edits.
-- ---------------------------------------------------------------------
insert into public.email_templates (key, subject, body)
values (
  'credits-tripled',
  'Your Picacho plan just got 3× bigger',
  'Hi {{username}},

Good news: your monthly credits just multiplied. Same plan, same price — a lot more room to create.

Your {{plan}} plan now includes <b>{{credits}} credits every month</b>. The new allowance is already live on your account, so there is nothing to set up.

More credits means more scenes, more angles, and more finished clips — all locked to the same character you already built.

<a href="https://picacho.io/app">Open Picacho</a> and put them to work.

— The Picacho team'
)
on conflict (key) do nothing;
