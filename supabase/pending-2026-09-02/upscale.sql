-- Video upscale (FLUX Video Upscale, 2026-09-02). Run BEFORE deploying the
-- code that ships with it — the History pages select source_generation_id
-- and the upload sheet writes to the new bucket; both fail without this.
-- Idempotent: safe to run twice.

-- Lineage: an upscaled take points at the take (or upload) it came from.
-- Nullable — ordinary renders and uploaded-source upscales leave it null /
-- self-explanatory. ON DELETE SET NULL: deleting the source must not take
-- the upscale down with it, the upscale is a take in its own right.
alter table public.generations
  add column if not exists source_generation_id uuid references public.generations(id) on delete set null;

create index if not exists generations_source_generation_id_idx
  on public.generations (source_generation_id)
  where source_generation_id is not null;

-- Uploaded-video sources. Private bucket; 50 MB cap and MP4-only enforced
-- AT THE BUCKET so a bypassed client check still cannot store more.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('upscale-sources', 'upscale-sources', false, 52428800, array['video/mp4'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Owner-folder RLS, same shape as chat-attachments: a signed-in user may
-- write and read only under their own uuid folder. The server reads with
-- the service role (signed URLs for fal), which bypasses RLS.
drop policy if exists "upscale sources insert own folder" on storage.objects;
create policy "upscale sources insert own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'upscale-sources' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "upscale sources read own folder" on storage.objects;
create policy "upscale sources read own folder"
  on storage.objects for select to authenticated
  using (bucket_id = 'upscale-sources' and (storage.foldername(name))[1] = auth.uid()::text);
