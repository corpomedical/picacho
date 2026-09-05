-- Layers (Seedream 5 Pro layerize, 2026-09-03). Run BEFORE deploying the
-- code that ships with it — the layer stack page selects from the new
-- table and the upload sheet writes to the new bucket. Idempotent.

-- One row per delivered layer of a split. The parent generations row is
-- the split itself (model_id 'seedream-layerize', content_type 'image',
-- result_url = the base layer). z_index 0 is always the base; higher sits
-- on top. name/description/bbox come straight from the provider and are
-- how a later step addresses a layer — never by array position, because
-- the provider's grouping can differ between two runs of the same image.
create table if not exists public.generation_layers (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.generations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  z_index integer not null,
  name text,
  description text,
  bbox jsonb,
  storage_path text not null,
  width integer,
  height integer,
  -- Set only by a step that RE-RENDERED the person (stage 2); a cutout or
  -- composite never scores, same rule the upscale finish enforces.
  identity_score integer,
  source_layer_id uuid references public.generation_layers(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (generation_id, z_index)
);

create index if not exists generation_layers_generation_id_idx
  on public.generation_layers (generation_id);

alter table public.generation_layers enable row level security;

drop policy if exists "layers read own" on public.generation_layers;
create policy "layers read own"
  on public.generation_layers for select to authenticated
  using (user_id = auth.uid());
-- Writes come from the server with the service role (the finish handler),
-- which bypasses RLS; no client insert/update policy on purpose.

-- Uploaded-image sources. Private; 20 MB and image types enforced AT THE
-- BUCKET so a bypassed client check still cannot store more.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('layer-sources', 'layer-sources', false, 20971520, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "layer sources insert own folder" on storage.objects;
create policy "layer sources insert own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'layer-sources' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "layer sources read own folder" on storage.objects;
create policy "layer sources read own folder"
  on storage.objects for select to authenticated
  using (bucket_id = 'layer-sources' and (storage.foldername(name))[1] = auth.uid()::text);
