-- Six storage policies that existed only in the live database, written down.
--
-- On 2026-09-09 the operator read pg_policies for storage.objects back into
-- chat. Eleven policies; five are in applied/ (generated-videos on 09-04,
-- layer and upscale sources on 09-03). The six below — every policy on
-- character-references, chat-attachments and generated-images — were made in
-- the dashboard and never recorded, the same way the profiles column grant
-- was. Each one here is the live definition verbatim: bucket, and the first
-- path segment must equal the caller's uid, so a person reaches only their
-- own folder. Running this re-creates them identically; nothing changes.
--
-- Two notes for whoever edits these:
--   * "Users can manage their own chat attachments" is granted TO public
--     rather than to authenticated, unlike its siblings. Harmless — an
--     anonymous caller has no uid and matches no folder — and kept as-is so
--     this file matches production rather than improving on it.
--   * The three INSERT policies carry their rule in WITH CHECK, which
--     pg_policies shows in a separate column from USING; both were read.

drop policy if exists "Users can view their own reference images" on storage.objects;
create policy "Users can view their own reference images"
  on storage.objects for select to authenticated
  using (bucket_id = 'character-references' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can upload their own reference images" on storage.objects;
create policy "Users can upload their own reference images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'character-references' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can update their own reference images" on storage.objects;
create policy "Users can update their own reference images"
  on storage.objects for update to authenticated
  using (bucket_id = 'character-references' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can delete their own reference images" on storage.objects;
create policy "Users can delete their own reference images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'character-references' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can manage their own chat attachments" on storage.objects;
create policy "Users can manage their own chat attachments"
  on storage.objects for all to public
  using (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'chat-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can manage their own generated images" on storage.objects;
create policy "Users can manage their own generated images"
  on storage.objects for all to authenticated
  using (bucket_id = 'generated-images' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'generated-images' and (storage.foldername(name))[1] = auth.uid()::text);
