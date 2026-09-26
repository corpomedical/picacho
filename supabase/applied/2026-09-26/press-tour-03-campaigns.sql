-- Press Tour, SQL 3 of the rollout: the campaign engine's record (Cut 2:
-- plan, stills, checks; RECORD-ONLY, no video yet). 2026-09-26; Spec v1
-- §1.4-§1.12 and §6 as changed by v2 (press-tour-synthesis.md §3.1 items 1,
-- 9, 11, 15, 17, 19, 22, 30, 40 and §3.4 Cut 2). Code: src/lib/press-tour/
-- campaign-types.ts (the stage list, pinned against this file by
-- campaign-machine.test.ts), campaign-machine.ts, paint.ts, planner.ts,
-- quote.ts, campaign-actions.ts, and the cron at src/app/api/cron/press.
--
-- RUN THIS BEFORE PUSHING THE CODE, after press-tour-00-hardening.sql,
-- press-tour-01-flags.sql and press-tour-02-products.sql. Idempotent: a
-- second paste is harmless.
--
-- WHAT IT ADDS
--   1. generations: four NULLABLE columns (press_tour, product_verdict,
--      product_gated_at, product_retries). Nullable on purpose and with no
--      default that matters: reserve_generation(s) build the row with
--      jsonb_populate_record and then INSERT ... VALUES (rec.*)
--      (schema.sql:1543-1560), so a NOT NULL column the caller leaves out
--      would fail every render in the product, not just Press Tour's.
--   2. press_campaigns: one row per ad. RLS ON with ZERO policies (synthesis
--      #30): people never read it directly; the server reads it with the
--      service role and hands the door a projection (campaign-actions.ts
--      CampaignView) that carries no lane, cost or raw score.
--   3. product_frame_checks: every frame the product checker reads (the
--      checker writes it: src/lib/product-lock/records.ts), for Admin's
--      calibration view only. RLS ON, ZERO policies.
--   4. character_ad_consents: "this is me / I have this person's permission,
--      and they may appear in ads for products I sell", for exactly the
--      character's current photos. People read their own; the server writes.
--   5. claim_press_campaigns(limit, campaign): the cron's and every kick's
--      claim, oldest first, FOR UPDATE SKIP LOCKED, with a 6-minute lease
--      (critique #19). SECURITY DEFINER, the service role's alone.
--
-- MONEY: nothing here charges or refunds. Stills are reserved through the
-- existing reserve_generations (a zero-credit "house" row is accepted as it
-- is: schema.sql:1581-1587, so no reserve_house_generation is needed), and
-- refunds go through the existing refund authority. product_gated_at is the
-- settlement marker for a later cut (refunds stay OFF until calibration and
-- the operator's yes); nothing writes it in Cut 2.

begin;

-- ---------------------------------------------------------------------
-- 1. generations: what a Press Tour row is, and its product verdict.
-- ---------------------------------------------------------------------
-- {campaign_id, shot, role, kind: still | shot | reshoot | cut, attempt,
--  house, trial_id}: src/lib/press-tour/paint.ts pressRowPayload, bounded.
alter table public.generations add column if not exists press_tour jsonb;
-- The product check's word: match | didnt_match | not_readable |
-- product_missing | not_checked (campaign-types.ts Verdict). Only the word:
-- per-frame scores live in product_frame_checks, which people cannot read.
alter table public.generations add column if not exists product_verdict text;
-- The settlement marker for a confirmed product miss (a later cut): written
-- once, before any refund, and never beside identity_gated_at.
alter table public.generations add column if not exists product_gated_at timestamptz;
-- How many checker-driven repaints / re-shoots this row has had.
alter table public.generations add column if not exists product_retries smallint;

-- NOT VALID: every existing row is NULL in these new columns and passes; NOT
-- VALID binds every new write without holding a scan lock on the table.
alter table public.generations drop constraint if exists generations_press_tour_check;
alter table public.generations add constraint generations_press_tour_check check (
  press_tour is null
  or (case when jsonb_typeof(press_tour) = 'object' then octet_length(press_tour::text) <= 2048 else false end)
) not valid;
alter table public.generations drop constraint if exists generations_product_verdict_check;
alter table public.generations add constraint generations_product_verdict_check check (
  product_verdict is null
  or product_verdict in ('match', 'didnt_match', 'not_readable', 'product_missing', 'not_checked')
) not valid;
alter table public.generations drop constraint if exists generations_product_retries_check;
alter table public.generations add constraint generations_product_retries_check check (
  product_retries is null or product_retries between 0 and 10
) not valid;

-- "Which rows belong to this campaign" (History's Press Tour filter, the
-- machine's own reads).
create index if not exists generations_press_tour_idx
  on public.generations using gin (press_tour jsonb_path_ops)
  where press_tour is not null;

-- ---------------------------------------------------------------------
-- 2. press_campaigns: one row per ad, driven by the stage machine
--    (campaign-machine.ts). Every write is the server's.
-- ---------------------------------------------------------------------
create table if not exists public.press_campaigns (
  -- made from send_id (campaign-machine.ts pressCampaignId), so a second
  -- delivery of the same "Plan" press meets the first one's row
  id                    uuid primary key,
  user_id               uuid not null references public.profiles (id) on delete cascade,
  -- where it was started: door | generate | producer | mcp | trial
  source                text not null default 'door',
  -- the client-made id of the press that started it; never reused
  send_id               uuid not null unique,
  product_id            uuid not null references public.products (id) on delete cascade,
  brand_kit_id          uuid references public.brand_kits (id) on delete set null,
  -- the star(s): 1 to 4 of the owner's own characters
  character_ids         uuid[] not null,
  -- the free trial ad's slot (a later cut): a plain uuid now, its FK later (critique #40)
  trial_id              uuid,
  -- the MCP grant it came through (a later cut): a plain uuid now, its FK later
  mcp_grant_id          uuid,
  platforms             text[] not null default '{}',
  aspect                text not null default '9:16',
  length_s              smallint not null default 15,
  -- what the person asked for, their own words (data, never instructions)
  goal                  text,
  -- the storyboard (planner.ts AdPlan), bounded
  plan                  jsonb,
  -- the server's price (quote.ts PressQuote), bounded
  quote                 jsonb,
  -- every still and every attempt at it (campaign-machine.ts StillState[])
  stills                jsonb not null default '[]'::jsonb,
  stage                 text not null default 'draft',
  stage_changed_at      timestamptz not null default now(),
  progress              text,
  -- the machine's lease (claim_press_campaigns); null = nobody is working it
  locked_at             timestamptz,
  -- claims so far (ticks), for Admin
  attempts              integer not null default 0,
  -- optimistic concurrency: the guard adds 1 on every update, and every
  -- writer updates "where version = what it read"
  version               integer not null default 0,
  -- the generations rows of its stills and shots, in order
  keyframe_ids          uuid[] not null default '{}',
  shot_ids              uuid[] not null default '{}',
  master_generation_id  uuid references public.generations (id) on delete set null,
  renditions            jsonb,
  product_verdict       text,
  reshoots_used         smallint not null default 0,
  cost_usd              numeric(10, 4) not null default 0,
  credits_charged       integer not null default 0,
  credits_refunded      integer not null default 0,
  -- plain words, English (i18n/server-text.ts maps them), when stage = failed
  error                 text,
  -- a campaign waiting on the person closes itself after this (7 days)
  expires_at            timestamptz,
  -- when Admin was told this campaign is stuck (once per stage)
  overdue_notified_at   timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  constraint press_campaigns_source check (source in ('door', 'generate', 'producer', 'mcp', 'trial')),
  constraint press_campaigns_stage check (stage in (
    'draft', 'planned', 'painting', 'checking_keyframes', 'awaiting_approval', 'animating',
    'checking_shots', 'assembling', 'signing', 'ready', 'failed', 'cancelled', 'expired'
  )),
  constraint press_campaigns_aspect check (aspect = '9:16'),
  constraint press_campaigns_length check (length_s in (10, 15, 30)),
  constraint press_campaigns_characters check (
    cardinality(character_ids) between 1 and 4 and array_position(character_ids, null) is null
  ),
  constraint press_campaigns_platforms check (
    cardinality(platforms) <= 6 and array_position(platforms, null) is null
  ),
  constraint press_campaigns_goal_len check (goal is null or char_length(goal) <= 500),
  constraint press_campaigns_progress_len check (progress is null or char_length(progress) <= 200),
  constraint press_campaigns_error_len check (error is null or char_length(error) <= 500),
  -- Sizes on the text form, CASE so the type is known before the length.
  constraint press_campaigns_plan_size check (
    plan is null
    or (case when jsonb_typeof(plan) = 'object' then octet_length(plan::text) <= 32768 else false end)
  ),
  constraint press_campaigns_quote_size check (
    quote is null
    or (case when jsonb_typeof(quote) = 'object' then octet_length(quote::text) <= 4096 else false end)
  ),
  constraint press_campaigns_stills_size check (
    case when jsonb_typeof(stills) = 'array' then octet_length(stills::text) <= 32768 else false end
  ),
  constraint press_campaigns_renditions_size check (
    renditions is null
    or (case when jsonb_typeof(renditions) = 'object' then octet_length(renditions::text) <= 8192 else false end)
  ),
  constraint press_campaigns_keyframes check (
    cardinality(keyframe_ids) <= 64 and array_position(keyframe_ids, null) is null
  ),
  constraint press_campaigns_shots check (
    cardinality(shot_ids) <= 32 and array_position(shot_ids, null) is null
  ),
  constraint press_campaigns_product_verdict check (
    product_verdict is null
    or product_verdict in ('match', 'didnt_match', 'not_readable', 'product_missing', 'not_checked')
  ),
  constraint press_campaigns_counts check (
    attempts >= 0 and version >= 0 and reshoots_used between 0 and 12
    and credits_charged >= 0 and credits_refunded >= 0 and cost_usd >= 0
  ),
  -- a failed campaign says why
  constraint press_campaigns_failed_error check (stage <> 'failed' or error is not null)
);

create index if not exists press_campaigns_user
  on public.press_campaigns (user_id, updated_at desc)
  where deleted_at is null;
-- the cron's work list (claim_press_campaigns)
create index if not exists press_campaigns_working
  on public.press_campaigns (updated_at)
  where deleted_at is null
    and stage in ('painting', 'checking_keyframes', 'animating', 'checking_shots', 'assembling', 'signing');
-- campaigns waiting on the person, which close at expires_at
create index if not exists press_campaigns_waiting
  on public.press_campaigns (expires_at)
  where deleted_at is null and stage in ('planned', 'awaiting_approval');

alter table public.press_campaigns enable row level security;

-- ZERO policies: nobody reads or writes this table with their own session.
-- (A policy added here by hand would be caught by the verify block below.)
revoke all on public.press_campaigns from public, anon, authenticated;
grant all on public.press_campaigns to service_role;

-- The guard. A plain trigger function (not SECURITY DEFINER; a trigger
-- function cannot be called as an RPC). It runs on the server's writes,
-- which bypass RLS, and holds what code alone should not be trusted with:
-- the owner, the send id and the product never change; a closed campaign
-- stays closed; the product (confirmed, when the campaign is made), the
-- brand kit, every star and every generations row it names are the owner's
-- own; and every update bumps version, updated_at and (on a stage change)
-- stage_changed_at, so the optimistic writers and the overdue check can
-- trust them.
create or replace function public.press_campaigns_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'a campaign cannot change owner';
    end if;
    if new.send_id is distinct from old.send_id then
      raise exception 'a campaign keeps the send id it was made with';
    end if;
    if new.product_id is distinct from old.product_id then
      raise exception 'a campaign keeps its product';
    end if;
    if old.stage in ('failed', 'cancelled', 'expired') and new.stage is distinct from old.stage then
      raise exception 'a closed campaign stays closed';
    end if;
    new.version := old.version + 1;
    new.updated_at := now();
    if new.stage is distinct from old.stage then
      new.stage_changed_at := now();
      new.overdue_notified_at := null;
    end if;
  else
    new.version := 0;
    new.stage_changed_at := now();
    if not exists (
      select 1 from public.products p
      where p.id = new.product_id and p.user_id = new.user_id
        and p.status = 'confirmed' and p.deleted_at is null
    ) then
      raise exception 'a campaign''s product must be one of the owner''s own confirmed products';
    end if;
  end if;

  if new.brand_kit_id is not null
     and (tg_op = 'INSERT' or new.brand_kit_id is distinct from old.brand_kit_id)
     and not exists (
       select 1 from public.brand_kits b
       where b.id = new.brand_kit_id and b.user_id = new.user_id and b.deleted_at is null
     ) then
    raise exception 'a campaign''s brand kit must be one of the owner''s own';
  end if;

  if (tg_op = 'INSERT' or new.character_ids is distinct from old.character_ids)
     and exists (
       select 1 from unnest(new.character_ids) as star(id)
       where not exists (
         select 1 from public.character_profiles cp where cp.id = star.id and cp.user_id = new.user_id
       )
     ) then
    raise exception 'every star of a campaign must be one of the owner''s own characters';
  end if;

  if (tg_op = 'INSERT' or new.keyframe_ids is distinct from old.keyframe_ids or new.shot_ids is distinct from old.shot_ids)
     and exists (
       select 1 from unnest(new.keyframe_ids || new.shot_ids) as row_ref(id)
       where not exists (
         select 1 from public.generations g where g.id = row_ref.id and g.user_id = new.user_id
       )
     ) then
    raise exception 'every still and shot of a campaign must be one of the owner''s own renders';
  end if;

  if new.master_generation_id is not null
     and (tg_op = 'INSERT' or new.master_generation_id is distinct from old.master_generation_id)
     and not exists (
       select 1 from public.generations g where g.id = new.master_generation_id and g.user_id = new.user_id
     ) then
    raise exception 'a campaign''s cut must be one of the owner''s own renders';
  end if;

  return new;
end
$function$;

drop trigger if exists trg_press_campaigns_guard on public.press_campaigns;
create trigger trg_press_campaigns_guard
  before insert or update on public.press_campaigns
  for each row execute function public.press_campaigns_guard();

-- ---------------------------------------------------------------------
-- 3. product_frame_checks: one row per frame the product checker reads (a
--    painted still, a moment read from a filmed shot, a reference photo in
--    the card self-test, a bake-off or seeded frame), for Admin's score
--    distribution and hand labels (calibration: spec §7.4, synthesis §3.4
--    Cut 9). RLS ON, ZERO policies: people see only the verdict word on
--    their own campaign, never these numbers (#30). The checker writes it
--    (src/lib/product-lock/records.ts; its FRAME_CHECK_COLUMNS are exactly
--    the columns below, pinned by campaign-machine.test.ts). campaign_id is
--    a plain uuid: the reading outlives its campaign for calibration.
-- ---------------------------------------------------------------------
create table if not exists public.product_frame_checks (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  user_id             uuid not null references public.profiles (id) on delete cascade,
  product_id          uuid references public.products (id) on delete set null,
  campaign_id         uuid,
  -- the still's or the shot's row
  generation_id       uuid references public.generations (id) on delete set null,
  source              text not null,
  shot                smallint,
  -- 0-based, within the shot
  moment              smallint,
  at_seconds          numeric(6, 2),
  visibility          text,
  frame_verdict       text not null,
  shot_verdict        text not null,
  -- the plain sentence shown beside the verdict (English)
  reason              text,
  presence            text,
  coverage            real,
  judge_verdict       text,
  judge_confidence    smallint,
  escalated           boolean not null default false,
  escalation_verdict  text,
  ocr_best            real,
  ocr_conflict        text,
  face_score          smallint,
  -- the render lane, for Admin's per-lane view; never shown to a customer
  lane                text,
  -- a kept frame (an admin's own, or a bake-off's), press-kit <user>/checks/...
  frame_path          text,
  scorer_version      text not null,
  cost_usd            numeric(10, 6) not null default 0,
  -- everything the readers said, bounded (never shown to people)
  signals             jsonb not null default '{}'::jsonb,
  -- Admin's hand label, for calibration
  label               text,
  labelled_by         uuid references public.profiles (id) on delete set null,
  labelled_at         timestamptz,
  constraint product_frame_checks_source check (source in ('still', 'moment', 'self_test', 'bakeoff', 'seeded')),
  constraint product_frame_checks_shot check (shot is null or shot between 1 and 32),
  constraint product_frame_checks_moment check (moment is null or moment between 0 and 64),
  constraint product_frame_checks_at check (at_seconds is null or at_seconds between 0 and 600),
  constraint product_frame_checks_visibility check (
    visibility is null or visibility in ('required_label', 'required_shape', 'absent')
  ),
  constraint product_frame_checks_frame_verdict check (
    frame_verdict in ('match', 'didnt_match', 'not_readable', 'absent', 'excluded', 'not_checked')
  ),
  constraint product_frame_checks_shot_verdict check (
    shot_verdict in ('match', 'didnt_match', 'not_readable', 'product_missing', 'not_checked', 'no_one_in_shot')
  ),
  constraint product_frame_checks_reason_len check (reason is null or char_length(reason) <= 200),
  constraint product_frame_checks_presence check (presence is null or presence in ('yes', 'no', 'unclear')),
  constraint product_frame_checks_coverage check (coverage is null or (coverage >= 0 and coverage <= 1)),
  constraint product_frame_checks_judge_verdict check (
    judge_verdict is null or judge_verdict in ('match', 'mismatch', 'not_readable')
  ),
  constraint product_frame_checks_escalation_verdict check (
    escalation_verdict is null or escalation_verdict in ('match', 'mismatch', 'not_readable')
  ),
  constraint product_frame_checks_scores check (
    (judge_confidence is null or judge_confidence between 0 and 100)
    and (face_score is null or face_score between 0 and 100)
    and (ocr_best is null or (ocr_best >= 0 and ocr_best <= 1))
  ),
  constraint product_frame_checks_ocr_conflict_len check (ocr_conflict is null or char_length(ocr_conflict) <= 80),
  constraint product_frame_checks_lane_len check (lane is null or char_length(lane) <= 64),
  constraint product_frame_checks_frame_path_len check (frame_path is null or char_length(frame_path) <= 512),
  constraint product_frame_checks_scorer_len check (char_length(scorer_version) between 1 and 120),
  constraint product_frame_checks_cost check (cost_usd >= 0),
  constraint product_frame_checks_signals_size check (
    case when jsonb_typeof(signals) = 'object' then octet_length(signals::text) <= 8192 else false end
  ),
  constraint product_frame_checks_label check (label is null or label in ('correct', 'wrong', 'not_readable'))
);

create index if not exists product_frame_checks_created on public.product_frame_checks (created_at desc);
create index if not exists product_frame_checks_product on public.product_frame_checks (product_id);
create index if not exists product_frame_checks_label on public.product_frame_checks (label);
create index if not exists product_frame_checks_campaign
  on public.product_frame_checks (campaign_id, shot)
  where campaign_id is not null;

alter table public.product_frame_checks enable row level security;
revoke all on public.product_frame_checks from public, anon, authenticated;
grant all on public.product_frame_checks to service_role;

-- A reading can only be filed against the owner's own campaign, render,
-- product and folder (the frame's picture sits under <owner>/checks/).
create or replace function public.product_frame_checks_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'a product check cannot change owner';
  end if;
  if new.campaign_id is not null
     and (tg_op = 'INSERT' or new.campaign_id is distinct from old.campaign_id)
     and not exists (select 1 from public.press_campaigns c where c.id = new.campaign_id and c.user_id = new.user_id) then
    raise exception 'a product check must belong to one of the owner''s own campaigns';
  end if;
  if new.generation_id is not null
     and (tg_op = 'INSERT' or new.generation_id is distinct from old.generation_id)
     and not exists (select 1 from public.generations g where g.id = new.generation_id and g.user_id = new.user_id) then
    raise exception 'a product check must belong to one of the owner''s own renders';
  end if;
  if new.product_id is not null
     and (tg_op = 'INSERT' or new.product_id is distinct from old.product_id)
     and not exists (select 1 from public.products p where p.id = new.product_id and p.user_id = new.user_id) then
    raise exception 'a product check must belong to one of the owner''s own products';
  end if;
  if new.frame_path is not null
     and (position(new.user_id::text || '/checks/' in new.frame_path) <> 1 or new.frame_path like '%..%') then
    raise exception 'a kept frame must be under the owner''s own checks folder';
  end if;
  return new;
end
$function$;

drop trigger if exists trg_product_frame_checks_guard on public.product_frame_checks;
create trigger trg_product_frame_checks_guard
  before insert or update on public.product_frame_checks
  for each row execute function public.product_frame_checks_guard();

-- ---------------------------------------------------------------------
-- 4. character_ad_consents (critique #9): who is in a character's photos
--    AND that they may appear in ads for products the person sells, for
--    exactly those photos (photos_hash, characters/likeness.ts). The
--    character_likeness_consents shape. A row exists only as a yes
--    (ads_ok is always true); a new photo asks again. 'not_a_person' is
--    kept for a drawn, 3D or AI-made star, so the stills gate has one shape.
--    Written only by the server; people read their own.
-- ---------------------------------------------------------------------
create table if not exists public.character_ad_consents (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  -- the character asked about; kept as a record when the character is deleted
  character_id    uuid references public.character_profiles (id) on delete set null,
  answer          text not null,
  ads_ok          boolean not null,
  photos_hash     text not null,
  -- the notice shown, set by the server, never by the page
  notice_version  text not null,
  locale          text not null,
  method          text not null,
  place           text not null,
  -- the requesting address, hashed; null when none was available
  ip_hash         text,
  consented_at    timestamptz not null default now(),
  constraint character_ad_consents_answer check (answer in ('me', 'permission', 'not_a_person')),
  constraint character_ad_consents_yes check (ads_ok),
  constraint character_ad_consents_place check (place in ('door', 'generate', 'producer', 'mcp')),
  constraint character_ad_consents_photos_hash_len check (char_length(photos_hash) between 1 and 64),
  constraint character_ad_consents_notice_len check (char_length(notice_version) between 1 and 32),
  constraint character_ad_consents_locale_len check (char_length(locale) between 1 and 16),
  constraint character_ad_consents_method_len check (char_length(method) between 1 and 32),
  constraint character_ad_consents_ip_hash_len check (ip_hash is null or char_length(ip_hash) <= 128)
);

create index if not exists character_ad_consents_character
  on public.character_ad_consents (character_id, consented_at desc);

alter table public.character_ad_consents enable row level security;

drop policy if exists "Read own ad consents" on public.character_ad_consents;
create policy "Read own ad consents" on public.character_ad_consents
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.character_ad_consents from public, anon, authenticated;
grant select on public.character_ad_consents to authenticated;
grant all on public.character_ad_consents to service_role;

create or replace function public.character_ad_consents_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' then
    -- Append-only. The one update allowed is the database's own: the
    -- character deleted, character_id set to null (the record stays).
    if new.user_id is distinct from old.user_id
       or new.answer is distinct from old.answer
       or new.ads_ok is distinct from old.ads_ok
       or new.photos_hash is distinct from old.photos_hash
       or new.notice_version is distinct from old.notice_version
       or new.consented_at is distinct from old.consented_at
       or (new.character_id is distinct from old.character_id and new.character_id is not null) then
      raise exception 'an ad consent is a record and is not changed';
    end if;
    return new;
  end if;
  if new.character_id is not null
     and not exists (
       select 1 from public.character_profiles cp where cp.id = new.character_id and cp.user_id = new.user_id
     ) then
    raise exception 'an ad consent must be about one of the owner''s own characters';
  end if;
  return new;
end
$function$;

drop trigger if exists trg_character_ad_consents_guard on public.character_ad_consents;
create trigger trg_character_ad_consents_guard
  before insert or update on public.character_ad_consents
  for each row execute function public.character_ad_consents_guard();

-- ---------------------------------------------------------------------
-- 5. claim_press_campaigns: the cron's claim (every minute) and every kick's
--    (after a press, by id). Oldest first; FOR UPDATE SKIP LOCKED, so two
--    callers never take the same campaign; a 6-minute lease (critique #19:
--    a still is painted and checked well inside it, and a caller that died
--    mid-step frees the campaign for the next tick). Only campaigns in a
--    stage the machine works are claimed: one waiting on the person
--    (planned, awaiting_approval) or closed is never touched here.
--    Returns what the claimer needs to write back under the lease:
--    version (the optimistic check) and locked_at (the lease's token).
--    SECURITY DEFINER, and the service role's alone.
-- ---------------------------------------------------------------------
create or replace function public.claim_press_campaigns(p_limit integer, p_campaign uuid default null)
returns table (id uuid, user_id uuid, stage text, version integer, locked_at timestamptz)
language plpgsql
security definer
set search_path to ''
as $function$
#variable_conflict use_column
begin
  return query
  update public.press_campaigns as c
     set locked_at = now(),
         attempts = c.attempts + 1
   where c.id in (
     select d.id
       from public.press_campaigns as d
      where d.deleted_at is null
        and d.stage in ('painting', 'checking_keyframes', 'animating', 'checking_shots', 'assembling', 'signing')
        and (d.locked_at is null or d.locked_at < now() - interval '6 minutes')
        and (p_campaign is null or d.id = p_campaign)
      order by d.updated_at
      limit least(greatest(coalesce(p_limit, 1), 1), 25)
      for update skip locked
   )
  returning c.id, c.user_id, c.stage, c.version, c.locked_at;
end
$function$;

revoke all on function public.claim_press_campaigns(integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_press_campaigns(integer, uuid) to service_role;

commit;

-- ---------------------------------------------------------------------
-- 6. Verify. Fails loudly, naming what is wrong; changes nothing.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  bad text;
  role_name text;
begin
  -- The four generations columns are there, and every one is nullable
  -- (reserve_generation inserts VALUES (rec.*)).
  select string_agg(col, ', ') into bad
  from unnest(array['press_tour', 'product_verdict', 'product_gated_at', 'product_retries']) col
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'generations' and column_name = col and is_nullable = 'YES'
  );
  if bad is not null then
    raise exception 'public.generations is missing (or has NOT NULL): %', bad;
  end if;

  -- RLS on for all three tables; nobody but the server writes them.
  foreach t in array array['press_campaigns', 'product_frame_checks', 'character_ad_consents'] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relrowsecurity
    ) then
      raise exception 'RLS is not on for public.%', t;
    end if;
    foreach role_name in array array['anon', 'authenticated'] loop
      if has_table_privilege(role_name, format('public.%I', t), 'INSERT, UPDATE, DELETE, TRUNCATE') then
        raise exception '% can still write public.%', role_name, t;
      end if;
    end loop;
  end loop;

  -- press_campaigns and product_frame_checks: ZERO policies, and no read
  -- privilege for people (read through the server's projection only).
  foreach t in array array['press_campaigns', 'product_frame_checks'] loop
    select string_agg(format('%s (%s)', policyname, cmd), '; ') into bad
    from pg_policies where schemaname = 'public' and tablename = t;
    if bad is not null then
      raise exception 'public.% must have no policies, but has: %', t, bad;
    end if;
    foreach role_name in array array['anon', 'authenticated'] loop
      if has_table_privilege(role_name, format('public.%I', t), 'SELECT') then
        raise exception '% can still read public.%', role_name, t;
      end if;
    end loop;
  end loop;

  -- character_ad_consents: read-own only.
  select string_agg(format('%s (%s)', policyname, cmd), '; ') into bad
  from pg_policies
  where schemaname = 'public' and tablename = 'character_ad_consents' and cmd <> 'SELECT';
  if bad is not null then
    raise exception 'public.character_ad_consents has a policy that writes: %', bad;
  end if;

  -- The guards are in place.
  select string_agg(tg, ', ') into bad
  from unnest(array[
    'trg_press_campaigns_guard', 'trg_product_frame_checks_guard', 'trg_character_ad_consents_guard'
  ]) tg
  where not exists (select 1 from pg_trigger where tgname = tg and not tgisinternal);
  if bad is not null then
    raise exception 'guards missing: %', bad;
  end if;

  -- The claim is SECURITY DEFINER and the service role's alone.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'claim_press_campaigns' and p.prosecdef
  ) then
    raise exception 'public.claim_press_campaigns is missing or not SECURITY DEFINER';
  end if;
  foreach role_name in array array['public', 'anon', 'authenticated'] loop
    if has_function_privilege(role_name, 'public.claim_press_campaigns(integer, uuid)', 'EXECUTE') then
      raise exception '% can execute public.claim_press_campaigns', role_name;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.claim_press_campaigns(integer, uuid)', 'EXECUTE') then
    raise exception 'service_role cannot execute public.claim_press_campaigns (the press cron needs it)';
  end if;
end $$;

-- One result (the SQL editor shows only the last one). Expect 4 rows: the
-- three tables with RLS on (press_campaigns and product_frame_checks with no
-- policies, character_ad_consents with its read-own policy), and the claim.
select 'table' as what,
       c.relname as name,
       case when c.relrowsecurity then 'RLS on' else 'RLS OFF' end as state,
       coalesce((select string_agg(p.cmd || ': ' || p.policyname, '; ' order by p.policyname)
                   from pg_policies p
                  where p.schemaname = 'public' and p.tablename = c.relname), 'no policies') as detail
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('press_campaigns', 'product_frame_checks', 'character_ad_consents')
union all
select 'function',
       p.proname,
       case when p.prosecdef then 'security definer' else 'INVOKER' end,
       'service_role only: ' || has_function_privilege('service_role', p.oid, 'EXECUTE')::text
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'claim_press_campaigns'
order by 1 desc, 2;
