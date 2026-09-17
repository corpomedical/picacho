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
-- NO TABLE AND NO COLUMN. A take is an ordinary generations row (the
-- lane's model ids pick it out), and its source clip is stored under the
-- take's own id — `<user id>/<take id>.mp4|mov` — so the before/after
-- viewer finds the footage from the id alone.

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
  'Recast ("Mystique"): a saved character performs an uploaded clip. Admins only while it is proved. Needs FAL_KEY.'
)
on conflict (key) do nothing;
