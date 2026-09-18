-- Recast — "Mystique" on the door (working title, 2026-09-17): a saved
-- character performs an uploaded clip. The answer to Higgsfield's Genjutsu.
-- Code: src/lib/recast/, the door at /app/mystique.
--
-- RUN THIS BEFORE PUSHING THE CODE. Idempotent: a second paste is harmless.
-- The switch goes in OFF, and the door is admins only while it is proved.
--
-- Safe in either order: until the bucket exists the door refuses an upload
-- with an admin-facing sentence naming this file, before anything is sent
-- or spent; until the flag row exists (or while it is off) the page does
-- not exist and nothing else changes.
--
-- NO TABLE. A take is an ordinary generations row (the lane's model ids
-- pick it out) plus ONE jsonb column holding how it was made.

-- The recipe: where the performance came from, which job and engine ran,
-- the brief that was sent, what was ticked to survive, and whether the take
-- was taken under the lock's promise. Three things need it —
--   the before/after viewer finds the source footage from the take's id;
--   VARIANTS let several takes stand on one uploaded clip, so the clip
--     cannot simply be named after a take;
--   Recreate replays a take on another character or another clip.
-- Only src/lib/recast/store.ts names this column.
alter table public.generations add column if not exists recast jsonb;

-- Bounded: the server writes ~2 KB of fields; nothing hand-written ever
-- lands here, but the bound keeps a bug from storing a novel.
alter table public.generations drop constraint if exists generations_recast_check;
alter table public.generations add constraint generations_recast_check check (
  recast is null or pg_column_size(recast) <= 8192
);

-- The viewer and the orphan sweep both ask "which clip does this take stand
-- on", so the lookup is by the source inside the column.
create index if not exists generations_recast_source_idx
  on public.generations using gin (recast jsonb_path_ops)
  where recast is not null;

-- Uploaded source clips. Private; 50 MB and MP4/MOV enforced AT THE BUCKET
-- so a bypassed client check still cannot store more. (Phones record MOV.)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recast-sources', 'recast-sources', false, 52428800, array['video/mp4', 'video/quicktime'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Owner-folder RLS, the upscale-sources shape: a signed-in user may write
-- and read only under their own uuid folder. The server reads, signs and
-- removes with the service role, which bypasses RLS — there is no client
-- delete or update on purpose.
drop policy if exists "recast sources insert own folder" on storage.objects;
create policy "recast sources insert own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'recast-sources' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "recast sources read own folder" on storage.objects;
create policy "recast sources read own folder"
  on storage.objects for select to authenticated
  using (bucket_id = 'recast-sources' and (storage.foldername(name))[1] = auth.uid()::text);

insert into public.feature_flags (key, enabled, description)
values (
  'recast',
  false,
  'Recast ("Mystique"): a saved character performs a clip. Admins only while it is proved. Needs FAL_KEY.'
)
on conflict (key) do nothing;

-- THE IDENTITY LOCK, and it costs money. With it ON, a take whose face
-- falls under the bar at the start, the middle or the end is still
-- delivered but is NOT charged for — while the provider bills us either
-- way. That is a deliberate exception to "charge the customer exactly when
-- the provider charged us", so it is the operator's switch to flip, not a
-- default. OFF, the frames are still scored and the number is still shown;
-- only the refund and the promise on the door go away.
insert into public.feature_flags (key, enabled, description)
values (
  'recast_lock',
  false,
  'Recast: do not charge for a take whose face falls under the bar at the start, middle or end. We still pay the provider for it.'
)
on conflict (key) do nothing;
