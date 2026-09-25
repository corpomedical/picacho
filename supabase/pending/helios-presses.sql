-- Helios: one press, one answer, one charge (2026-09-25).
--
-- Operator, 2026-09-25: "GO ahead" on Cut 1 of the Helios audit, "never
-- charge twice, and films that behave". Chromium, the Android WebView
-- included, silently RESENDS a POST when a reused connection drops before
-- any response headers arrive (the incident is in
-- src/lib/generations/repeat-send.ts, 2026-09-22). A Helios shot or take
-- stays open for 60-280 s, so a resend ran the whole press again: the burst
-- limiter, the look's cutout and sheet, a second frame upload, a second
-- still reserved and charged, a second clip for a take, and more shot rows.
-- The page only ever saw the second answer.
--
-- The page now names each press (a fresh id per Shoot, Take and clip retry,
-- and one per film Render). The server writes this row for the press before
-- anything else happens. A second delivery of the same press meets its
-- primary key, does nothing, and answers with the first delivery's own
-- answer, which is stored here when it finishes (src/lib/sets/press.ts, the
-- only module that names this table).
--
-- RUN THIS BEFORE PUSHING THE CODE. Idempotent: a second paste is harmless.
-- Safe in either order: until it has run every press is served as it was
-- before (untracked), and a press is still never charged twice, because the
-- still's and clip's row ids are made from the press id and the reservation
-- refuses the same id twice. scripts/verify-db.mjs lists the table.
--
-- `result` can quote the person's own words (a brand-rule failure): a row is
-- pruned after a day by the person's next press, deleted with its set, and
-- goes with the account. 'edit' is admitted so Astra's chat edits can use
-- the same ledger later without a second SQL.

create table if not exists public.location_set_presses (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  set_id uuid not null references public.location_sets (id) on delete cascade,
  kind text not null check (kind in ('shot','take','edit')),
  state text not null default 'running' check (state in ('running','done')),
  result jsonb check (result is null or pg_column_size(result) <= 32768),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists location_set_presses_user_created_idx on public.location_set_presses (user_id, created_at);
create index if not exists location_set_presses_set_idx on public.location_set_presses (set_id);
alter table public.location_set_presses enable row level security;
-- no policy: server only
revoke all on public.location_set_presses from public, anon, authenticated;
grant all on public.location_set_presses to service_role;

-- Check: 0 on the first run.
select count(*) as presses from public.location_set_presses;
