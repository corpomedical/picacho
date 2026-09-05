-- Send Receipt P3 (2026-08-25): character render style.
--
-- Drives the Seedance 2.5 lane rule with knowledge instead of heuristics:
-- 2.5 rejects photoreal people, so the resolver warns precisely when the
-- character IS photoreal — and falls back to today's has-reference-photos
-- heuristic whenever the style is unknown (null), so the fence never has a
-- coverage gap (adversarial-review requirement: the rule may gain
-- precision, never lose coverage).
--
-- Written by one vision look at reference photo #1 whenever a character's
-- photo set changes on save (see saveCharacterProfile). Nullable and
-- additive: null keeps exactly today's behavior, so this SQL is safe to run
-- ahead of the deploy — and MUST run before it (workspace-data selects the
-- column).

alter table public.character_profiles
  add column if not exists render_style text
  check (render_style in ('photoreal', 'illustrated'));
