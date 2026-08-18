-- Picacho database schema
-- Regenerated from the live Supabase project (kmarkbifjwjhkkifvedb) on
-- 2026-08-05 by introspecting the real, currently-applied schema — the
-- previous version of this file only reflected the first migration and had
-- drifted badly out of date (missing feature_flags, app_settings, projects,
-- notes, page_views entirely, plus several columns added to profiles and
-- generations later). This file is a snapshot for review purposes; the
-- source of truth is always the Supabase project itself. Applied migrations,
-- in order, are listed at the bottom of this file.

-- =====================================================================
-- 1. PROFILES
-- Supabase Auth already has a built-in `auth.users` table (email, password,
-- login history). We add one row per user here to hold app-specific fields
-- (role, plan, username, self-reported details) that auth.users has no room
-- for.
-- =====================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  plan text not null default 'none' check (plan in ('none', 'starter', 'growth', 'studio', 'elite')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  username text not null,
  company text,
  gender text,
  last_seen_at timestamptz,
  terms_accepted_at timestamptz
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Admins can view/manage every profile (used by the /admin area).
create policy "Admins can view all profiles"
  on public.profiles for select
  using (is_admin());

create policy "Admins can update all profiles"
  on public.profiles for update
  using (is_admin());

-- Checks the caller's own role — safe to call from any signed-in session,
-- since it only ever answers "is the current user an admin?", never anyone
-- else's. SECURITY DEFINER is required so it can read profiles.role without
-- being blocked by the RLS policies above (which is what it's used to
-- enforce in the first place).
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Auto-create a profile row whenever someone signs up. The username is
-- derived from the email's local part (lowercased, non [a-z0-9_] characters
-- replaced with "_") as a starting point — the user can change it later in
-- Settings.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, username)
  values (
    new.id,
    new.email,
    regexp_replace(lower(split_part(new.email, '@', 1)), '[^a-z0-9_]', '_', 'g')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- =====================================================================
-- 2. PROJECTS
-- Optional folders a user can group characters under. Deleting a project
-- does NOT delete the characters in it (see ON DELETE SET NULL below) —
-- nothing a user built gets wiped out by deleting the folder around it.
-- =====================================================================
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_starred boolean not null default false,
  is_pinned boolean not null default false,
  is_archived boolean not null default false
);

alter table public.projects enable row level security;

create policy "Users manage their own projects"
  on public.projects for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Admins can view all projects"
  on public.projects for select
  using (is_admin());

-- =====================================================================
-- 3. CHARACTER PROFILES
-- A user defines a character once (name, reference images, traits, motion
-- style, voice/tone) and it's reused on every generation.
-- =====================================================================
create table if not exists public.character_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  reference_image_urls text[] not null default '{}',
  traits jsonb not null default '{}',
  motion_style text,
  voice_tone_tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  project_id uuid references public.projects (id) on delete set null
  -- voice_id added below in section 9, after voice_presets exists
);

alter table public.character_profiles enable row level security;

create policy "Users manage their own character profiles"
  on public.character_profiles for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Admins can view all character profiles"
  on public.character_profiles for select
  using (is_admin());

-- =====================================================================
-- 4. GENERATIONS
-- One row per generation attempt-group. `pipeline_log` stores every attempt
-- (draft/review/generate/validate + pass/fail) so the UI can compute
-- first-try success rate and average attempts. A row is written with status
-- "generating" the moment a request starts (not just when it finishes), so
-- a crash or timeout partway through always leaves a record instead of
-- vanishing without a trace.
-- =====================================================================
create table if not exists public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  character_profile_id uuid references public.character_profiles (id) on delete set null,
  prompt_input text not null,
  status text not null default 'drafted'
    check (status in ('drafted', 'reviewed', 'generating', 'validated', 'succeeded', 'failed')),
  attempts int not null default 0,
  result_url text,
  pipeline_log jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  content_type text not null default 'video' check (content_type in ('video', 'image')),
  angle_group_id uuid,
  angle text
);

alter table public.generations enable row level security;

create policy "Users manage their own generations"
  on public.generations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Admins can view all generations"
  on public.generations for select
  using (is_admin());

-- =====================================================================
-- 5. NOTES ("Picacho Notebook")
-- Freeform notes, unrelated to any specific character/project.
-- =====================================================================
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Untitled note',
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notes enable row level security;

create policy "Users manage their own notes"
  on public.notes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Admins can view all notes"
  on public.notes for select
  using (is_admin());

-- =====================================================================
-- 6. FEATURE FLAGS
-- Admin-togglable switches (e.g. "real_ai_providers"). Readable by any
-- signed-in user (the app needs to check flags client-side in a few spots),
-- but only admins can change them. Not readable by logged-out visitors —
-- this used to be public and leaked which AI models were active.
-- =====================================================================
create table if not exists public.feature_flags (
  key text primary key,
  enabled boolean not null default false,
  description text,
  updated_at timestamptz not null default now()
);

