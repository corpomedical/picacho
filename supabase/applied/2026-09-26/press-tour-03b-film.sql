-- Press Tour, SQL 3b of the rollout: filming, the press wall and the cut
-- (Cut 4: film -> check -> cut -> tag -> sign -> deliver). 2026-09-26; Spec
-- v1 §1.7-§1.12 as changed by v2 (press-tour-synthesis.md §3.1 items 18, 19,
-- 25, 39 and §3.4 Cut 4) and the operator's decisions of 2026-09-26 (no
-- re-shoot and no refund for a product miss before calibration: a filmed
-- shot that didn't match shows its verdict and the person keeps the take,
-- films the shot again at its normal price, or cuts it for free). Code:
-- src/lib/press-tour/shots.ts (the shots column), film.ts (filming and the
-- checks on shots), cut.ts (the cut, the tag, signing, delivery and the 24 h
-- rule), campaign-machine.ts, campaign-service.ts.
--
-- RUN THIS BEFORE PUSHING THE CODE, after press-tour-03-campaigns.sql (it
-- alters that file's press_campaigns). Idempotent: a second paste is
-- harmless, and it never changes a switch or a setting that already exists
-- (ON CONFLICT DO NOTHING).
--
-- WHAT IT ADDS
--   1. press_campaigns: five columns, every one either nullable or with a
--      default, so rows written before this file read as "not filmed yet":
--        shots            every shot's takes, their checks and the person's
--                         decision (shots.ts ShotState[]), bounded 256 KB
--        film_charged_at  when filming was first charged
--        cut_due_at       the 24 h rule's clock (v2 #39): set when a press
--                         puts the machine to work on the film (Film,
--                         Re-film, Keep, Cut, Make the cut), cleared while
--                         the ad waits on the person and when it is ready
--        delivered_at     when the finished ad reached the person
--        assembly         the cut's working state (segments made, the end
--                         card, failures, the tag's language), bounded 32 KB
--      and an index for the 24 h rule's sweep. 03's stills bound grows to
--      128 KB (see "Sizes" below).
--   2. One switch, inserted OFF: press_tour_film. Filming spends provider
--      money on every shot, so it has its own switch beside press_tour:
--      off = the Film press answers "Filming isn't open yet" and nothing is
--      reserved. Admins only while CAMPAIGNS_OPEN_TO says so.
--   3. One setting: press_film_lane, the film lane's id, seeded 'kling-o3'
--      (video-models.ts, first-frame image-to-video, audio off). Only a lane
--      the quote prices may film (film.ts FILM_LANES); any other value keeps
--      filming closed.
--
-- MONEY: nothing here charges or refunds. Shots are reserved through the
-- existing reserve_generations (the quote's film line), and every refund goes
-- through the existing refund authority (job-runner.ts refundGenerationCosts).
-- No SECURITY DEFINER function is added.

begin;

-- ---------------------------------------------------------------------
-- 1. press_campaigns: the film, the press wall and the cut.
-- ---------------------------------------------------------------------
alter table public.press_campaigns add column if not exists shots jsonb not null default '[]'::jsonb;
alter table public.press_campaigns add column if not exists film_charged_at timestamptz;
alter table public.press_campaigns add column if not exists cut_due_at timestamptz;
alter table public.press_campaigns add column if not exists delivered_at timestamptz;
alter table public.press_campaigns add column if not exists assembly jsonb;

-- Sizes on the text form, CASE so the type is known before the length (the
-- 03 file's shape). Every existing row holds '[]' / null and passes.
--
-- Each bound sits above the most its parser can ever hand back (pinned by
-- src/lib/press-tour/bounds.test.ts), so the check stops a runaway writer
-- and never an ad: a refused write would leave the machine retrying the
-- same step every minute. Measured with every string at its parser maximum:
-- shots 6 shots x 5 takes = about 235 KB (a real 30 s ad with every shot
-- filmed five times is about 58 KB, over 03's old 32 KB); stills 6 x 8
-- attempts = about 79 KB (03 said 32 KB); assembly about 15 KB.
alter table public.press_campaigns drop constraint if exists press_campaigns_shots_size;
alter table public.press_campaigns add constraint press_campaigns_shots_size check (
  case when jsonb_typeof(shots) = 'array' then octet_length(shots::text) <= 262144 else false end
);
alter table public.press_campaigns drop constraint if exists press_campaigns_assembly_size;
alter table public.press_campaigns add constraint press_campaigns_assembly_size check (
  assembly is null
  or (case when jsonb_typeof(assembly) = 'object' then octet_length(assembly::text) <= 32768 else false end)
);
alter table public.press_campaigns drop constraint if exists press_campaigns_stills_size;
alter table public.press_campaigns add constraint press_campaigns_stills_size check (
  case when jsonb_typeof(stills) = 'array' then octet_length(stills::text) <= 131072 else false end
);
-- A delivered ad is a ready one, and a ready one owes nothing more.
alter table public.press_campaigns drop constraint if exists press_campaigns_delivered;
alter table public.press_campaigns add constraint press_campaigns_delivered check (
  (delivered_at is null or stage = 'ready') and (stage <> 'ready' or cut_due_at is null)
);

-- The 24 h rule's sweep (cut.ts lateCuts): ads we still owe a cut.
create index if not exists press_campaigns_cut_due
  on public.press_campaigns (cut_due_at)
  where cut_due_at is not null and deleted_at is null;

-- ---------------------------------------------------------------------
-- 2. The film switch, inserted OFF.
-- ---------------------------------------------------------------------
insert into public.feature_flags (key, enabled, description)
values (
  'press_tour_film',
  false,
  'Press Tour filming: the Film press, the checks on filmed shots, the cut and its delivery. Off = the Film press refuses and nothing is reserved. Needs press_tour. Admins only for now.'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 3. The film lane.
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value, description)
values (
  'press_film_lane',
  'kling-o3',
  'Press Tour: the lane that films each approved still (first frame, never reframed, audio off). Only a lane the Press Tour quote prices may be set; anything else keeps filming closed. Today: kling-o3.'
)
on conflict (key) do nothing;

commit;

-- ---------------------------------------------------------------------
-- 4. Verify. Fails loudly, naming what is wrong; changes nothing.
-- ---------------------------------------------------------------------
do $$
declare
  bad text;
begin
  select string_agg(col, ', ') into bad
  from unnest(array['shots', 'film_charged_at', 'cut_due_at', 'delivered_at', 'assembly']) col
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'press_campaigns' and column_name = col
  );
  if bad is not null then
    raise exception 'public.press_campaigns is missing: %', bad;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'press_campaigns' and column_name = 'shots'
      and (is_nullable <> 'NO' or column_default is null)
  ) then
    raise exception 'public.press_campaigns.shots must be NOT NULL with a default';
  end if;

  select string_agg(c, ', ') into bad
  from unnest(array['press_campaigns_shots_size', 'press_campaigns_assembly_size', 'press_campaigns_stills_size', 'press_campaigns_delivered']) c
  where not exists (select 1 from pg_constraint where conname = c);
  if bad is not null then
    raise exception 'press_campaigns constraints missing: %', bad;
  end if;

  -- The size bounds are this file's, not 03's older 32 KB.
  select string_agg(b.name, ', ') into bad
  from (values ('press_campaigns_shots_size', '262144'), ('press_campaigns_assembly_size', '32768'), ('press_campaigns_stills_size', '131072')) b(name, bytes)
  where not exists (
    select 1 from pg_constraint k
    where k.conname = b.name and k.conrelid = 'public.press_campaigns'::regclass
      and pg_get_constraintdef(k.oid) like '%' || b.bytes || '%'
  );
  if bad is not null then
    raise exception 'press_campaigns size bounds are not this file''s: %', bad;
  end if;

  -- Still zero policies and no reads for people (03's rule, unchanged).
  select string_agg(format('%s (%s)', policyname, cmd), '; ') into bad
  from pg_policies where schemaname = 'public' and tablename = 'press_campaigns';
  if bad is not null then
    raise exception 'public.press_campaigns must have no policies, but has: %', bad;
  end if;
  if has_table_privilege('authenticated', 'public.press_campaigns', 'SELECT')
     or has_table_privilege('anon', 'public.press_campaigns', 'SELECT') then
    raise exception 'people can read public.press_campaigns';
  end if;

  if not exists (select 1 from public.feature_flags where key = 'press_tour_film') then
    raise exception 'the press_tour_film switch is missing';
  end if;
  if exists (select 1 from public.feature_flags where key = 'press_tour_film' and enabled) then
    raise notice 'press_tour_film is already ON (left as it is)';
  end if;
  if not exists (select 1 from public.app_settings where key = 'press_film_lane') then
    raise exception 'the press_film_lane setting is missing';
  end if;
end $$;

-- One result (the SQL editor shows only the last one). Expect 7 rows: the
-- five columns, then the switch (false on the first paste) and the lane
-- (kling-o3).
select 'column' as kind, column_name as key, data_type || case when is_nullable = 'NO' then ' not null' else '' end as value
from information_schema.columns
where table_schema = 'public' and table_name = 'press_campaigns'
  and column_name in ('shots', 'film_charged_at', 'cut_due_at', 'delivered_at', 'assembly')
union all
select 'switch', key, enabled::text from public.feature_flags where key = 'press_tour_film'
union all
select 'setting', key, value from public.app_settings where key = 'press_film_lane'
order by 1, 2;
