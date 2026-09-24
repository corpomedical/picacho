-- Director's Cut v2 (2026-09-25, "Rebuild it, let opus 5.5 write the whole
-- video"): the shape an edit is made in can be left to the editor. "auto"
-- (the new default) lets Opus read it from the brief — "shorts" means 9:16,
-- a YouTube cut 16:9 — instead of the page forcing one; the operator's first
-- real edit asked for shorts and was forced into one 16:9 reel.
--
-- RUN THIS BEFORE PUSHING THE CODE. Idempotent: a second paste is harmless.

alter table public.video_edits drop constraint if exists video_edits_aspect_check;
alter table public.video_edits add constraint video_edits_aspect_check
  check (aspect in ('auto', '16:9', '9:16', '1:1'));
alter table public.video_edits alter column aspect set default 'auto';

-- VERIFY (should show the four values):
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'video_edits_aspect_check';