alter table public.feature_flags enable row level security;

create policy "Authenticated users can read feature flags"
  on public.feature_flags for select
  to authenticated
  using (true);

create policy "Admins can insert feature flags"
  on public.feature_flags for insert
  with check (is_admin());

create policy "Admins can update feature flags"
  on public.feature_flags for update
  using (is_admin());

-- =====================================================================
-- 7. APP SETTINGS
-- Admin-editable config values (active video/image model, max retry
-- attempts, support email, etc). Same read/write split as feature_flags.
-- =====================================================================
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  description text,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

create policy "Authenticated users can read app settings"
  on public.app_settings for select
  to authenticated
  using (true);

create policy "Admins can update app settings"
  on public.app_settings for update
  using (is_admin());

-- =====================================================================
-- 8. PAGE VIEWS
-- Lightweight, anonymized-by-default traffic log powering Admin > Stats.
-- Anyone (including logged-out visitors) can insert their own view; only
-- admins can read the table back.
-- =====================================================================
create table if not exists public.page_views (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  visitor_id text not null,
  user_id uuid references public.profiles (id) on delete set null,
  country text,
  referrer text,
  created_at timestamptz not null default now()
);

alter table public.page_views enable row level security;

create policy "Anyone can log a page view"
  on public.page_views for insert
  to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

create policy "Admins can view page views"
  on public.page_views for select
  using (is_admin());

