-- Two small things the code has been asking for (2026-09-18).
--
-- RUN THIS WHENEVER: both are idempotent, neither changes any row, and the
-- code works before and after — one gets faster, the other stops failing
-- silently. File under supabase/applied/2026-09-18/ once it has run.

-- 1. THE SETS FINISHER'S EVERY-MINUTE READ.
--
-- /api/cron/sets runs once a minute and asks the same question every time:
-- which sets are still building, not deleted, touched in the last two hours
-- (src/lib/sets/finisher.ts). location_sets has no index on status, so that
-- is a sequential scan of the table, sixty times an hour, forever. It is
-- nothing at today's size and it is the wrong shape to widen Sets on.
--
-- Partial on purpose: `status = 'building'` is a handful of rows out of the
-- whole table at any moment, and the index only has to hold those. updated_at
-- rides as the second column because the query orders by it (oldest first).
CREATE INDEX IF NOT EXISTS location_sets_building
  ON public.location_sets (updated_at)
  WHERE status = 'building' AND deleted_at IS NULL;

-- 2. THE ASSIST KIND CINEMA STUDIO WRITES.
--
-- src/lib/prompts/actions.ts records every prompt assist through
-- record_prompt_assist, and Cinema Studio's shot list records its own as
-- 'scene_plan' — a kind the table's CHECK has never allowed. So the insert
-- raises, record_prompt_assist's caller reads no number back, and the person
-- is told they have 0 assists left on a plan that gives them dozens, while
-- the ledger the admin economics page reads never sees a scene plan at all.
--
-- Written as a drop-and-add of the one constraint: a CHECK cannot be altered
-- in place, and no existing row can fail the wider rule.
ALTER TABLE public.prompt_assists DROP CONSTRAINT IF EXISTS prompt_assists_kind_check;
ALTER TABLE public.prompt_assists
  ADD CONSTRAINT prompt_assists_kind_check
  CHECK (kind = ANY (ARRAY['enhance'::text, 'from_image'::text, 'scene_plan'::text]));

-- What you should see afterwards:
--   select indexname from pg_indexes where tablename = 'location_sets';
--     -> includes location_sets_building
--   select pg_get_constraintdef(oid) from pg_constraint
--     where conname = 'prompt_assists_kind_check';
--     -> includes 'scene_plan'
