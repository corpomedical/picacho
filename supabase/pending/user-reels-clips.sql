-- Per-cut detail for the dashboard reel (2026-09-07).
--
-- The reel band we designed names each cut as it plays — a score chip and the
-- line the person actually typed — and draws one progress segment per cut with
-- a small identity meter beside it. All of that needs per-clip facts, and the
-- first cut of the table stored only clip_generation_ids, which is enough to
-- COUNT the cuts but not to label them.
--
-- Denormalised deliberately. The alternative is the dashboard joining back to
-- generations for three rows on every home-screen load, to print text that
-- cannot change until the reel is rebuilt anyway. A stale value here is
-- cosmetic and self-heals on the next rebuild.
--
-- Shape, in reel order:
--   [{ "id": uuid, "score": 91, "seconds": 3, "label": "Eva on a snowy ridge" }]
--
-- `label` is the user's own prompt, trimmed on a word boundary — the band
-- reads like their edit rather than our summary of it. Nullable inside the
-- object: a take with no prompt or no score still belongs in the reel.

alter table public.user_reels
  add column if not exists clips jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------
-- Verification — safe to run, changes nothing.
-- ---------------------------------------------------------------------
-- select user_id, jsonb_array_length(clips) as cuts, clips
--   from public.user_reels order by built_at desc limit 5;
