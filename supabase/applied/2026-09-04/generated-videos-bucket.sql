-- Somewhere to keep the videos we make.
--
-- Until 2026-09-04 a finished video was never copied anywhere: the collect
-- path wrote the provider's own CDN URL straight into generations.result_url.
-- fal support, asked directly, said that without a lifecycle header they "can
-- only guarantee 7 days" — so every video in every customer's History was a
-- link with a week's promise behind it. A header now asks for no expiration,
-- which stopped the bleeding; this bucket is the actual fix.
--
-- Private, exactly like generated-images: nothing is served from Supabase
-- directly. Reads go through /api/media/<bucket>/<path>, which checks an HMAC
-- capability signature before streaming (src/lib/media/url.ts and
-- src/app/api/media/[...key]/route.ts), so the bucket needs no public role.
--
-- Paths are <user-id>/<uuid>.mp4, which is what the RLS below is keyed on —
-- the same foldername(name)[1] convention every other bucket here uses.
insert into storage.buckets (id, name, public)
values ('generated-videos', 'generated-videos', false)
on conflict (id) do nothing;

-- One policy for all four verbs, mirroring "Users can manage their own
-- generated images". The server writes with the service role and bypasses
-- this; the policy is what stops one signed-in user reaching another's files
-- if a read ever happens under the anon/authenticated key.
drop policy if exists "Users can manage their own generated videos" on storage.objects;
create policy "Users can manage their own generated videos"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'generated-videos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'generated-videos' and (storage.foldername(name))[1] = auth.uid()::text);
