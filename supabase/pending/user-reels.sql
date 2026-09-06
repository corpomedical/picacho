-- The dashboard highlight reel (2026-09-07).
--
-- Operator: "the website takes best scoring videos generated, 3 at max.
-- Making a one video with 3 to 5 seconds of footage from each" — and then,
-- on the how: "with the lowest data consumption possible and cacheable".
--
-- One row per user, holding the pointer to a small stitched MP4 built by
-- /api/cron/reels. Not a generations row on purpose: a reel is a derived
-- artifact, not a render. Filing it in public.generations would mean reusing
-- content_type='video' + status='succeeded', and it would then leak into
-- History, the Media grid, the credit and score aggregates, and the community
-- share path — every one of which counts real renders.
--
-- WHY THE PATH IS THE CACHE KEY. reelStorageKey() (src/lib/media/reel-encode.ts)
-- hashes the exact inputs that decide the bytes: which generations, cut where,
-- at which encoder version. /api/media serves
-- `public, max-age=31536000, immutable` and signs URLs with a pure function of
-- the path, so a stable path means the browser and Vercel's edge fetch a reel
-- once and never again. When the user's best three change, the hash changes,
-- which produces a NEW immutable URL — a fresh file rather than a stale-cache
-- problem. That is the whole "cacheable" half of the brief.
--
-- Measured cost of the artifact this row points at, on real footage: three
-- takes x 3 seconds at 640x360 / 24fps / crf31 = 322 KB, against 7,779 KB for
-- fetching the same three untouched takes.
--
-- No new bucket. The file lands in the existing `generated-videos` bucket
-- under `<user-id>/reel/<hash>.mp4`, so the owner-folder storage policy
-- already applies unchanged and MEDIA_BUCKETS / USER_STORAGE_BUCKETS /
-- verify-db.mjs need no edit.

create table if not exists public.user_reels (
  -- One reel per user: the row IS the current reel, replaced when it changes.
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- Storage key inside `generated-videos`, not a URL. URLs are signed at read
  -- time by mediaUrl() so a rotated MEDIA_SIGNING_SECRET cannot strand a row.
  storage_path text not null,
  -- The reel's own first frame, stored beside it as <hash>.jpg. The band
  -- paints this server-side, and it is the ONLY thing a viewer on a metered
  -- connection or with prefers-reduced-motion ever downloads (~25 KB against
  -- the reel's ~322 KB). Nullable: a poster is best-effort, and a reel without
  -- one still plays.
  poster_path text,
  -- Which character the reel is about, for the caption over the band.
  character_profile_id uuid references public.character_profiles(id) on delete set null,
  -- The takes it was cut from, in reel order. Kept so the cron can tell
  -- "nothing changed, skip the encode" without re-deriving the hash, and so a
  -- support question about a reel is answerable.
  clip_generation_ids uuid[] not null default '{}',
  duration_seconds integer not null default 0,
  byte_size integer,
  -- Denormalised for the caption over the band, so the dashboard does not run
  -- an aggregate over generations on every home-screen load just to print
  -- "65 takes, 89 mean". Recomputed on every rebuild; a stale value here is
  -- cosmetic and self-heals the next time the reel changes.
  takes integer,
  mean_identity smallint,
  built_at timestamptz not null default now(),
  constraint user_reels_duration_sane check (duration_seconds >= 0 and duration_seconds <= 60)
);

create index if not exists user_reels_built_at_idx on public.user_reels (built_at);

alter table public.user_reels enable row level security;

drop policy if exists "reels read own" on public.user_reels;
create policy "reels read own"
  on public.user_reels for select to authenticated
  using (user_id = auth.uid());

-- Writes come from /api/cron/reels with the service role, which bypasses RLS.
-- No client insert/update/delete policy on purpose: a reel is something the
-- system builds about you, never something you can point at a file you chose.

-- ---------------------------------------------------------------------
-- Verification — safe to run, changes nothing.
-- ---------------------------------------------------------------------
-- select count(*) from public.user_reels;
-- select user_id, storage_path, duration_seconds, byte_size, built_at
--   from public.user_reels order by built_at desc limit 10;
