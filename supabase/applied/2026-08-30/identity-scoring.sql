-- =====================================================================
-- 2026-08-30  Close the identity-scoring loop: score video, and record
--             WHICH MODEL rendered each generation.
--
-- SAFE TO RUN AHEAD OF THE DEPLOY. Both changes are additive and nullable;
-- until the matching code ships, model_id simply stays null and nothing
-- reads it. Running this first is still the intended order (SQL-first), but
-- the code is written so that a deploy landing BEFORE this SQL cannot break
-- a generation either — model_id is written by a separate best-effort
-- UPDATE that logs and continues if the column isn't there yet.
--
-- WHY model_id EXISTS
-- The generations table records video_model_id for videos and NOTHING for
-- images (there was no image model column at all — grep for
-- "image_model_id" returned zero hits repo-wide). Images are also the only
-- content type that was ever scored. So the label (match_score) and the
-- feature (which model produced it) lived on opposite sides of a divide
-- that was never crossed, and the question the whole product is built to
-- answer — "what model holds a face best, for this character?" — was not
-- answerable from this database in either direction.
--
-- model_id is that missing join: one column, written for BOTH content
-- types, holding the model actually selected for the render.
--
-- KNOWN LIMIT, recorded here on purpose: model_id stores the model that was
-- SELECTED. On the image lane a safety rejection can fall back from GPT
-- Image to FLUX mid-generation (see providers/image.ts), and the pipeline
-- currently reports that only as a display NAME in the step log
-- ("Generated via … (fallback)"), never as an id it returns. Until the
-- pipeline returns the id it actually used, the pipeline_log is the
-- tiebreaker for that minority of rows. Do not treat model_id as
-- ground truth for fallback analysis without checking the log.
--
-- SECURITY: no grant is needed and none is given. pending-2026-08-22/
-- generations-write-lockdown.sql revoked blanket write on this table and
-- re-granted only three columns to `authenticated` (cancel_requested,
-- feedback, deleted_at). Column grants do not extend to new columns, so
-- model_id is service-role-only by construction — same as status,
-- match_score and result_url. Do not add a grant for it.
-- =====================================================================

alter table public.generations
  add column if not exists model_id text;

comment on column public.generations.model_id is
  'The model selected to render this generation, for BOTH images and video '
  '(video_model_id is kept for existing reporting). Written best-effort by '
  'the app right after reservation. See pending-2026-08-30/identity-scoring.sql '
  'for the fallback caveat.';

-- The index that makes the point of the column: "score by model", which is
-- the query behind per-character model routing and any published fidelity
-- benchmark. Partial, because rows without a score contribute nothing to it.
create index if not exists generations_model_id_match_score_idx
  on public.generations (model_id, match_score)
  where match_score is not null;

-- Backfill what is already knowable: every existing video row already
-- carries its model in video_model_id. Images cannot be backfilled — the
-- information was never recorded anywhere for them.
update public.generations
   set model_id = video_model_id
 where model_id is null
   and video_model_id is not null;
