-- Press Tour, SQL 1 of the rollout: every switch and every setting, all OFF
-- (2026-09-25; Spec v2, press-tour-synthesis.md §3.4 "Flags and settings, v2",
-- plus the operator's trial decision of the same day). Code:
-- src/lib/press-tour/enabled.ts reads these; PRESS_TOUR_FLAGS and
-- PRESS_TOUR_SETTINGS there are pinned against this file by enabled.test.ts.
--
-- RUN THIS BEFORE PUSHING THE CODE. Idempotent: a second paste is harmless,
-- and it never changes a row that already exists (ON CONFLICT DO NOTHING), so
-- a switch the operator has since turned on in Admin stays on.
--
-- Nothing here changes a table. A missing row already reads as OFF, because
-- every reader fails closed; running this file only makes the switches and
-- settings appear in Admin so they can be turned on there, in order, admins
-- first.
--
-- NOTHING IN THIS FILE TURNS ANYTHING ON. Press Tour itself (`press_tour`) is
-- inserted OFF too: after the Cut 1 push, the operator turns it on in
-- Admin > Feature flags, and then only admins see the door.

-- ---------------------------------------------------------------------
-- 1. Switches (feature_flags), all inserted OFF.
-- ---------------------------------------------------------------------

-- Cut 1. The door, the Generate mode and the Producer's tools, for admins.
-- Off = hidden everywhere and every Press Tour action refuses (the kill
-- switch; PRESS_TOUR_DISABLED=1 in the environment does the same without the
-- database).
insert into public.feature_flags (key, enabled, description)
values (
  'press_tour',
  false,
  'Press Tour: product ads starring your character. On = admins can use it. Off = hidden everywhere and every Press Tour action refuses. Needs FAL_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_VISION_API_KEY, GEMINI_API_KEY.'
)
on conflict (key) do nothing;

-- Cut 5. Posting: the master switch, then TikTok (sandbox testers until the
-- audit) and Meta (testers until App Review).
insert into public.feature_flags (key, enabled, description)
values (
  'press_tour_posting',
  false,
  'Press Tour posting, master switch. Off = no ad is posted or scheduled anywhere; ads can still be downloaded.'
)
on conflict (key) do nothing;

insert into public.feature_flags (key, enabled, description)
values (
  'press_post_tiktok_direct',
  false,
  'Press Tour: post straight to TikTok. Sandbox testers only until TikTok''s audit passes. Needs press_tour_posting.'
)
on conflict (key) do nothing;

insert into public.feature_flags (key, enabled, description)
values (
  'press_post_meta',
  false,
  'Press Tour: post to Instagram, Threads and Facebook. Testers only until Meta App Review passes. Needs press_tour_posting.'
)
on conflict (key) do nothing;

-- Cut 6. The trend brief.
insert into public.feature_flags (key, enabled, description)
values (
  'press_trends',
  false,
  'Press Tour trend brief (named sources only). Off = plans are written without it.'
)
on conflict (key) do nothing;

-- Cut 7. Who gets Press Tour beyond admins, and the free trial ad.
insert into public.feature_flags (key, enabled, description)
values (
  'press_tour_plans',
  false,
  'Press Tour for the plans named in the setting press_tour_plan_list. Off = admins only.'
)
on conflict (key) do nothing;

insert into public.feature_flags (key, enabled, description)
values (
  'product_lock_person_reshoot',
  false,
  'Press Tour: when a shot''s product reads "Didn''t match", the person may ask for one free re-shoot (we pay). Capped per ad, per person (press_reshoot_user_30d) and per day (press_reshoot_daily_usd).'
)
on conflict (key) do nothing;

insert into public.feature_flags (key, enabled, description)
values (
  'press_post_x',
  false,
  'Press Tour: post to X for everyone with access. App-wide ceiling: press_x_daily_cap posts a day. Needs press_tour_posting.'
)
on conflict (key) do nothing;

insert into public.feature_flags (key, enabled, description)
values (
  'press_tour_trial',
  false,
  'Press Tour free trial ad: one per confirmed email or Google account, ever, for accounts without a Press Tour plan. Stops for the day at press_trial_daily_usd dollars or press_trial_daily_cap claims.'
)
on conflict (key) do nothing;

-- Cut 8. Press Tour inside Claude and ChatGPT.
insert into public.feature_flags (key, enabled, description)
values (
  'press_tour_mcp',
  false,
  'Press Tour inside Claude and ChatGPT (sign-in plus the Press Tour tools). Off = the tools and the sign-in refuse.'
)
on conflict (key) do nothing;

-- Cut 9, and only when the calibration gate passes. Until then every product
-- check is RECORD-ONLY: the verdict is shown and stored, and it drives no
-- re-shoot and no refund, and no screen says "locked".
insert into public.feature_flags (key, enabled, description)
values (
  'product_lock_calibrated',
  false,
  'Press Tour product checks are calibrated (hand-labelled gate passed). Off = checks are record-only and product_lock_min_confidence is ignored.'
)
on conflict (key) do nothing;

insert into public.feature_flags (key, enabled, description)
values (
  'product_lock_reshoot',
  false,
  'Press Tour: re-shoot a shot automatically, once, at our cost, when its product "Didn''t match". Only after calibration (false-mismatch at or under 3%).'
)
on conflict (key) do nothing;

insert into public.feature_flags (key, enabled, description)
values (
  'product_lock_refund',
  false,
  'Press Tour: refund a shot whose product still "Didn''t match" after its re-shoot, at most 5 per person per 30 days. Only after calibration AND the operator''s yes. We still pay the provider for it.'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2. Settings (app_settings). Every one seeded so that it does nothing:
--    '0' is closed, off, or "no plan". The one exception is
--    press_reshoot_user_30d = '6', the per-person re-shoot allowance of v2;
--    it does nothing either until product_lock_person_reshoot or
--    product_lock_reshoot is on AND press_reshoot_daily_usd is above 0.
--
--    app_settings is readable by every signed-in account; none of these is
--    a secret. Admin > Settings will not save an empty value, which is why
--    the plan list is seeded '0' rather than ''.
-- ---------------------------------------------------------------------

insert into public.app_settings (key, value, description)
values (
  'press_tour_plan_list',
  '0',
  'Plans that get Press Tour when press_tour_plans is on: plan ids separated by commas, e.g. basic,starter,growth,studio,elite. 0 = no plan.'
)
on conflict (key) do nothing;

insert into public.app_settings (key, value, description)
values (
  'press_trial_daily_usd',
  '0',
  'Press Tour free trial: the most we spend on trial ads in one UTC day, in US dollars (the operator starts it at 50). A claim that would pass it waits for tomorrow. 0 = no trial claims.'
)
on conflict (key) do nothing;

insert into public.app_settings (key, value, description)
values (
  'press_trial_daily_cap',
  '0',
  'Press Tour free trial: the most trial claims in one UTC day, whatever they cost. 0 = no trial claims.'
)
on conflict (key) do nothing;

insert into public.app_settings (key, value, description)
values (
  'press_reshoot_daily_usd',
  '0',
  'Press Tour: the most we spend on free re-shoots and repaints in one UTC day, app-wide, in US dollars. One person may use at most a tenth of it. 0 = no free re-shoots.'
)
on conflict (key) do nothing;

insert into public.app_settings (key, value, description)
values (
  'press_reshoot_user_30d',
  '6',
  'Press Tour: the most free re-shoots one person gets in any 30 days.'
)
on conflict (key) do nothing;

insert into public.app_settings (key, value, description)
values (
  'press_x_daily_cap',
  '0',
  'Press Tour: the most posts to X in one UTC day, app-wide (each costs us $0.030 without a link). 0 = no posts to X. Raise past 200 only after X answers in writing.'
)
on conflict (key) do nothing;

insert into public.app_settings (key, value, description)
values (
  'product_lock_min_confidence',
  '0',
  'Press Tour: the lowest product-check confidence (0-100) that may count as "Didn''t match". Read only when product_lock_calibrated is on.'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 3. Verify. Fails loudly if a row is missing; lists every row either way.
--    A switch found ON is reported, not refused: it means someone turned it
--    on after the first paste, which a re-paste must not undo.
-- ---------------------------------------------------------------------
do $$
declare
  want_flags text[] := array[
    'press_tour', 'press_tour_posting', 'press_post_tiktok_direct', 'press_post_meta',
    'press_trends', 'press_tour_plans', 'product_lock_person_reshoot', 'press_post_x',
    'press_tour_trial', 'press_tour_mcp', 'product_lock_calibrated', 'product_lock_reshoot',
    'product_lock_refund'
  ];
  want_settings text[] := array[
    'press_tour_plan_list', 'press_trial_daily_usd', 'press_trial_daily_cap',
    'press_reshoot_daily_usd', 'press_reshoot_user_30d', 'press_x_daily_cap',
    'product_lock_min_confidence'
  ];
  missing text;
  on_now text;
begin
  select string_agg(k, ', ') into missing
  from unnest(want_flags) k
  where not exists (select 1 from public.feature_flags f where f.key = k);
  if missing is not null then
    raise exception 'Press Tour switches missing: %', missing;
  end if;

  select string_agg(k, ', ') into missing
  from unnest(want_settings) k
  where not exists (select 1 from public.app_settings s where s.key = k);
  if missing is not null then
    raise exception 'Press Tour settings missing: %', missing;
  end if;

  select string_agg(f.key, ', ') into on_now
  from public.feature_flags f
  where f.key = any (want_flags) and f.enabled;
  if on_now is not null then
    raise notice 'Press Tour switches already ON (left as they are): %', on_now;
  end if;
end $$;

-- One result (the SQL editor shows only the last one). Expect 20 rows:
-- 13 switches, every one "false" on the first paste, then 7 settings,
-- press_reshoot_user_30d = 6 and every other one 0.
select 'switch' as kind, key, enabled::text as value
from public.feature_flags
where key in (
  'press_tour', 'press_tour_posting', 'press_post_tiktok_direct', 'press_post_meta',
  'press_trends', 'press_tour_plans', 'product_lock_person_reshoot', 'press_post_x',
  'press_tour_trial', 'press_tour_mcp', 'product_lock_calibrated', 'product_lock_reshoot',
  'product_lock_refund'
)
union all
select 'setting', key, value
from public.app_settings
where key in (
  'press_tour_plan_list', 'press_trial_daily_usd', 'press_trial_daily_cap',
  'press_reshoot_daily_usd', 'press_reshoot_user_30d', 'press_x_daily_cap',
  'product_lock_min_confidence'
)
order by kind desc, key;
