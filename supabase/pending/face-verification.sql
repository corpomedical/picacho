-- Face verification, "Verify it's you" (2026-09-19; lib/faces/).
--
-- A person proves their face on BytePlus's own live-check page, and the
-- photos of the character that is them go into BytePlus's real-person asset
-- library — the one route ByteDance allows a real face into Seedance by.
-- BytePlus's usage rules make the platform keep a record of every consent
-- and delete on withdrawal; these tables are that record and that ledger.
--
-- Run once in the SQL editor. Idempotent — safe to run twice. Nothing here
-- is read until the `face_verification` switch (inserted OFF below) is on,
-- and the code runs without these tables: a missing table reads as "not
-- verified".

-- One row per face check started. The consent record lives on it (BytePlus
-- Usage Rules 2.4: when, which notice, how), so a check can never exist
-- without the consent that allowed it.
create table if not exists public.face_verifications (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users (id) on delete cascade,
  -- the character that is this person, when the check was started
  character_id            uuid references public.character_profiles (id) on delete set null,
  status                  text not null default 'pending'
                          check (status in ('pending', 'verified', 'failed', 'expired', 'withdrawn')),
  consented_at            timestamptz not null,
  consent_notice_version  text not null,
  consent_method          text not null,
  -- our anti-forgery token in the callback address
  state                   text not null unique,
  -- BytePlus's session token (30 minutes) and the person it created
  byted_token             text,
  group_id                text,
  result_code             text,
  error                   text,
  created_at              timestamptz not null default now(),
  completed_at            timestamptz,
  withdrawn_at            timestamptz
);

-- One verified face per account: a verification is the account holder's own
-- (Usage Rules 5.2), never a second person's.
create unique index if not exists face_verifications_one_verified
  on public.face_verifications (user_id) where status = 'verified';
create index if not exists face_verifications_user_idx
  on public.face_verifications (user_id, created_at desc);

-- One row per photo sent to the person's asset group. BytePlus compares each
-- against the verified face; only 'active' ones ever reach a render.
create table if not exists public.face_assets (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  verification_id  uuid not null references public.face_verifications (id) on delete cascade,
  character_id     uuid not null references public.character_profiles (id) on delete cascade,
  photo_path       text not null,
  asset_id         text,
  status           text not null default 'processing'
                   check (status in ('processing', 'active', 'failed', 'removed')),
  error_code       text,
  error_message    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (verification_id, character_id, photo_path)
);
create index if not exists face_assets_character_idx
  on public.face_assets (character_id, status);

-- BytePlus deletions still owed. No foreign key on purpose: a person who
-- deletes their account must still have their face deleted at BytePlus, and
-- the account's rows are gone by then. The daily prune retries these.
create table if not exists public.face_group_deletions (
  group_id      text primary key,
  requested_at  timestamptz not null default now(),
  attempts      integer not null default 0,
  last_error    text
);

alter table public.face_verifications enable row level security;
alter table public.face_assets enable row level security;
alter table public.face_group_deletions enable row level security;

-- People may read their own checks and photos (the panel shows them); every
-- write goes through the server, with the service role.
drop policy if exists "Users read own face verifications" on public.face_verifications;
create policy "Users read own face verifications"
  on public.face_verifications for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users read own face assets" on public.face_assets;
create policy "Users read own face assets"
  on public.face_assets for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.face_verifications from public, anon, authenticated;
revoke all on public.face_assets from public, anon, authenticated;
revoke all on public.face_group_deletions from public, anon, authenticated;
grant select on public.face_verifications to authenticated;
grant select on public.face_assets to authenticated;
grant all on public.face_verifications to service_role;
grant all on public.face_assets to service_role;
grant all on public.face_group_deletions to service_role;

-- The switch, OFF. On: admins see "Verify it's you" on their characters, and
-- a verified character's Seedance renders on the BytePlus direct lane carry
-- its checked photos. Needs BYTEPLUS_ACCESS_KEY_ID / BYTEPLUS_SECRET_ACCESS_KEY.
insert into public.feature_flags (key, enabled, description)
values (
  'face_verification',
  false,
  'Verify it''s you: a live face check on BytePlus lets a person''s own character use Seedance. Admins only while it is proved.'
)
on conflict (key) do nothing;

-- Verify as a signed-in non-admin: select count(*) from face_group_deletions; -> permission denied.
