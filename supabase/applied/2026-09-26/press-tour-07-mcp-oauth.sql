-- Press Tour, SQL 7 of the rollout: Picacho inside Claude and ChatGPT (Cut 8:
-- our own OAuth 2.1 authorization server for /api/mcp, and the one-time
-- codes behind Picacho's card). 2026-09-26; Spec v1 §4.2-§4.5 as changed by
-- v2 (press-tour-synthesis.md §3.1 items 5, 29, 30, 40 and §3.4 Cut 8).
-- Code: src/lib/mcp/oauth/store.ts (clients, pending authorizations,
-- grants, codes, tokens), src/lib/mcp/press/nonce.ts (mcp_ui_nonces), the
-- routes under src/app/api/oauth, src/app/oauth and src/app/.well-known,
-- and src/app/api/mcp/route.ts.
--
-- RUN THIS BEFORE PUSHING THE CODE, after press-tour-03-campaigns.sql (the
-- press_campaigns table must exist: its mcp_grant_id gets its foreign key
-- here). Idempotent: a second paste is harmless.
--
-- WHAT IT ADDS
--   1. oauth_clients: every app that may ask to connect — registered
--      (dynamic registration, kind 'dcr') or read from its client metadata
--      document (kind 'cimd', kept a day). Trust comes from the redirect
--      addresses alone: verified (Claude's and ChatGPT's own callbacks),
--      loopback (this computer), unverified (read only).
--   2. oauth_pending_authorizations: an authorization request, held on the
--      server while the person signs in; only its id travels through
--      sign-in and two-step (v2 #29). 15 minutes, answered once, and bound
--      to the first signed-in account that opens it.
--   3. oauth_grants: one live connection per account, app and resource;
--      Settings › Security › Connected apps lists and revokes these.
--   4. oauth_codes: authorization codes, HASHED, 5 minutes, single use,
--      bound to the client, redirect, PKCE challenge, resource and scopes.
--   5. oauth_tokens: access (1 h) and refresh (30 days, rotating) tokens,
--      HASHED, each in a family; a reused refresh token or code revokes the
--      whole family. Bound to the resource they were minted for (RFC 8707).
--   6. mcp_ui_nonces: the one-time codes only Picacho's card receives, HASHED,
--      15 minutes, single use, bound to the account, the ad, the step and
--      the quote (v2 #5). The only way start_ad and approve_stills run.
--   7. press_campaigns.mcp_grant_id gets its foreign key (critique #40: a
--      plain uuid until now).
--   8. oauth_revoked_families: every token family revoked for reuse (a code
--      or refresh token presented twice) or by the app's own revocation.
--      A family is marked BEFORE its rows are, and the token guard refuses
--      any new row in a marked family, so the winner of a refresh race can
--      never land a live pair after the loser revoked the family (fixer
--      2026-09-26, SEC-2). Kept 32 days, longer than any token it covers.
--   9. prune_oauth_clients(before, limit): the daily prune's removal of
--      apps that never connected (below).
--
-- HOUSEKEEPING: nothing here is kept for good. /api/cron/prune (daily)
-- runs lib/mcp/oauth/prune.ts pruneOAuthRecords: pending authorizations,
-- codes, tokens and card codes a day after they expire, revoked-family
-- marks after 32 days, and apps that registered (or were read from their
-- document) more than 30 days ago, never connected, and aren't disabled by
-- hand (fixer 2026-09-26, SEC-1). The expiry indexes below serve it.
--
-- SECURITY: every table has RLS ON and ZERO policies; people read nothing
-- here with their own session (Connected apps is read by the server,
-- filtered to the person). No secret is stored: codes, tokens and card
-- codes are SHA-256 hashes. No SECURITY DEFINER function is added (every
-- "once" is one conditional UPDATE from the service role). The guard
-- triggers below are plain functions; the one callable function,
-- prune_oauth_clients (section 9), runs with the CALLER's rights and its
-- EXECUTE is revoked from public, anon and authenticated (service role
-- only).
--
-- MONEY: nothing here charges or refunds.

begin;

-- ---------------------------------------------------------------------
-- 1. oauth_clients
-- ---------------------------------------------------------------------
create table if not exists public.oauth_clients (
  -- 'pmcp_c_…' for a registered client; the document's https URL for CIMD
  client_id             text primary key,
  kind                  text not null,
  client_name           text not null,
  client_uri            text,
  redirect_uris         text[] not null,
  trust                 text not null default 'unverified',
  -- what registration asked for (bounded; never shown to people)
  metadata              jsonb not null default '{}'::jsonb,
  -- the registering address, hashed; null for CIMD
  registration_ip_hash  text,
  -- CIMD: when the document was last read (re-read after a day)
  fetched_at            timestamptz,
  -- set by hand to stop an app connecting (its tokens stop working too)
  disabled_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint oauth_clients_kind check (kind in ('dcr', 'cimd')),
  constraint oauth_clients_trust check (trust in ('verified', 'loopback', 'unverified')),
  constraint oauth_clients_id_len check (char_length(client_id) between 8 and 512),
  constraint oauth_clients_cimd_https check (kind <> 'cimd' or client_id like 'https://%'),
  constraint oauth_clients_name_len check (char_length(client_name) between 1 and 100),
  constraint oauth_clients_uri_len check (client_uri is null or char_length(client_uri) <= 512),
  constraint oauth_clients_redirects check (
    cardinality(redirect_uris) between 1 and 10 and array_position(redirect_uris, null) is null
  ),
  constraint oauth_clients_metadata_size check (
    case when jsonb_typeof(metadata) = 'object' then octet_length(metadata::text) <= 4096 else false end
  ),
  constraint oauth_clients_ip_hash_len check (registration_ip_hash is null or char_length(registration_ip_hash) <= 128)
);

-- ---------------------------------------------------------------------
-- 2. oauth_pending_authorizations
-- ---------------------------------------------------------------------
create table if not exists public.oauth_pending_authorizations (
  id                     uuid primary key,
  client_id              text not null references public.oauth_clients (client_id) on delete cascade,
  redirect_uri           text not null,
  state                  text,
  code_challenge         text not null,
  code_challenge_method  text not null default 'S256',
  resource               text not null,
  scopes                 text[] not null,
  -- the first signed-in account to open it; from then on only that account may answer
  user_id                uuid references auth.users (id) on delete cascade,
  decision               text,
  created_at             timestamptz not null default now(),
  expires_at             timestamptz not null,
  used_at                timestamptz,
  constraint oauth_pending_redirect_len check (char_length(redirect_uri) between 1 and 512),
  constraint oauth_pending_state_len check (state is null or char_length(state) <= 1024),
  constraint oauth_pending_challenge check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  constraint oauth_pending_method check (code_challenge_method = 'S256'),
  constraint oauth_pending_resource_len check (char_length(resource) between 1 and 512),
  constraint oauth_pending_scopes check (
    cardinality(scopes) between 1 and 3 and scopes <@ array['read', 'brand', 'generate']::text[]
  ),
  constraint oauth_pending_decision check (decision is null or decision in ('approved', 'denied')),
  constraint oauth_pending_answered check ((used_at is null) = (decision is null))
);

create index if not exists oauth_pending_expires on public.oauth_pending_authorizations (expires_at);

-- ---------------------------------------------------------------------
-- 3. oauth_grants
-- ---------------------------------------------------------------------
create table if not exists public.oauth_grants (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  client_id     text not null references public.oauth_clients (client_id) on delete cascade,
  scopes        text[] not null,
  resource      text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  constraint oauth_grants_scopes check (
    cardinality(scopes) between 1 and 3 and scopes <@ array['read', 'brand', 'generate']::text[]
  ),
  constraint oauth_grants_resource_len check (char_length(resource) between 1 and 512)
);

-- One LIVE connection per account, app and resource (approving again renews it).
create unique index if not exists oauth_grants_one_live
  on public.oauth_grants (user_id, client_id, resource)
  where revoked_at is null;
create index if not exists oauth_grants_user on public.oauth_grants (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- 4. oauth_codes
-- ---------------------------------------------------------------------
create table if not exists public.oauth_codes (
  code_hash       text primary key,
  grant_id        uuid not null references public.oauth_grants (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  client_id       text not null,
  redirect_uri    text not null,
  code_challenge  text not null,
  resource        text not null,
  scopes          text[] not null,
  -- the token family this code minted (set when it is spent): a second use revokes it
  family_id       uuid,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  used_at         timestamptz,
  constraint oauth_codes_hash check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint oauth_codes_scopes check (
    cardinality(scopes) between 1 and 3 and scopes <@ array['read', 'brand', 'generate']::text[]
  ),
  constraint oauth_codes_spent check ((used_at is null) = (family_id is null))
);

create index if not exists oauth_codes_expires on public.oauth_codes (expires_at);

-- ---------------------------------------------------------------------
-- 5. oauth_tokens
-- ---------------------------------------------------------------------
create table if not exists public.oauth_tokens (
  token_hash   text primary key,
  kind         text not null,
  grant_id     uuid not null references public.oauth_grants (id) on delete cascade,
  family_id    uuid not null,
  user_id      uuid not null references auth.users (id) on delete cascade,
  client_id    text not null,
  scopes       text[] not null,
  resource     text not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  -- refresh: when it was rotated, and the hash of the one that replaced it
  used_at      timestamptz,
  replaced_by  text,
  revoked_at   timestamptz,
  constraint oauth_tokens_hash check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint oauth_tokens_kind check (kind in ('access', 'refresh')),
  constraint oauth_tokens_scopes check (
    cardinality(scopes) between 1 and 3 and scopes <@ array['read', 'brand', 'generate']::text[]
  ),
  constraint oauth_tokens_rotation check (kind = 'refresh' or (used_at is null and replaced_by is null)),
  constraint oauth_tokens_replaced_hash check (replaced_by is null or replaced_by ~ '^[0-9a-f]{64}$')
);

create index if not exists oauth_tokens_family on public.oauth_tokens (family_id);
create index if not exists oauth_tokens_grant on public.oauth_tokens (grant_id);
create index if not exists oauth_tokens_expires on public.oauth_tokens (expires_at);

-- ---------------------------------------------------------------------
-- 5b. oauth_revoked_families (the reuse alarm's memory)
-- ---------------------------------------------------------------------
create table if not exists public.oauth_revoked_families (
  family_id   uuid primary key,
  revoked_at  timestamptz not null default now()
);

create index if not exists oauth_revoked_families_at on public.oauth_revoked_families (revoked_at);

-- ---------------------------------------------------------------------
-- 6. mcp_ui_nonces
-- ---------------------------------------------------------------------
create table if not exists public.mcp_ui_nonces (
  nonce_hash     text primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  campaign_id    uuid not null references public.press_campaigns (id) on delete cascade,
  purpose        text not null,
  quote_total    integer not null,
  quote_paint    integer not null,
  quote_animate  integer not null,
  quote_version  integer not null,
  -- the connection it was minted for; null for an API-key caller
  grant_id       uuid references public.oauth_grants (id) on delete cascade,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  used_at        timestamptz,
  constraint mcp_ui_nonces_hash check (nonce_hash ~ '^[0-9a-f]{64}$'),
  -- 'film': an Approve on a card that showed the Film key and its price
  -- (the only code that may film; fixer 2026-09-26, MONEY-4)
  constraint mcp_ui_nonces_purpose check (purpose in ('paint', 'approve', 'film')),
  constraint mcp_ui_nonces_quote check (
    quote_total >= 0 and quote_paint >= 0 and quote_animate >= 0 and quote_version >= 0
  )
);

create index if not exists mcp_ui_nonces_user_expires on public.mcp_ui_nonces (user_id, expires_at);
create index if not exists mcp_ui_nonces_expires on public.mcp_ui_nonces (expires_at);

-- A table made by an earlier paste of this file keeps its old check: replace it.
alter table public.mcp_ui_nonces drop constraint if exists mcp_ui_nonces_purpose;
alter table public.mcp_ui_nonces
  add constraint mcp_ui_nonces_purpose check (purpose in ('paint', 'approve', 'film'));

-- ---------------------------------------------------------------------
-- RLS on, ZERO policies, the service role only
-- ---------------------------------------------------------------------
alter table public.oauth_clients enable row level security;
alter table public.oauth_pending_authorizations enable row level security;
alter table public.oauth_grants enable row level security;
alter table public.oauth_codes enable row level security;
alter table public.oauth_tokens enable row level security;
alter table public.mcp_ui_nonces enable row level security;
alter table public.oauth_revoked_families enable row level security;

revoke all on public.oauth_clients from public, anon, authenticated;
revoke all on public.oauth_pending_authorizations from public, anon, authenticated;
revoke all on public.oauth_grants from public, anon, authenticated;
revoke all on public.oauth_codes from public, anon, authenticated;
revoke all on public.oauth_tokens from public, anon, authenticated;
revoke all on public.mcp_ui_nonces from public, anon, authenticated;
revoke all on public.oauth_revoked_families from public, anon, authenticated;

grant all on public.oauth_clients to service_role;
grant all on public.oauth_pending_authorizations to service_role;
grant all on public.oauth_grants to service_role;
grant all on public.oauth_codes to service_role;
grant all on public.oauth_tokens to service_role;
grant all on public.mcp_ui_nonces to service_role;
grant all on public.oauth_revoked_families to service_role;

-- ---------------------------------------------------------------------
-- The guards (plain trigger functions, not SECURITY DEFINER: a trigger
-- function cannot be called as an RPC). What code alone should not be
-- trusted with: a code, token or card code belongs to its connection's own
-- account and app; a connection never changes hands; a token never widens.
-- ---------------------------------------------------------------------
-- One function per table: PL/pgSQL resolves every NEW.field an expression
-- names, so a shared function naming another table's column fails on every
-- write (caught proving this file on PGlite, 2026-09-26).

create or replace function public.oauth_grants_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.user_id is distinct from old.user_id
     or new.client_id is distinct from old.client_id
     or new.resource is distinct from old.resource
     or (old.revoked_at is not null and new.revoked_at is null) then
    raise exception 'a connection keeps its account, app and resource, and stays revoked';
  end if;
  return new;
end
$function$;

create or replace function public.oauth_codes_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.oauth_grants g
      where g.id = new.grant_id and g.user_id = new.user_id and g.client_id = new.client_id
        and g.resource = new.resource and g.revoked_at is null
    ) then
      raise exception 'a code must belong to a live connection of the same account, app and resource';
    end if;
    return new;
  end if;
  if new.code_hash is distinct from old.code_hash
     or new.grant_id is distinct from old.grant_id
     or new.user_id is distinct from old.user_id
     or (old.used_at is not null and new.used_at is distinct from old.used_at) then
    raise exception 'a code is only ever spent, once';
  end if;
  return new;
end
$function$;

create or replace function public.oauth_tokens_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.oauth_grants g
      where g.id = new.grant_id and g.user_id = new.user_id and g.client_id = new.client_id
        and g.resource = new.resource and g.revoked_at is null
    ) then
      raise exception 'a token must belong to a live connection of the same account, app and resource';
    end if;
    -- A revoked family takes no new token: the loser of a refresh race
    -- revokes the family (marking it first), and the winner's pair, written
    -- a moment later, is refused here instead of landing live (SEC-2).
    if exists (select 1 from public.oauth_revoked_families f where f.family_id = new.family_id)
       or exists (
         select 1 from public.oauth_tokens t
         where t.family_id = new.family_id and t.revoked_at is not null
       ) then
      raise exception 'this token family was revoked';
    end if;
    return new;
  end if;
  if new.token_hash is distinct from old.token_hash
     or new.kind is distinct from old.kind
     or new.grant_id is distinct from old.grant_id
     or new.family_id is distinct from old.family_id
     or new.user_id is distinct from old.user_id
     or new.client_id is distinct from old.client_id
     or new.resource is distinct from old.resource
     or not (new.scopes <@ old.scopes)
     or (old.revoked_at is not null and new.revoked_at is null)
     or (old.used_at is not null and new.used_at is distinct from old.used_at) then
    raise exception 'a token is only ever rotated or revoked';
  end if;
  return new;
end
$function$;

create or replace function public.mcp_ui_nonces_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.press_campaigns c where c.id = new.campaign_id and c.user_id = new.user_id
    ) then
      raise exception 'a card code must be for one of the owner''s own ads';
    end if;
    if new.grant_id is not null and not exists (
      select 1 from public.oauth_grants g where g.id = new.grant_id and g.user_id = new.user_id
    ) then
      raise exception 'a card code must be for one of the owner''s own connections';
    end if;
    return new;
  end if;
  if new.nonce_hash is distinct from old.nonce_hash
     or new.user_id is distinct from old.user_id
     or new.campaign_id is distinct from old.campaign_id
     or new.purpose is distinct from old.purpose
     or (old.used_at is not null and new.used_at is distinct from old.used_at) then
    raise exception 'a card code is only ever used, once';
  end if;
  return new;
end
$function$;

drop trigger if exists trg_oauth_grants_guard on public.oauth_grants;
create trigger trg_oauth_grants_guard
  before update on public.oauth_grants
  for each row execute function public.oauth_grants_guard();

drop trigger if exists trg_oauth_codes_guard on public.oauth_codes;
create trigger trg_oauth_codes_guard
  before insert or update on public.oauth_codes
  for each row execute function public.oauth_codes_guard();

drop trigger if exists trg_oauth_tokens_guard on public.oauth_tokens;
create trigger trg_oauth_tokens_guard
  before insert or update on public.oauth_tokens
  for each row execute function public.oauth_tokens_guard();

drop trigger if exists trg_mcp_ui_nonces_guard on public.mcp_ui_nonces;
create trigger trg_mcp_ui_nonces_guard
  before insert or update on public.mcp_ui_nonces
  for each row execute function public.mcp_ui_nonces_guard();

-- ---------------------------------------------------------------------
-- 7. press_campaigns.mcp_grant_id -> oauth_grants (critique #40)
-- ---------------------------------------------------------------------
-- Every value written so far is null (only this cut writes it); a stray
-- one is cleared rather than failing the constraint.
update public.press_campaigns c
   set mcp_grant_id = null
 where c.mcp_grant_id is not null
   and not exists (select 1 from public.oauth_grants g where g.id = c.mcp_grant_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'press_campaigns_mcp_grant_fk'
  ) then
    alter table public.press_campaigns
      add constraint press_campaigns_mcp_grant_fk
      foreign key (mcp_grant_id) references public.oauth_grants (id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 9. prune_oauth_clients: the daily prune's one step that must be a single
--    statement (lib/mcp/oauth/prune.ts). An app registered (or last used)
--    before p_before that never had a connection, has no authorization
--    waiting and was not disabled by hand. Deleting an app cascades to its
--    grants, so "never had a connection" is tested here, in the same
--    statement, never from a list read a moment earlier.
-- ---------------------------------------------------------------------
create or replace function public.prune_oauth_clients(p_before timestamptz, p_limit integer default 500)
returns integer
language sql
security invoker
set search_path to 'public'
as $function$
  with gone as (
    delete from public.oauth_clients c
     where c.client_id in (
       select x.client_id
         from public.oauth_clients x
        where x.disabled_at is null
          and x.created_at < p_before
          and x.updated_at < p_before
          and not exists (select 1 from public.oauth_grants g where g.client_id = x.client_id)
          and not exists (
            select 1 from public.oauth_pending_authorizations p
            where p.client_id = x.client_id and p.expires_at > now()
          )
        order by x.updated_at
        limit greatest(1, least(coalesce(p_limit, 500), 5000))
     )
    returning 1
  )
  select count(*)::integer from gone;
$function$;

revoke all on function public.prune_oauth_clients(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.prune_oauth_clients(timestamptz, integer) to service_role;

create index if not exists oauth_clients_updated on public.oauth_clients (updated_at) where disabled_at is null;
create index if not exists oauth_grants_client on public.oauth_grants (client_id);

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
  foreach t in array array[
    'oauth_clients', 'oauth_pending_authorizations', 'oauth_grants', 'oauth_codes', 'oauth_tokens', 'mcp_ui_nonces',
    'oauth_revoked_families'
  ] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relrowsecurity
    ) then
      raise exception 'RLS is not on for public.%', t;
    end if;
    select string_agg(format('%s (%s)', policyname, cmd), '; ') into bad
    from pg_policies where schemaname = 'public' and tablename = t;
    if bad is not null then
      raise exception 'public.% must have no policies, but has: %', t, bad;
    end if;
    foreach role_name in array array['anon', 'authenticated'] loop
      if has_table_privilege(role_name, format('public.%I', t), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') then
        raise exception '% can still reach public.%', role_name, t;
      end if;
    end loop;
    if not has_table_privilege('service_role', format('public.%I', t), 'SELECT, INSERT, UPDATE, DELETE') then
      raise exception 'service_role cannot use public.% (the server needs it)', t;
    end if;
  end loop;

  select string_agg(tg, ', ') into bad
  from unnest(array[
    'trg_oauth_grants_guard', 'trg_oauth_codes_guard', 'trg_oauth_tokens_guard', 'trg_mcp_ui_nonces_guard'
  ]) tg
  where not exists (select 1 from pg_trigger where tgname = tg and not tgisinternal);
  if bad is not null then
    raise exception 'guards missing: %', bad;
  end if;

  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and p.proname in ('oauth_grants_guard', 'oauth_codes_guard', 'oauth_tokens_guard', 'mcp_ui_nonces_guard');
  if bad is not null then
    raise exception 'these guards must not be SECURITY DEFINER: %', bad;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'press_campaigns_mcp_grant_fk') then
    raise exception 'press_campaigns.mcp_grant_id has no foreign key to oauth_grants';
  end if;

  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'oauth_grants_one_live') then
    raise exception 'the one-live-connection index is missing';
  end if;

  if to_regprocedure('public.prune_oauth_clients(timestamptz, integer)') is null then
    raise exception 'prune_oauth_clients is missing (the daily prune needs it)';
  end if;
  if exists (
    select 1 from pg_proc where oid = to_regprocedure('public.prune_oauth_clients(timestamptz, integer)') and prosecdef
  ) then
    raise exception 'prune_oauth_clients must run with the caller''s rights, not as SECURITY DEFINER';
  end if;
  foreach role_name in array array['anon', 'authenticated'] loop
    if has_function_privilege(role_name, 'public.prune_oauth_clients(timestamptz, integer)', 'EXECUTE') then
      raise exception '% can still call prune_oauth_clients', role_name;
    end if;
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conname = 'mcp_ui_nonces_purpose' and pg_get_constraintdef(oid) like '%film%'
  ) then
    raise exception 'mcp_ui_nonces.purpose does not accept film';
  end if;

  if position('oauth_revoked_families' in (
    select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'oauth_tokens_guard'
  )) = 0 then
    raise exception 'oauth_tokens_guard does not refuse tokens in a revoked family';
  end if;
end $$;

-- One result (the SQL editor shows only the last one). Expect 7 rows, each
-- "RLS on" with "no policies".
select c.relname as name,
       case when c.relrowsecurity then 'RLS on' else 'RLS OFF' end as state,
       coalesce((select string_agg(p.cmd || ': ' || p.policyname, '; ' order by p.policyname)
                   from pg_policies p
                  where p.schemaname = 'public' and p.tablename = c.relname), 'no policies') as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('oauth_clients', 'oauth_pending_authorizations', 'oauth_grants', 'oauth_codes', 'oauth_tokens', 'mcp_ui_nonces',
                    'oauth_revoked_families')
order by 1;
