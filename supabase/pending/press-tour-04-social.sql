-- Press Tour, SQL 4 of the rollout: publishing (Cut 5). 2026-09-26; Spec v1
-- §2 (one queue, consent records, token storage) as changed by v2
-- (press-tour-synthesis.md §3.1 items 8, 14, 23, 24, 26, 36 and §3.4 Cut 5).
-- Code: src/lib/social/ (vault.ts, store.ts, worker.ts, the four network
-- adapters), src/lib/press-tour/publish-types.ts, publish-actions.ts, the
-- connect callbacks under src/app/api/social/<network>/callback and the
-- posts clock at src/app/api/cron/press-posts.
--
-- RUN THIS BEFORE PUSHING THE CODE, after press-tour-00 .. 03. Idempotent: a
-- second paste is harmless.
--
-- WHAT IT ADDS
--   1. press_social_testers: who may post to a network that is still in
--      testing (TikTok before its audit, Instagram and Threads before Meta's
--      App Review) besides admins. The operator adds rows by hand in the SQL
--      editor. RLS ON, ZERO policies.
--   2. social_connections: one connected account per person per network
--      (the metadata only: handle, expiry, status). People read their own.
--   3. social_connection_secrets: the account's keys, sealed in the app with
--      AES-256-GCM (src/lib/social/vault.ts, SOCIAL_TOKEN_KEY_V<n>): only
--      ciphertext, iv, tag and the key version are stored here. RLS ON, ZERO
--      policies, nothing for people at all. Never app_settings (every
--      signed-in account can read it) and never the face_verifications
--      pattern (a plaintext token with an owner SELECT).
--   4. oauth_states: one row per "Connect" press, 10 minutes, single use,
--      bound to the person who pressed it (the callback refuses any other
--      session). Only the state's sha256 is kept. RLS ON, ZERO policies.
--   5. social_revocations: an account's key we still owe the network a
--      revoke for (a failed revoke at disconnect), retried by the posts
--      clock. Sealed like the secrets. RLS ON, ZERO policies.
--   6. scheduled_posts: every post, now or later, is one row; the posts clock
--      (every minute) claims due rows through claim_scheduled_posts. The
--      person's consent is recorded on the row (consent, payload_sha256):
--      the worker rebuilds the consented object from the row and refuses to
--      send when its hash differs. ai_label is NOT NULL and CHECKed TRUE:
--      no row can exist that posts without the platform's AI label.
--      RLS ON, ZERO policies: people read their posts through the server's
--      projection (publish-types.ts PostView), which carries no platform ids,
--      costs or raw errors (the press_campaigns rule, v2 #30).
--   7. claim_scheduled_posts(limit, post): oldest first, FOR UPDATE SKIP
--      LOCKED, a 6-minute lease. SECURITY DEFINER, the service role's alone.
--
-- NOTHING HERE TURNS POSTING ON. The switches were inserted OFF by
-- press-tour-01-flags.sql (press_tour_posting, press_post_x,
-- press_post_tiktok_direct, press_post_meta) and the app-wide X ceiling
-- press_x_daily_cap is '0' (no posts to X); this file adds no switch.
--
-- MONEY: nothing here charges anyone. Posting is included; what a post
-- costs us (X: $0.015 per video uploaded plus $0.015 per post without a
-- link) is recorded on the row in cost_usd.

begin;

-- ---------------------------------------------------------------------
-- 1. press_social_testers.
--    INSERT INTO public.press_social_testers (user_id, networks, note)
--    VALUES ('<profile id>', array['tiktok'], 'TikTok sandbox account');
-- ---------------------------------------------------------------------
create table if not exists public.press_social_testers (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  networks    text[] not null default '{}',
  note        text,
  created_at  timestamptz not null default now(),
  constraint press_social_testers_networks check (
    networks <@ array['x', 'tiktok', 'instagram', 'threads']::text[]
    and array_position(networks, null) is null
    and cardinality(networks) <= 4
  ),
  constraint press_social_testers_note_len check (note is null or char_length(note) <= 200)
);

alter table public.press_social_testers enable row level security;
revoke all on public.press_social_testers from public, anon, authenticated;
grant all on public.press_social_testers to service_role;

-- ---------------------------------------------------------------------
-- 2. social_connections: the account, not its keys.
-- ---------------------------------------------------------------------
create table if not exists public.social_connections (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles (id) on delete cascade,
  network              text not null,
  -- the network's own id for the account (X user id, TikTok open_id,
  -- Instagram professional account id, Threads user id)
  external_id          text not null,
  handle               text,
  display_name         text,
  scopes               text[] not null default '{}',
  status               text not null default 'connected',
  access_expires_at    timestamptz,
  refresh_expires_at   timestamptz,
  last_refreshed_at    timestamptz,
  -- the per-account lock for single-use refresh keys (X and TikTok rotate
  -- them): a refresh runs only while holding this lease
  refresh_lease_until  timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint social_connections_network check (network in ('x', 'tiktok', 'instagram', 'threads')),
  constraint social_connections_status check (status in ('connected', 'needs_reconnect')),
  constraint social_connections_external_id_len check (char_length(external_id) between 1 and 128),
  constraint social_connections_handle_len check (handle is null or char_length(handle) <= 100),
  constraint social_connections_display_name_len check (display_name is null or char_length(display_name) <= 200),
  constraint social_connections_scopes check (cardinality(scopes) <= 16 and array_position(scopes, null) is null),
  -- one account per network per person in v1; connecting another replaces it
  constraint social_connections_one_per_network unique (user_id, network)
);

