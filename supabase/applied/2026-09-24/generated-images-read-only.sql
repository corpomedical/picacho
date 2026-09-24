-- generated-images: a signed-in person may read and delete their own files,
-- never write them (2026-09-24 storage review; the sibling of
-- generated-videos-read-only.sql).
--
-- THE HOLE. The bucket's one policy ("Users can manage their own generated
-- images", FOR ALL TO authenticated, fenced to the caller's own <uid>/ folder
-- — made in the dashboard, recorded in
-- applied/2026-09-09/storage-policies-on-file.sql) grants all four verbs.
-- With INSERT/UPDATE open, anyone holding their own session token can PUT
-- <uid>/<uuid>.png with x-upsert and replace a finished still that already
-- passed the output gate with an unchecked picture, served under the same
-- /api/media URL, Community posts, posters, set looks and sheets included.
--
-- WHAT STAYS, AND WHY:
--   SELECT  harmless (own folder only) and needed by DELETE: storage's
--           remove() reads the rows it deletes.
--   DELETE  deleteGeneration (src/lib/generations/actions.ts) removes a
--           deleted still, its negatives and its layers with the USER's
--           client, and removeLookCutoutsOf (sets/look-cutout-store.ts) is
--           handed that same client. Deleting your own file cannot put new
--           content anywhere; without INSERT or UPDATE nothing goes back in
--           its place.
-- WHAT GOES: INSERT and UPDATE.
--
-- ORDER: PUSH THE CODE FIRST. Until the commit that ships with this file, the
-- composer stored every still, its lab negative and its opening frames with
-- the person's own client (actions.ts storeSetImage → persistGeneratedImage,
-- persistImageBytes): run this before that push is live and every image
-- generation fails to save. After it, persistGeneratedImage and
-- persistImageBytes take no client and always write with the service role
-- (the <uid>/ fence is a path check in core.ts), and every other write to the
-- bucket (sets/*.ts, job-runner posters and layers, angle-stage, reconcile)
-- was already createAdminClient(). No browser code writes this bucket.
-- Account deletion (removeAllUserStorage) runs on the admin client.
--
-- NO REVOKE — same reasoning as generated-videos-read-only.sql: privileges on
-- storage.objects are shared by every bucket; the per-bucket control is the
-- policy, and permissive policies OR together, so step 2 checks that no OTHER
-- policy for public, anon or authenticated still lets anyone write here.
--
-- Idempotent: a second paste is harmless.

-- 1. Replace the all-verbs policy with read + delete.
begin;

drop policy if exists "Users can manage their own generated images" on storage.objects;

drop policy if exists "Users can view their own generated images" on storage.objects;
create policy "Users can view their own generated images"
  on storage.objects for select to authenticated
  using (bucket_id = 'generated-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can delete their own generated images" on storage.objects;
create policy "Users can delete their own generated images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'generated-images' and (storage.foldername(name))[1] = auth.uid()::text);

commit;

-- 2. Verify: no policy lets public, anon or authenticated write a
--    generated-images object — neither one that names the bucket nor one that
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
      coalesce(qual, '') || coalesce(with_check, '') ilike '%generated-images%'
      or coalesce(qual, '') || coalesce(with_check, '') not ilike '%bucket_id%'
    );
  if offenders is not null then
    raise exception 'generated-images is still writable by a client: %', offenders;
  end if;
end $$;

-- 3. What is left on the bucket (expect exactly two rows: SELECT and DELETE).
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage'
  and (qual ilike '%generated-images%' or with_check ilike '%generated-images%')
order by cmd;
