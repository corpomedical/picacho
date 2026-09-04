-- Layer edits (stage 2, 2026-09-04). Run BEFORE deploying the code that
-- ships with it — the stack page selects `version` and `prompt`, and the
-- edit action inserts a new version row. Idempotent.
--
-- A re-rendered layer is a NEW ROW, not an overwrite: the media route serves
-- every stored object immutable for a year, so replacing bytes at a path
-- already on someone's screen would ship stale pixels for months. Versions
-- also make the edit reversible — the original is still there, still
-- downloadable, and the stack shows the newest per z_index.

alter table public.generation_layers
  add column if not exists version integer not null default 1;

-- What the user asked for, kept with the layer it produced: the stack shows
-- it under the layer name, and it is what a re-run would repeat.
alter table public.generation_layers
  add column if not exists prompt text;

-- The old unique was (generation_id, z_index), which is exactly what a second
-- version of one layer collides with.
--
-- SAFE IN EITHER DEPLOY ORDER, and that took a fix on the code side to be
-- true: the stage-1 collector used to upsert with onConflict
-- "generation_id,z_index", which PostgREST resolves against a unique index of
-- exactly that shape — so dropping this constraint before the new code
-- deployed would have failed every new split's layer write, thrown
-- CriticalWriteError, and left it retrying behind a spinner. The collector
-- now inserts and treats a duplicate as done, naming no constraint at all,
-- so it works before and after this runs.
alter table public.generation_layers
  drop constraint if exists generation_layers_generation_id_z_index_key;

create unique index if not exists generation_layers_version_key
  on public.generation_layers (generation_id, z_index, version);

-- The stack reads the newest version of each layer on every page view.
create index if not exists generation_layers_newest_idx
  on public.generation_layers (generation_id, z_index, version desc);