-- =====================================================================
-- 9. VOICE PRESETS
-- Curated ElevenLabs voices for character dialogue (lip-synced speech via
-- fal.ai's ElevenLabs TTS + Sync Labs lipsync endpoints). Admin-managed
-- rather than hardcoded in app code: ElevenLabs' legacy named "Default
-- voices" (Rachel, Bella, Antoni, etc.) are being retired on Dec 31 2026, so
-- baking any of those names into the app would break by year end. Instead
-- an admin picks/previews real, permanent voice_ids from their own
-- ElevenLabs/fal.ai account and enters them here — same read/write split as
-- feature_flags and app_settings.
-- =====================================================================
create table if not exists public.voice_presets (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  description text,
  elevenlabs_voice_id text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.voice_presets enable row level security;

create policy "Authenticated users can read voice presets"
  on public.voice_presets for select
  to authenticated
  using (true);

create policy "Admins can insert voice presets"
  on public.voice_presets for insert
  with check (is_admin());

create policy "Admins can update voice presets"
  on public.voice_presets for update
  using (is_admin());

create policy "Admins can delete voice presets"
  on public.voice_presets for delete
  using (is_admin());

-- Each character can be assigned one voice for dialogue lines. Nullable —
-- most existing characters won't have one set, and dialogue stays opt-in
-- until a voice is picked.
alter table public.character_profiles
  add column if not exists voice_id uuid references public.voice_presets (id) on delete set null;

-- =====================================================================
-- STORAGE BUCKETS
-- All three buckets are private (not public); access is per-user via the
-- `${auth.uid()}/...` path prefix convention enforced by the policies
-- below. Files are removed from these buckets when their owning character
-- or account is deleted (see src/lib/characters/actions.ts and
-- src/lib/profile/actions.ts) — they are NOT automatically cleaned up by
-- Postgres foreign keys, since Storage is a separate subsystem.
--
--   character-references  — character reference photos
--   generated-images      — AI-generated scene images
--   chat-attachments      — files attached in the Generate composer
-- =====================================================================

create policy "Users can upload their own reference images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'character-references' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can view their own reference images"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'character-references' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can update their own reference images"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'character-references' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete their own reference images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'character-references' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can manage their own generated images"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'generated-images' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'generated-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can manage their own chat attachments"
  on storage.objects for all
  using (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

-- =====================================================================
-- Applied migrations, in order (see `supabase/migrations/` for the actual
-- SQL run for each — this file is a point-in-time snapshot, not a replay
-- log):
--
--   20260804024326  init_schema
--   20260804024522  harden_handle_new_user
--   20260804025051  character_reference_storage
--   20260804032222  fix_recursive_admin_policies
--   20260804113504  feature_flags
--   20260804114336  app_settings
--   20260804120225  video_model_setting
--   20260804123453  image_generation_support
--   20260804123548  generated_images_storage
--   20260804134304  projects_table
--   20260804143144  project_organization_flags
--   20260804171802  notebook_notes_table
--   20260804172941  chat_attachments_bucket
--   20260804174548  profiles_username
--   20260804191033  profiles_selfreport_and_presence
--   20260804191042  page_views_table
--   20260804201425  add_angle_group_to_generations
--   20260805015248  add_terms_accepted_at_to_profiles
--   20260805143958  restrict_settings_read_to_authenticated
--   20260806014850  add_elite_to_plan_check_constraint
--   20260806014915  voice_presets_and_character_voice
-- =====================================================================

-- =====================================================================
-- 2026-08-18  Security audit hardening (applied to the live DB; captured
-- here so a rebuild/reset can't silently regress it).
-- =====================================================================

-- profiles: column-level write lockdown. authenticated may only edit its own
-- safe columns; role/plan/status/credits/api_access are service-role only.
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (username, full_name, company, gender, has_completed_onboarding, rating_prompted_at, skip_ai_refinement, terms_accepted_at)
  ON public.profiles TO authenticated;

-- credit_purchases money ledger: service-role write only.
REVOKE INSERT, UPDATE, DELETE ON public.credit_purchases FROM authenticated;

-- Belt-and-suspenders: the anon role shouldn't hold these write grants either
-- (RLS neutralizes them today, but they shouldn't exist).
REVOKE UPDATE, INSERT, DELETE ON public.profiles FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.credit_purchases FROM anon;

-- Atomic balance mutations (replace app-side read-then-write). SECURITY DEFINER,
-- EXECUTE restricted to service_role so authenticated can't call them to mint
-- or alter its own credits.
CREATE OR REPLACE FUNCTION public.decrement_purchased_credits(p_user_id uuid, p_amount int)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.profiles SET purchased_credits = greatest(0, coalesce(purchased_credits,0) - p_amount)
   WHERE id = p_user_id AND p_amount > 0;
$$;
CREATE OR REPLACE FUNCTION public.add_purchased_credits(p_user_id uuid, p_amount int)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.profiles SET purchased_credits = coalesce(purchased_credits,0) + p_amount
   WHERE id = p_user_id AND p_amount <> 0;
$$;
CREATE OR REPLACE FUNCTION public.increment_free_generations(p_user_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.profiles SET free_generations_used = coalesce(free_generations_used,0) + 1
   WHERE id = p_user_id;
$$;
CREATE OR REPLACE FUNCTION public.record_credit_purchase(
  p_user_id uuid, p_session_id text, p_amount_cents int, p_currency text, p_credits int
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  INSERT INTO public.credit_purchases (user_id, credits, amount_cents, currency, stripe_session_id)
  VALUES (p_user_id, p_credits, p_amount_cents, p_currency, p_session_id)
  ON CONFLICT (stripe_session_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    UPDATE public.profiles SET purchased_credits = coalesce(purchased_credits,0) + p_credits WHERE id = p_user_id;
    RETURN true;
  END IF;
  RETURN false;
END $$;

-- Atomic per-user rate limiter for the public API.
CREATE TABLE IF NOT EXISTS public.api_rate_hits (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_rate_hits_user_time ON public.api_rate_hits (user_id, created_at);
ALTER TABLE public.api_rate_hits ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.api_rate_check(p_user_id uuid, p_window_seconds int, p_max int)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE used int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  DELETE FROM public.api_rate_hits WHERE user_id = p_user_id AND created_at < now() - make_interval(secs => p_window_seconds * 4);
  SELECT count(*) INTO used FROM public.api_rate_hits WHERE user_id = p_user_id AND created_at >= now() - make_interval(secs => p_window_seconds);
  IF used >= p_max THEN RETURN false; END IF;
  INSERT INTO public.api_rate_hits (user_id) VALUES (p_user_id);
  RETURN true;
END $$;

-- Atomic "record a prompt assist iff under the cap".
CREATE OR REPLACE FUNCTION public.record_prompt_assist(
  p_user_id uuid, p_since timestamptz, p_cap int, p_kind text
) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE used int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 7));
  SELECT count(*) INTO used FROM public.prompt_assists
   WHERE user_id = p_user_id AND (p_since IS NULL OR created_at >= p_since);
  IF p_cap >= 0 AND used >= p_cap THEN RETURN -1; END IF;
  INSERT INTO public.prompt_assists (user_id, kind) VALUES (p_user_id, p_kind);
  IF p_cap < 0 THEN RETURN 2147483647; END IF;
  RETURN greatest(0, p_cap - used - 1);
END $$;

REVOKE EXECUTE ON FUNCTION public.decrement_purchased_credits(uuid,int) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.add_purchased_credits(uuid,int) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_free_generations(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_credit_purchase(uuid,text,int,text,int) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.api_rate_check(uuid,int,int) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_prompt_assist(uuid,timestamptz,int,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_purchased_credits(uuid,int) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_purchased_credits(uuid,int) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_free_generations(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_credit_purchase(uuid,text,int,text,int) TO service_role;
GRANT EXECUTE ON FUNCTION public.api_rate_check(uuid,int,int) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_prompt_assist(uuid,timestamptz,int,text) TO service_role;
