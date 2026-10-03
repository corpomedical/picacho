-- Director's Cut for every paid plan (operator, 2026-10-03: "Post it and in a
-- new window finish everything and pricing and get it live"; his picks: pay
-- what it uses, every paid plan, Effects stays admins-only, a page with an
-- upgrade prompt for everyone else).
--
-- One switch, ON: with it on, any plan in good standing can open Director's
-- Cut and every account sees it in the menu (one without a paid plan gets the
-- page that says how to get one). Off = admins only again, nothing else
-- changes; edits already running finish and settle their credits. It sits
-- under `video_editor`, which still switches the whole editor off for
-- everyone. Idempotent: a second run changes nothing.
--
-- Nothing else in the database changes: a cut's credits are held and settled
-- through the existing reserve_generations, add_purchased_credits and
-- add_bonus_credits (lib/editor/charge.ts), exactly as Live's are.

insert into public.feature_flags (key, enabled, description)
values (
  'video_editor_paid_plans',
  true,
  'Director''s Cut for every paid plan (a cut or a change holds credits and keeps what Opus used). Off = admins only. Needs video_editor on.'
)
on conflict (key) do nothing;