-- the posts clock's refresh sweep (Instagram and Threads 60-day keys)
create index if not exists social_connections_expiring
  on public.social_connections (access_expires_at)
  where status = 'connected';

alter table public.social_connections enable row level security;

drop policy if exists "Read own social connections" on public.social_connections;
create policy "Read own social connections" on public.social_connections
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.social_connections from public, anon, authenticated;
grant select on public.social_connections to authenticated;
grant all on public.social_connections to service_role;

create or replace function public.social_connections_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'a connection cannot change owner';
    end if;
    if new.network is distinct from old.network then
      raise exception 'a connection keeps its network';
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$function$;

drop trigger if exists trg_social_connections_guard on public.social_connections;
create trigger trg_social_connections_guard
  before insert or update on public.social_connections
  for each row execute function public.social_connections_guard();

-- ---------------------------------------------------------------------
-- 3. social_connection_secrets: sealed keys only. The associated data of
--    each seal is "<connection id>|access" or "<connection id>|refresh", so
--    a ciphertext copied onto another row does not open.
-- ---------------------------------------------------------------------
create table if not exists public.social_connection_secrets (
  connection_id       uuid primary key references public.social_connections (id) on delete cascade,
  access_ciphertext   text not null,
  access_iv           text not null,
  access_tag          text not null,
  refresh_ciphertext  text,
  refresh_iv          text,
  refresh_tag         text,
  key_version         smallint not null,
  updated_at          timestamptz not null default now(),
  constraint social_connection_secrets_key_version check (key_version between 1 and 99),
  constraint social_connection_secrets_refresh_whole check (
    (refresh_ciphertext is null and refresh_iv is null and refresh_tag is null)
    or (refresh_ciphertext is not null and refresh_iv is not null and refresh_tag is not null)
  ),
  constraint social_connection_secrets_sizes check (
    char_length(access_ciphertext) <= 8192 and char_length(access_iv) <= 64 and char_length(access_tag) <= 64
    and (refresh_ciphertext is null or char_length(refresh_ciphertext) <= 8192)
    and (refresh_iv is null or char_length(refresh_iv) <= 64)
    and (refresh_tag is null or char_length(refresh_tag) <= 64)
  )
);

