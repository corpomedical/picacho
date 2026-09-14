-- The Set Editor (2026-09-14): the owner's working copy of a set.
--
-- Astra's original stays in `spec`, untouched forever — the editor writes
-- every change (the person's hand edits and Astra's word edits alike) to
-- `edited_spec`, so "Astra's original" can always bring the set back. The
-- page renders edited_spec when it exists, spec otherwise; both go through
-- normaliseSetSpec on every read.
--
-- Idempotent: safe to run more than once.

alter table public.location_sets
  add column if not exists edited_spec jsonb;
