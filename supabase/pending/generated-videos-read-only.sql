-- generated-videos: a signed-in person may read and delete their own files,
-- never write them (2026-09-24 storage review).
--
-- THE HOLE. applied/2026-09-04/generated-videos-bucket.sql made ONE policy for
-- all four verbs ("Users can manage their own generated videos", FOR ALL TO
-- authenticated, fenced to the caller's own <uid>/ folder). Every file in this
-- bucket is written by the server with the service role, which bypasses RLS —
-- so the INSERT/UPDATE half was never used by us, only available to anyone
-- holding their own session token: PUT <uid>/<uuid>.mp4 with x-upsert and a
-- finished render that already passed the output gate (judgeRender) is
-- replaced by an unchecked file, served under the same /api/media URL,
-- Community posts included.
--
-- WHAT STAYS, AND WHY:
--   SELECT  harmless (own folder only) and needed by DELETE: storage's
--           remove() reads the rows it deletes.
--   DELETE  deleteGeneration (src/lib/generations/actions.ts) removes a
--           deleted video and its poster with the USER's client. Deleting
--           your own file cannot put new content anywhere; without INSERT or
--           UPDATE there is nothing to put back in its place.
-- WHAT GOES: INSERT and UPDATE. Nothing in src/ writes this bucket as the
-- user: every upload/move is createAdminClient(), and the two browser uploads
-- (Live recording, Helios thing models) use uploadToSignedUrl with a token the
-- server minted — storage runs those as its own superuser, no policy needed.
-- Account deletion (removeAllUserStorage) runs on the admin client.
--
-- NO REVOKE. supabase/README.md's "a revoke names all three" rule is about
-- function EXECUTE grants. Privileges on storage.objects are shared by every
-- bucket; the per-bucket control is the policy, and permissive policies OR
-- together — so step 2 below checks that no OTHER policy, for public, anon or
-- authenticated, still lets anyone write here (a bucket-agnostic policy would).
--
-- Order: independent of any code push. Idempotent: a second paste is harmless.

-- 1. Replace the all-verbs policy with read + delete.
begin;

drop policy if exists "Users can manage their own generated videos" on storage.objects;

drop policy if exists "Users can view their own generated videos" on storage.objects;
create policy "Users can view their own generated videos"
  on storage.objects for select to authenticated
  using (bucket_id = 'generated-videos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can delete their own generated videos" on storage.objects;
create policy "Users can delete their own generated videos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'generated-videos' and (storage.foldername(name))[1] = auth.uid()::text);

commit;

-- 2. Verify: no policy lets public, anon or authenticated write a
--    generated-videos object — neither one that names the bucket nor one that
--    names no bucket at all. Fails loudly, naming the offenders.
do $$
declare
  offenders text;
begin
  select string_agg(format('%s (%s to %s)', policyname, cmd, array_to_string(roles, ',')), '; ')
    into offenders
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and cmd in ('ALL', 'INSERT', 'UPDATE')
    and roles && array['public', 'anon', 'authenticated']::name[]
    and (
      coalesce(qual, '') || coalesce(with_check, '') ilike '%generated-videos%'
      or coalesce(qual, '') || coalesce(with_check, '') not ilike '%bucket_id%'
    );
  if offenders is not null then
    raise exception 'generated-videos is still writable by a client: %', offenders;
  end if;
end $$;

-- 3. What is left on the bucket (expect exactly two rows: SELECT and DELETE).
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage'
  and (qual ilike '%generated-videos%' or with_check ilike '%generated-videos%')
order by cmd;