alter table public.social_connection_secrets enable row level security;
revoke all on public.social_connection_secrets from public, anon, authenticated;
grant all on public.social_connection_secrets to service_role;

-- ---------------------------------------------------------------------
-- 4. oauth_states: one per "Connect" press.
-- ---------------------------------------------------------------------
create table if not exists public.oauth_states (
  -- sha256 (hex) of the state handed to the network; the state itself is
  -- never stored
  state_hash     text primary key,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  network        text not null,
  -- the PKCE verifier (X); null for a network that takes none
  pkce_verifier  text,
  -- where the person goes back to: a path inside the app, checked by the code
  return_to      text not null default '/app/press-tour',
  expires_at     timestamptz not null,
  used_at        timestamptz,
  created_at     timestamptz not null default now(),
  constraint oauth_states_network check (network in ('x', 'tiktok', 'instagram', 'threads')),
  constraint oauth_states_hash_len check (char_length(state_hash) = 64),
  constraint oauth_states_verifier_len check (pkce_verifier is null or char_length(pkce_verifier) between 43 and 128),
  constraint oauth_states_return_to check (
    char_length(return_to) between 1 and 200 and return_to like '/app%' and position('//' in return_to) = 0
  ),
  constraint oauth_states_expiry check (expires_at <= created_at + interval '15 minutes')
);

create index if not exists oauth_states_expires on public.oauth_states (expires_at);

alter table public.oauth_states enable row level security;
revoke all on public.oauth_states from public, anon, authenticated;
grant all on public.oauth_states to service_role;

-- ---------------------------------------------------------------------
-- 5. social_revocations: revokes we still owe a network. user_id is a plain
--    uuid: the debt outlives the account (a deleted account's keys must
--    still be revoked).
-- ---------------------------------------------------------------------
create table if not exists public.social_revocations (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid,
  network            text not null,
  external_id        text not null,
  -- which key this is (the associated data of its seal is
  -- "revocation|<id>|<token_kind>")
  token_kind         text not null,
  token_ciphertext   text not null,
  token_iv           text not null,
  token_tag          text not null,
  key_version        smallint not null,
  attempts           integer not null default 0,
  next_attempt_at    timestamptz not null default now(),
  last_error         text,
  created_at         timestamptz not null default now(),
  constraint social_revocations_network check (network in ('x', 'tiktok', 'instagram', 'threads')),
  constraint social_revocations_kind check (token_kind in ('access', 'refresh')),
  constraint social_revocations_external_id_len check (char_length(external_id) between 1 and 128),
  constraint social_revocations_sizes check (
    char_length(token_ciphertext) <= 8192 and char_length(token_iv) <= 64 and char_length(token_tag) <= 64
  ),
  constraint social_revocations_key_version check (key_version between 1 and 99),
  constraint social_revocations_error_len check (last_error is null or char_length(last_error) <= 500)
);

create index if not exists social_revocations_due on public.social_revocations (next_attempt_at);

alter table public.social_revocations enable row level security;
revoke all on public.social_revocations from public, anon, authenticated;
grant all on public.social_revocations to service_role;

-- ---------------------------------------------------------------------
-- 6. scheduled_posts: the queue.
--
--    Stages: draft -> queued (consented) -> claimed -> uploading ->
--    media_ready -> publishing -> published. Beside them: retry (an upload
--    step failed; back in the queue at resume_at), failed, unconfirmed (the
--    platform's answer to the final call was lost: never sent again
--    blindly), needs_reconnect, platform_busy, cancelled.
--    Media is created at SEND time (Instagram containers die after 24 h, an
--    X media id after 86,400 s, a TikTok upload address after 1 h); every
--    platform id is written to external_ids the moment it exists, so a
--    resumed row continues from it.
-- ---------------------------------------------------------------------
create table if not exists public.scheduled_posts (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles (id) on delete cascade,
  campaign_id          uuid references public.press_campaigns (id) on delete set null,
  -- the campaign's cut (its master row), when there is one
  generation_id        uuid references public.generations (id) on delete set null,
  connection_id        uuid references public.social_connections (id) on delete set null,
  network              text not null,
  -- the account the person consented to post as (the connection's external_id then)
  account_external_id  text not null,
  -- 'clean' (TikTok: no tag, no logo) or 'tagged' (the small AI-generated tag)
  rendition            text not null,
  rendition_path       text not null,
  rendition_sha256     text not null,
  caption              text not null default '',
  hashtags             text[] not null default '{}',
  -- the exact text that posts: caption, hashtags and, on Threads, the
  -- visible "Made with AI" line
  final_text           text not null default '',
  -- the network's own choices (TikTok privacy and toggles, commercial
  -- content, "now" or "scheduled")
  options              jsonb not null default '{}'::jsonb,
  ai_label             boolean not null default true,
  -- {payload_sha256, handle, network, ui_version, locale, ip_hash, consented_at}
  consent              jsonb,
  payload_sha256       text,
  idempotency_key      text not null,
  stage                text not null default 'draft',
  scheduled_for        timestamptz,
  -- when a waiting step looks again (a container being processed, a retry's backoff)
  resume_at            timestamptz,
  locked_at            timestamptz,
  attempts             integer not null default 0,
  upload_attempts      smallint not null default 0,
  external_ids         jsonb not null default '{}'::jsonb,
  external_post_id     text,
  permalink            text,
  -- an English sentence the app maps (i18n/server-text.ts), never a platform's raw text
  last_error           text,
  cost_usd             numeric(10, 4) not null default 0,
  published_at         timestamptz,
  trend_derived        boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  constraint scheduled_posts_ai_label check (ai_label),
  constraint scheduled_posts_network check (network in ('x', 'tiktok', 'instagram', 'threads')),
  constraint scheduled_posts_rendition check (rendition in ('clean', 'tagged')),
  -- TikTok forbids watermarks and logos; everywhere else carries the tag
  constraint scheduled_posts_rendition_network check ((network = 'tiktok') = (rendition = 'clean')),
  constraint scheduled_posts_stage check (stage in (
    'draft', 'queued', 'claimed', 'uploading', 'media_ready', 'publishing', 'published',
    'retry', 'failed', 'unconfirmed', 'needs_reconnect', 'platform_busy', 'cancelled'
  )),
  -- TikTok never posts on a schedule (v2 S8): a TikTok row is always "now"
  constraint scheduled_posts_tiktok_now check (network <> 'tiktok' or options ->> 'when' = 'now'),
  constraint scheduled_posts_account_len check (char_length(account_external_id) between 1 and 128),
  constraint scheduled_posts_path_len check (char_length(rendition_path) between 1 and 512),
  constraint scheduled_posts_sha check (rendition_sha256 ~ '^[0-9a-f]{64}$'),
  constraint scheduled_posts_payload_sha check (payload_sha256 is null or payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint scheduled_posts_caption_len check (char_length(caption) <= 2200),
  constraint scheduled_posts_final_text_len check (char_length(final_text) <= 2400),
  constraint scheduled_posts_hashtags check (
    cardinality(hashtags) <= 30 and array_position(hashtags, null) is null
  ),
  constraint scheduled_posts_key_len check (char_length(idempotency_key) between 16 and 128),
  constraint scheduled_posts_error_len check (last_error is null or char_length(last_error) <= 500),
  constraint scheduled_posts_permalink_len check (permalink is null or char_length(permalink) <= 500),
  constraint scheduled_posts_post_id_len check (external_post_id is null or char_length(external_post_id) <= 128),
  constraint scheduled_posts_options_size check (
    case when jsonb_typeof(options) = 'object' then octet_length(options::text) <= 2048 else false end
  ),
  constraint scheduled_posts_consent_size check (
    consent is null
    or (case when jsonb_typeof(consent) = 'object' then octet_length(consent::text) <= 4096 else false end)
  ),
  constraint scheduled_posts_external_ids_size check (
    case when jsonb_typeof(external_ids) = 'object' then octet_length(external_ids::text) <= 4096 else false end
  ),
  -- a row past draft carries its consent (a draft may be cancelled unconsented)
  constraint scheduled_posts_consented check (
    stage in ('draft', 'cancelled')
    or (consent is not null and payload_sha256 is not null and scheduled_for is not null)
  ),
  constraint scheduled_posts_attempts check (attempts >= 0 and upload_attempts between 0 and 10)
);

create unique index if not exists scheduled_posts_idempotency on public.scheduled_posts (idempotency_key);

-- the clock's work list (claim_scheduled_posts)
create index if not exists scheduled_posts_due
  on public.scheduled_posts ((coalesce(resume_at, scheduled_for)))
  where deleted_at is null
    and stage in ('queued', 'retry', 'claimed', 'uploading', 'media_ready', 'publishing');
-- the sheet's list per campaign, and the caps (posts per person per network)
create index if not exists scheduled_posts_user_network
  on public.scheduled_posts (user_id, network, scheduled_for desc);
create index if not exists scheduled_posts_campaign
  on public.scheduled_posts (campaign_id, created_at desc);
-- the duplicate guard (the same account, the same cut, 30 days)
create index if not exists scheduled_posts_connection
  on public.scheduled_posts (connection_id, created_at desc);

alter table public.scheduled_posts enable row level security;

-- ZERO policies: read through the server's projection only.
revoke all on public.scheduled_posts from public, anon, authenticated;
grant all on public.scheduled_posts to service_role;

-- The guard. A plain trigger function (not SECURITY DEFINER). It holds
-- what code alone should not be trusted with: the owner, the network and
-- the idempotency key never change; the connection, the campaign and the cut
-- a post names are the owner's own (and the connection is of the post's
-- network); a closed post stays closed; and what the person consented to
-- (the words, the choices, the cut, the account, the time) never changes
-- once the row is queued: an edit goes back to draft, with a new consent.
create or replace function public.scheduled_posts_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'a post cannot change owner';
    end if;
    if new.network is distinct from old.network then
      raise exception 'a post keeps its network';
    end if;
    if new.idempotency_key is distinct from old.idempotency_key then
      raise exception 'a post keeps its idempotency key';
    end if;
    if old.stage in ('published', 'failed', 'unconfirmed', 'cancelled') and new.stage is distinct from old.stage then
      raise exception 'a closed post stays closed';
    end if;
    if old.stage <> 'draft' and new.stage <> 'draft' and (
         new.caption is distinct from old.caption
      or new.hashtags is distinct from old.hashtags
      or new.final_text is distinct from old.final_text
      or new.options is distinct from old.options
      or new.rendition is distinct from old.rendition
      or new.rendition_path is distinct from old.rendition_path
      or new.rendition_sha256 is distinct from old.rendition_sha256
      or new.account_external_id is distinct from old.account_external_id
      or new.payload_sha256 is distinct from old.payload_sha256
      or new.consent is distinct from old.consent
      or new.scheduled_for is distinct from old.scheduled_for
      or new.campaign_id is distinct from old.campaign_id and new.campaign_id is not null
      or new.connection_id is distinct from old.connection_id and new.connection_id is not null
    ) then
      raise exception 'what the person consented to cannot change; an edit goes back to draft';
    end if;
  end if;

  if new.connection_id is not null
     and (tg_op = 'INSERT' or new.connection_id is distinct from old.connection_id)
     and not exists (
       select 1 from public.social_connections c
       where c.id = new.connection_id and c.user_id = new.user_id and c.network = new.network
     ) then
    raise exception 'a post''s account must be one of the owner''s own, on the post''s network';
  end if;

  if new.campaign_id is not null
     and (tg_op = 'INSERT' or new.campaign_id is distinct from old.campaign_id)
     and not exists (
       select 1 from public.press_campaigns pc
       where pc.id = new.campaign_id and pc.user_id = new.user_id and pc.deleted_at is null
     ) then
    raise exception 'a post''s campaign must be one of the owner''s own';
  end if;

  if new.generation_id is not null
     and (tg_op = 'INSERT' or new.generation_id is distinct from old.generation_id)
     and not exists (
       select 1 from public.generations g where g.id = new.generation_id and g.user_id = new.user_id
     ) then
    raise exception 'a post''s cut must be one of the owner''s own renders';
  end if;

  if tg_op = 'INSERT' and new.stage not in ('draft', 'queued') then
    raise exception 'a post starts as a draft or queued';
  end if;

  new.updated_at := now();
  return new;
end
$function$;

drop trigger if exists trg_scheduled_posts_guard on public.scheduled_posts;
create trigger trg_scheduled_posts_guard
  before insert or update on public.scheduled_posts
  for each row execute function public.scheduled_posts_guard();

-- ---------------------------------------------------------------------
-- 7. claim_scheduled_posts: the posts clock's claim (every minute) and a
--    "Post now" kick's (by id). Oldest first; FOR UPDATE SKIP LOCKED, so
--    two callers never take the same post; a 6-minute lease (a post's step
--    budget is 4 minutes). It claims:
--      - a queued or retry row whose time has come (stage -> claimed);
--      - a row waiting on the platform (a container being processed, a
--        TikTok post being published) whose resume_at has come;
--      - a row whose worker died (lease older than 6 minutes): the worker
--        resumes an upload from the ids it stored, and a row that died in
--        'publishing' becomes 'unconfirmed' (the final call is never sent
--        twice), except a TikTok post whose publish id it can ask about.
--    Returns what the claimer writes back under the lease: locked_at (the
--    lease's token). SECURITY DEFINER, and the service role's alone.
-- ---------------------------------------------------------------------
create or replace function public.claim_scheduled_posts(p_limit integer, p_post uuid default null)
returns table (id uuid, user_id uuid, network text, stage text, locked_at timestamptz)
language plpgsql
security definer
set search_path to ''
as $function$
#variable_conflict use_column
begin
  return query
  update public.scheduled_posts as s
     set locked_at = now(),
         attempts = s.attempts + 1,
         stage = case when s.stage in ('queued', 'retry') then 'claimed' else s.stage end
   where s.id in (
     select d.id
       from public.scheduled_posts as d
      where d.deleted_at is null
        and (p_post is null or d.id = p_post)
        and (
          (d.stage in ('queued', 'retry')
             and coalesce(d.resume_at, d.scheduled_for) <= now()
             and (d.locked_at is null or d.locked_at < now() - interval '6 minutes'))
          or (d.stage in ('uploading', 'media_ready', 'publishing')
             and d.locked_at is null and d.resume_at is not null and d.resume_at <= now())
          or (d.stage in ('claimed', 'uploading', 'media_ready', 'publishing')
             and d.locked_at is not null and d.locked_at < now() - interval '6 minutes')
        )
      order by coalesce(d.resume_at, d.scheduled_for)
      limit least(greatest(coalesce(p_limit, 1), 1), 25)
      for update skip locked
   )
  returning s.id, s.user_id, s.network, s.stage, s.locked_at;
end
$function$;

revoke all on function public.claim_scheduled_posts(integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_scheduled_posts(integer, uuid) to service_role;

commit;

-- ---------------------------------------------------------------------
-- 8. Verify. Fails loudly, naming what is wrong; changes nothing.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  bad text;
  role_name text;
begin
  -- RLS on everywhere; nobody but the server writes.
  foreach t in array array[
    'press_social_testers', 'social_connections', 'social_connection_secrets',
    'oauth_states', 'social_revocations', 'scheduled_posts'
  ] loop
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

  -- The secret tables and the queue: ZERO policies, and no read privilege
  -- for people.
  foreach t in array array[
    'press_social_testers', 'social_connection_secrets', 'oauth_states', 'social_revocations', 'scheduled_posts'
  ] loop
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

  -- social_connections: read-own only.
  select string_agg(format('%s (%s)', policyname, cmd), '; ') into bad
  from pg_policies
  where schemaname = 'public' and tablename = 'social_connections' and cmd <> 'SELECT';
  if bad is not null then
    raise exception 'public.social_connections has a policy that writes: %', bad;
  end if;
  if has_table_privilege('anon', 'public.social_connections', 'SELECT') then
    raise exception 'anon can read public.social_connections';
  end if;

  -- No row can post without the AI label.
  if not exists (
    select 1 from pg_constraint
    where conname = 'scheduled_posts_ai_label' and conrelid = 'public.scheduled_posts'::regclass
  ) then
    raise exception 'scheduled_posts is missing its ai_label CHECK';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'scheduled_posts' and column_name = 'ai_label' and is_nullable = 'NO'
  ) then
    raise exception 'scheduled_posts.ai_label must be NOT NULL';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'scheduled_posts' and indexname = 'scheduled_posts_idempotency'
  ) then
    raise exception 'scheduled_posts is missing its unique idempotency key';
  end if;

  -- The guards are in place.
  select string_agg(tg, ', ') into bad
  from unnest(array['trg_social_connections_guard', 'trg_scheduled_posts_guard']) tg
  where not exists (select 1 from pg_trigger where tgname = tg and not tgisinternal);
  if bad is not null then
    raise exception 'guards missing: %', bad;
  end if;

  -- The claim is SECURITY DEFINER and the service role's alone.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'claim_scheduled_posts' and p.prosecdef
  ) then
    raise exception 'public.claim_scheduled_posts is missing or not SECURITY DEFINER';
  end if;
  foreach role_name in array array['public', 'anon', 'authenticated'] loop
    if has_function_privilege(role_name, 'public.claim_scheduled_posts(integer, uuid)', 'EXECUTE') then
      raise exception '% can execute public.claim_scheduled_posts', role_name;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.claim_scheduled_posts(integer, uuid)', 'EXECUTE') then
    raise exception 'service_role cannot execute public.claim_scheduled_posts (the posts clock needs it)';
  end if;

  -- The switches this cut reads were inserted by press-tour-01-flags.sql.
  select string_agg(k, ', ') into bad
  from unnest(array['press_tour_posting', 'press_post_x', 'press_post_tiktok_direct', 'press_post_meta']) k
  where not exists (select 1 from public.feature_flags f where f.key = k);
  if bad is not null then
    raise exception 'switches missing (paste press-tour-01-flags.sql first): %', bad;
  end if;
  if not exists (select 1 from public.app_settings s where s.key = 'press_x_daily_cap') then
    raise exception 'setting press_x_daily_cap missing (paste press-tour-01-flags.sql first)';
  end if;
end $$;

-- One result (the SQL editor shows only the last one). Expect 7 rows: the
-- six tables with RLS on (social_connections with its read-own policy, the
-- other five with no policies), and the claim.
select 'table' as what,
       c.relname as name,
       case when c.relrowsecurity then 'RLS on' else 'RLS OFF' end as state,
       coalesce((select string_agg(p.cmd || ': ' || p.policyname, '; ' order by p.policyname)
                   from pg_policies p
                  where p.schemaname = 'public' and p.tablename = c.relname), 'no policies') as detail
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'press_social_testers', 'social_connections', 'social_connection_secrets',
    'oauth_states', 'social_revocations', 'scheduled_posts'
  )
union all
select 'function',
       p.proname,
       case when p.prosecdef then 'security definer' else 'INVOKER' end,
       'service_role only: ' || has_function_privilege('service_role', p.oid, 'EXECUTE')::text
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'claim_scheduled_posts'
order by 1 desc, 2;
