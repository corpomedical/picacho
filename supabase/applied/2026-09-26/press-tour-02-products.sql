-- Press Tour, SQL 2 of the rollout: the product card, the brand kit, the
-- consents that stand behind both, and the private press-kit bucket
-- (2026-09-25; Spec v1 §1.1, §1.2, §6 as changed by v2, press-tour-synthesis.md
-- §3.1 items 7, 8, 9, 28, 30 and §3.4 Cut 1). Code: src/lib/press-tour/
-- (types.ts names every value this file allows; types.test.ts pins the two
-- against each other).
--
-- RUN THIS BEFORE PUSHING THE CODE, after press-tour-00-hardening.sql and
-- press-tour-01-flags.sql. Idempotent: a second paste is harmless.
--
-- EVERY WRITE IS THE SERVER'S. People read their own rows and nothing else:
-- no table here has an insert, update or delete policy, and those privileges
-- are revoked from public, anon and authenticated. The server writes with the
-- service role after asserting ownership (src/lib/press-tour/owned.ts), and
-- the triggers below re-check what matters inside the database, so a bug in
-- one server path still cannot confirm a product nobody consented to, or
-- point a row at another person's files or brand kit.
--
-- THE OPERATOR'S TEST ROW IN products SURVIVES. The table is the leftover
-- from Product Studio (applied/2026-08-27/product-studio.sql): every column
-- added here is nullable or has a default, the row becomes a 'draft', and the
-- two new checks on columns it already had (name, image_paths) are NOT VALID,
-- so they bind new writes without judging the old row.
--
-- products ALSO LOSES ITS "manage your own" POLICY HERE. Spec v2 files that
-- under Cut 0; it lives here rather than in press-tour-00-hardening.sql
-- (which holds Cut 0's money half, the bonus-credit revokes) because this
-- file adds status, label_strings and the rest, and with that policy still
-- in place a signed-in person could mark their own product 'confirmed'
-- straight through the API, skipping the consent and the label step.
-- Nothing in src reads or writes products today, so nothing breaks.

begin;

-- ---------------------------------------------------------------------
-- 1. brand_kits: one row per brand a person advertises. The person confirms
--    every field; the planner reads the palette, the logo (end card only),
--    the tone, the tagline and the default call to action.
-- ---------------------------------------------------------------------
create table if not exists public.brand_kits (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  name          text not null,
  -- the site it was read from, if any (https only, like every fetch)
  source_url    text,
  -- the logo, a PNG under the owner's own folder in press-kit
  logo_path     text,
  palette       text[] not null default '{}',
  fonts         text[] not null default '{}',
  tone          text,
  tagline       text,
  default_cta   text,
  -- the logo the ownership answer was given for (a new logo asks again)
  photos_hash   text,
  status        text not null default 'draft',
  confirmed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint brand_kits_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint brand_kits_source_url check (
    source_url is null or (char_length(source_url) <= 2048 and source_url ~ '^https://')
  ),
  constraint brand_kits_logo_path_len check (logo_path is null or char_length(logo_path) <= 512),
  -- 2 to 6 colours in practice; lowercase #rrggbb only, no empty slots
  constraint brand_kits_palette check (
    cardinality(palette) <= 6
    and array_position(palette, null) is null
    and array_to_string(palette, ',') ~ '^(#[0-9a-f]{6}(,#[0-9a-f]{6})*)?$'
  ),
  -- at most 4 font names; each at most 80 characters (checked by the trigger)
  constraint brand_kits_fonts check (
    cardinality(fonts) <= 4 and array_position(fonts, null) is null
  ),
  constraint brand_kits_tone_len check (tone is null or char_length(tone) <= 500),
  constraint brand_kits_tagline_len check (tagline is null or char_length(tagline) <= 120),
  constraint brand_kits_cta_len check (default_cta is null or char_length(default_cta) <= 60),
  constraint brand_kits_photos_hash_len check (photos_hash is null or char_length(photos_hash) <= 64),
  constraint brand_kits_status check (status in ('draft', 'confirmed', 'archived')),
  -- a confirmed kit says when, and which logo its ownership answer covers
  constraint brand_kits_confirmed_complete check (
    status <> 'confirmed' or (confirmed_at is not null and photos_hash is not null)
  )
);

create index if not exists brand_kits_user_live
  on public.brand_kits (user_id, created_at desc)
  where deleted_at is null;

alter table public.brand_kits enable row level security;

drop policy if exists "Users can view their own brand kits" on public.brand_kits;
create policy "Users can view their own brand kits" on public.brand_kits
  for select to authenticated
  using (user_id = (select auth.uid()) and deleted_at is null);

revoke all on public.brand_kits from public, anon, authenticated;
grant select on public.brand_kits to authenticated;
grant all on public.brand_kits to service_role;

-- ---------------------------------------------------------------------
-- 2. products: the leftover table becomes the product card.
--    Existing columns kept as they are: id, user_id, name, image_paths (the
--    product photos the person chose), logo_path (the saved logo crop),
--    created_at, updated_at.
-- ---------------------------------------------------------------------
alter table public.products add column if not exists brand_kit_id uuid
  references public.brand_kits (id) on delete set null;
-- the page it was imported from, if any
alter table public.products add column if not exists source_url text;
-- decided by meaning (the photos plus the DNA), never by the person's pick;
-- 'regulated' is kept so the refusal is on the record, and can never be confirmed in v1
alter table public.products add column if not exists category text;
-- the bounded description read from the photos and the page (name, brand,
-- shape, material, colours, marks); data for the judge, never instructions
alter table public.products add column if not exists dna jsonb;
-- the photos the product read (category and dna) actually saw. A card is
-- confirmed only with photos in this list (products_confirmed_complete), so
-- a photo nobody judged can never ride on a category read from other photos.
alter table public.products add column if not exists dna_photos text[] not null default '{}';
-- the words that must appear on the product, ticked and spelled by the person
alter table public.products add column if not exists label_strings text[] not null default '{}';
-- "No readable text on this product", ticked instead of any string
alter table public.products add column if not exists no_readable_text boolean not null default false;
-- where the logo sits: {"path": one of image_paths, "x","y","w","h": 0..1 of that photo}
alter table public.products add column if not exists logo_box jsonb;
-- 2 to 6 colours from the matted product, lowercase #rrggbb, editable
alter table public.products add column if not exists palette text[] not null default '{}';
-- which view each chosen photo is: [{"path": one of image_paths, "view": "front" | ...}]
alter table public.products add column if not exists angles jsonb;
-- the reference crops the product checks compare against: ["<user>/...", ...]
alter table public.products add column if not exists lock_refs jsonb;
-- the photos the product consent was given for (a new photo asks again).
-- The server computes it from image_paths in ONE place, sorted (a new order
-- is the same photos); the guard below holds the rest: a confirmed card
-- cannot change its photos without a new hash and a consent for it.
alter table public.products add column if not exists photos_hash text;
alter table public.products add column if not exists status text not null default 'draft';
alter table public.products add column if not exists confirmed_at timestamptz;
alter table public.products add column if not exists deleted_at timestamptz;

-- Checks on the columns the test row already had: NOT VALID, so they bind
-- every new write without judging that row.
alter table public.products drop constraint if exists products_name_len;
alter table public.products add constraint products_name_len
  check (char_length(btrim(name)) between 1 and 120) not valid;
alter table public.products drop constraint if exists products_image_paths_count;
alter table public.products add constraint products_image_paths_count
  check (cardinality(image_paths) <= 8 and array_position(image_paths, null) is null) not valid;

-- Checks on the new columns: every existing row passes them by default.
alter table public.products drop constraint if exists products_source_url;
alter table public.products add constraint products_source_url check (
  source_url is null or (char_length(source_url) <= 2048 and source_url ~ '^https://')
);
alter table public.products drop constraint if exists products_category;
alter table public.products add constraint products_category check (
  category is null
  or category in ('rigid', 'apparel', 'liquid', 'cosmetic', 'food', 'electronics', 'other', 'regulated')
);
-- Sizes are measured on the text form (octet_length(x::text)), not
-- pg_column_size, which reports the compressed size once a value is stored
-- and so would judge the same value differently on insert and on update.
-- CASE, not AND, wherever a length needs the right JSON type first: SQL does
-- not promise to evaluate AND left to right.
alter table public.products drop constraint if exists products_dna;
alter table public.products add constraint products_dna check (
  dna is null or (jsonb_typeof(dna) = 'object' and octet_length(dna::text) <= 8192)
);
-- at most 8 strings; each 1-80 characters once trimmed (checked by the trigger)
-- at most 8 paths, each under the owner's own folder (checked by the trigger)
alter table public.products drop constraint if exists products_dna_photos;
alter table public.products add constraint products_dna_photos check (
  cardinality(dna_photos) <= 8 and array_position(dna_photos, null) is null
);
alter table public.products drop constraint if exists products_label_strings;
alter table public.products add constraint products_label_strings check (
  cardinality(label_strings) <= 8 and array_position(label_strings, null) is null
);
alter table public.products drop constraint if exists products_label_or_none;
alter table public.products add constraint products_label_or_none check (
  not (no_readable_text and cardinality(label_strings) > 0)
);
alter table public.products drop constraint if exists products_logo_box;
alter table public.products add constraint products_logo_box check (
  logo_box is null or (jsonb_typeof(logo_box) = 'object' and octet_length(logo_box::text) <= 1024)
);
alter table public.products drop constraint if exists products_palette;
alter table public.products add constraint products_palette check (
  cardinality(palette) <= 6
  and array_position(palette, null) is null
  and array_to_string(palette, ',') ~ '^(#[0-9a-f]{6}(,#[0-9a-f]{6})*)?$'
);
alter table public.products drop constraint if exists products_angles;
alter table public.products add constraint products_angles check (
  angles is null
  or case when jsonb_typeof(angles) = 'array'
          then jsonb_array_length(angles) <= 8 and octet_length(angles::text) <= 8192
          else false end
);
alter table public.products drop constraint if exists products_lock_refs;
alter table public.products add constraint products_lock_refs check (
  lock_refs is null
  or case when jsonb_typeof(lock_refs) = 'array'
          then jsonb_array_length(lock_refs) <= 8 and octet_length(lock_refs::text) <= 8192
          else false end
);
alter table public.products drop constraint if exists products_photos_hash_len;
alter table public.products add constraint products_photos_hash_len check (
  photos_hash is null or char_length(photos_hash) <= 64
);
alter table public.products drop constraint if exists products_status;
alter table public.products add constraint products_status check (
  status in ('draft', 'confirmed', 'archived')
);
-- A confirmed card is complete: when, which photos its consent covers, a
-- category that is not regulated (refused in v1: no ad-claims gate exists),
-- the label answered (strings, or "no readable text"), at least one photo,
-- and every photo one the product read saw (dna_photos): the category was
-- decided from exactly these photos, never from others on the same draft.
alter table public.products drop constraint if exists products_confirmed_complete;
alter table public.products add constraint products_confirmed_complete check (
  status <> 'confirmed' or (
    confirmed_at is not null
    and photos_hash is not null
    and category is not null
    and category <> 'regulated'
    and (no_readable_text or cardinality(label_strings) > 0)
    and cardinality(image_paths) > 0
    and image_paths <@ dna_photos
  )
);

create index if not exists products_user_live
  on public.products (user_id, created_at desc)
  where deleted_at is null;
create index if not exists products_brand_kit
  on public.products (brand_kit_id)
  where brand_kit_id is not null;

-- Read-only for people: the "manage your own" policy goes, a read-own policy
-- replaces it, the admins' read policy stays.
drop policy if exists "Users manage their own products" on public.products;
drop policy if exists "Users can view their own products" on public.products;
create policy "Users can view their own products" on public.products
  for select to authenticated
  using (user_id = (select auth.uid()) and deleted_at is null);

revoke all on public.products from public, anon, authenticated;
grant select on public.products to authenticated;
grant all on public.products to service_role;

-- ---------------------------------------------------------------------
-- 3. product_consents: the record behind a confirmed product or brand kit.
--    "I own this product, or I may advertise it, and I may use these
--    photos" (kind 'product'); "This is my brand, or I may use its name and
--    logo" (kind 'brand_kit'). The character_likeness_consents shape: the
--    answer, which notice, how, where, in which language, and for exactly
--    which photos (photos_hash). Written only by the server; append-only.
-- ---------------------------------------------------------------------
create table if not exists public.product_consents (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  kind            text not null,
  -- exactly one of these two, matching kind; kept as a record (set null)
  -- when the product or kit itself is deleted
  product_id      uuid references public.products (id) on delete set null,
  brand_kit_id    uuid references public.brand_kits (id) on delete set null,
  answer          text not null,
  photos_hash     text not null,
  -- the notice shown, set by the server, never by the page
  notice_version  text not null,
  locale          text not null,
  -- how it was given, e.g. 'checkbox'
  method          text not null,
  -- where it was given
  place           text not null,
  -- the requesting address, hashed; null when none was available
  ip_hash         text,
  created_at      timestamptz not null default now(),
  constraint product_consents_kind check (kind in ('product', 'brand_kit')),
  constraint product_consents_subject check (
    (kind = 'product' and brand_kit_id is null) or (kind = 'brand_kit' and product_id is null)
  ),
  constraint product_consents_answer check (answer in ('own', 'permission')),
  constraint product_consents_place check (place in ('door', 'generate', 'producer', 'mcp')),
  constraint product_consents_photos_hash_len check (char_length(photos_hash) between 1 and 64),
  constraint product_consents_notice_len check (char_length(notice_version) between 1 and 32),
  constraint product_consents_locale_len check (char_length(locale) between 1 and 16),
  constraint product_consents_method_len check (char_length(method) between 1 and 32),
  constraint product_consents_ip_hash_len check (ip_hash is null or char_length(ip_hash) <= 128)
);

create index if not exists product_consents_product
  on public.product_consents (product_id, created_at desc)
  where product_id is not null;
create index if not exists product_consents_brand_kit
  on public.product_consents (brand_kit_id, created_at desc)
  where brand_kit_id is not null;
create index if not exists product_consents_user
  on public.product_consents (user_id, created_at desc);

alter table public.product_consents enable row level security;

drop policy if exists "Read own product consents" on public.product_consents;
create policy "Read own product consents" on public.product_consents
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.product_consents from public, anon, authenticated;
grant select on public.product_consents to authenticated;
grant all on public.product_consents to service_role;

-- ---------------------------------------------------------------------
-- 4. The guards. Plain trigger functions (not SECURITY DEFINER, and a
--    trigger function cannot be called as an RPC), the
--    enforce_reference_paths_owned shape. They run on the server's writes,
--    which bypass RLS, and hold the rules RLS cannot.
-- ---------------------------------------------------------------------

-- products: owner fixed; every file under the owner's own folder; every
-- label string 1-80 characters; the brand kit is the owner's own; a product
-- becomes (or stays) confirmed only with a product consent for exactly its
-- current photos_hash; and a confirmed product cannot swap its photos under
-- the old hash.
create or replace function public.press_tour_products_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  prefix text := new.user_id::text || '/';
  p text;
  e jsonb;
  n numeric;
  k text;
begin
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'a product cannot change owner';
    end if;
    new.updated_at := now();
  end if;

  foreach p in array coalesce(new.image_paths, '{}'::text[]) || coalesce(new.dna_photos, '{}'::text[]) loop
    if p is null or position(prefix in p) <> 1 or p like '%..%' or char_length(p) > 512 then
      raise exception 'product photos must all be under the owner''s storage folder';
    end if;
  end loop;

  if new.logo_path is not null
     and (position(prefix in new.logo_path) <> 1 or new.logo_path like '%..%' or char_length(new.logo_path) > 512) then
    raise exception 'the product logo must be under the owner''s storage folder';
  end if;

  foreach p in array coalesce(new.label_strings, '{}'::text[]) loop
    if p is null or char_length(btrim(p)) = 0 or char_length(p) > 80 then
      raise exception 'each label string is 1 to 80 characters';
    end if;
  end loop;

  if new.angles is not null then
    if jsonb_typeof(new.angles) <> 'array' then
      raise exception 'product angles are a list';
    end if;
    -- coalesce(..., false) throughout: a missing key is NULL, and a NULL
    -- condition would skip the raise.
    for e in select value from jsonb_array_elements(new.angles) loop
      if jsonb_typeof(e) <> 'object'
         or not coalesce((e ->> 'path') = any (coalesce(new.image_paths, '{}'::text[])), false)
         or coalesce(e ->> 'view', '') not in ('front', 'back', 'side', 'three_quarter', 'top', 'detail', 'in_use') then
        raise exception 'every product angle names one of the product''s own photos and a known view';
      end if;
    end loop;
  end if;

  if new.lock_refs is not null then
    if jsonb_typeof(new.lock_refs) <> 'array' then
      raise exception 'product check references are a list';
    end if;
    for e in select value from jsonb_array_elements(new.lock_refs) loop
      p := e #>> '{}';
      if jsonb_typeof(e) <> 'string' or position(prefix in p) <> 1 or p like '%..%' or char_length(p) > 512 then
        raise exception 'product check references must all be under the owner''s storage folder';
      end if;
    end loop;
  end if;

  if new.logo_box is not null then
    if jsonb_typeof(new.logo_box) <> 'object'
       or not coalesce((new.logo_box ->> 'path') = any (coalesce(new.image_paths, '{}'::text[])), false) then
      raise exception 'the logo box names one of the product''s own photos';
    end if;
    foreach k in array array['x', 'y', 'w', 'h'] loop
      if coalesce(jsonb_typeof(new.logo_box -> k), 'missing') <> 'number' then
        raise exception 'the logo box has x, y, w and h, each from 0 to 1';
      end if;
      n := (new.logo_box ->> k)::numeric;
      if n < 0 or n > 1 then
        raise exception 'the logo box has x, y, w and h, each from 0 to 1';
      end if;
    end loop;
    if (new.logo_box ->> 'w')::numeric <= 0 or (new.logo_box ->> 'h')::numeric <= 0
       or (new.logo_box ->> 'x')::numeric + (new.logo_box ->> 'w')::numeric > 1
       or (new.logo_box ->> 'y')::numeric + (new.logo_box ->> 'h')::numeric > 1 then
      raise exception 'the logo box must lie inside its photo';
    end if;
  end if;

  if new.brand_kit_id is not null
     and (tg_op = 'INSERT' or new.brand_kit_id is distinct from old.brand_kit_id)
     and not exists (
       select 1 from public.brand_kits b
       where b.id = new.brand_kit_id and b.user_id = new.user_id and b.deleted_at is null
     ) then
    raise exception 'a product''s brand kit must be one of the owner''s own';
  end if;

  if new.status = 'confirmed'
     and (tg_op = 'INSERT'
          or old.status is distinct from 'confirmed'
          or old.photos_hash is distinct from new.photos_hash)
     and not exists (
       select 1 from public.product_consents c
       where c.kind = 'product'
         and c.product_id = new.id
         and c.user_id = new.user_id
         and c.photos_hash = new.photos_hash
     ) then
    raise exception 'a product is confirmed only with a product consent for exactly these photos';
  end if;

  -- Other photos under the same photos_hash would ride on a consent given
  -- for different ones: a confirmed card that changes its photos must carry
  -- the new photos' hash (and so a consent for them), or go back to draft.
  -- Compared sorted, as photosHash does: a new order is the same photos.
  if tg_op = 'UPDATE'
     and new.status = 'confirmed'
     and new.photos_hash is not distinct from old.photos_hash
     and (select coalesce(array_agg(x order by x), '{}') from unnest(coalesce(new.image_paths, '{}'::text[])) x)
         is distinct from
         (select coalesce(array_agg(x order by x), '{}') from unnest(coalesce(old.image_paths, '{}'::text[])) x) then
    raise exception 'new photos on a confirmed product need a new consent';
  end if;

  return new;
end
$function$;

drop trigger if exists trg_press_tour_products_guard on public.products;
create trigger trg_press_tour_products_guard
  before insert or update on public.products
  for each row execute function public.press_tour_products_guard();

-- brand_kits: owner fixed; the logo under the owner's own folder; each font
-- name 1-80 characters; confirmed only with a brand-kit consent for exactly
-- its current logo, and a confirmed kit cannot swap its logo under the old
-- hash.
create or replace function public.press_tour_brand_kits_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  prefix text := new.user_id::text || '/';
  p text;
begin
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'a brand kit cannot change owner';
    end if;
    new.updated_at := now();
  end if;

  if new.logo_path is not null
     and (position(prefix in new.logo_path) <> 1 or new.logo_path like '%..%') then
    raise exception 'the brand logo must be under the owner''s storage folder';
  end if;

  foreach p in array coalesce(new.fonts, '{}'::text[]) loop
    if p is null or char_length(btrim(p)) = 0 or char_length(p) > 80 then
      raise exception 'each font name is 1 to 80 characters';
    end if;
  end loop;

  if new.status = 'confirmed'
     and (tg_op = 'INSERT'
          or old.status is distinct from 'confirmed'
          or old.photos_hash is distinct from new.photos_hash)
     and not exists (
       select 1 from public.product_consents c
       where c.kind = 'brand_kit'
         and c.brand_kit_id = new.id
         and c.user_id = new.user_id
         and c.photos_hash = new.photos_hash
     ) then
    raise exception 'a brand kit is confirmed only with a brand consent for exactly this logo';
  end if;

  -- The same for the logo: a confirmed kit with a new logo carries the new
  -- logo's hash (and a consent for it), or goes back to draft.
  if tg_op = 'UPDATE'
     and new.status = 'confirmed'
     and new.photos_hash is not distinct from old.photos_hash
     and new.logo_path is distinct from old.logo_path then
    raise exception 'a new logo on a confirmed brand kit needs a new consent';
  end if;

  return new;
end
$function$;

drop trigger if exists trg_press_tour_brand_kits_guard on public.brand_kits;
create trigger trg_press_tour_brand_kits_guard
  before insert or update on public.brand_kits
  for each row execute function public.press_tour_brand_kits_guard();

-- product_consents: a new record names one of the person's own products or
-- brand kits; after that it never changes, except that the product or kit
-- it named may be deleted (the foreign key sets it null). Deletion of the
-- whole record happens only with the account (on delete cascade).
create or replace function public.press_tour_consents_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' then
    if row(new.id, new.user_id, new.kind, new.answer, new.photos_hash, new.notice_version,
           new.locale, new.method, new.place, new.ip_hash, new.created_at)
       is distinct from
       row(old.id, old.user_id, old.kind, old.answer, old.photos_hash, old.notice_version,
           old.locale, old.method, old.place, old.ip_hash, old.created_at)
       or (new.product_id is not null and new.product_id is distinct from old.product_id)
       or (new.brand_kit_id is not null and new.brand_kit_id is distinct from old.brand_kit_id) then
      raise exception 'a consent record cannot be changed';
    end if;
    return new;
  end if;

  if new.kind = 'product' then
    if new.product_id is null or not exists (
      select 1 from public.products p
      where p.id = new.product_id and p.user_id = new.user_id and p.deleted_at is null
    ) then
      raise exception 'a product consent names one of the person''s own products';
    end if;
  elsif new.kind = 'brand_kit' then
    if new.brand_kit_id is null or not exists (
      select 1 from public.brand_kits b
      where b.id = new.brand_kit_id and b.user_id = new.user_id and b.deleted_at is null
    ) then
      raise exception 'a brand consent names one of the person''s own brand kits';
    end if;
  end if;

  return new;
end
$function$;

drop trigger if exists trg_press_tour_consents_guard on public.product_consents;
create trigger trg_press_tour_consents_guard
  before insert or update on public.product_consents
  for each row execute function public.press_tour_consents_guard();

-- ---------------------------------------------------------------------
-- 5. THE PRESS-KIT BUCKET. Private. Product photos, logo crops, reference
--    crops, stills, shots and finished ads, each under <user>/..., at a path
--    the server chose. There are NO storage policies for people at all (the
--    edit-footage shape): nobody can list, read, write or delete here with
--    their own session. Files arrive only through the server (a person's
--    own uploads are staged in press-uploads, section 6, and re-encoded
--    here); they are served through the media route.
--
--    100 MB a file. SVG is refused on purpose ("Upload your logo as a PNG").
--    NOTE: Supabase also has a project-wide upload limit (Dashboard ->
--    Storage -> Settings); a file bigger than THAT is refused whatever this
--    says.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'press-kit',
  'press-kit',
  false,
  104857600,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------
-- 6. THE PRESS-UPLOADS BUCKET: where the browser puts a person's own photos
--    (and a logo) before the server reads them, <user>/uploads/<batch>/<n>,
--    through a signed upload token the server mints for a path it chose.
--    A signed upload token binds neither a size nor a type, so the bucket
--    holds both: 12 MB a file (card-service.ts UPLOAD_MAX_BYTES), JPEG, PNG
--    and WebP only. Private, and no storage policies for people, like
--    press-kit. A staged file is read once and removed; one never read is
--    removed by /api/cron/press-uploads once it is older than the token's
--    two hours (press_stale_uploads below lists them).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'press-uploads',
  'press-uploads',
  false,
  12582912,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The staged files older than p_before, oldest first, at most p_limit (1 to
-- 1000, remove()'s own ceiling). SECURITY INVOKER on purpose: it runs with
-- the caller's rights, and only the service role (which reads
-- storage.objects past RLS) may call it at all. Names only: the cron removes
-- them through the Storage API, which also deletes the bytes.
create or replace function public.press_stale_uploads(p_before timestamptz, p_limit integer)
returns setof text
language sql
stable
security invoker
set search_path to ''
as $function$
  select o.name
  from storage.objects o
  where o.bucket_id = 'press-uploads'
    and o.created_at < p_before
  order by o.created_at
  limit least(greatest(coalesce(p_limit, 1), 1), 1000);
$function$;

revoke all on function public.press_stale_uploads(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.press_stale_uploads(timestamptz, integer) to service_role;

commit;

-- ---------------------------------------------------------------------
-- 7. Verify. Fails loudly, naming what is wrong; changes nothing.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  bad text;
  role_name text;
begin
  -- RLS on, and no policy that lets anyone write.
  foreach t in array array['products', 'brand_kits', 'product_consents'] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relrowsecurity
    ) then
      raise exception 'RLS is not on for public.%', t;
    end if;

    select string_agg(format('%s (%s)', policyname, cmd), '; ') into bad
    from pg_policies
    where schemaname = 'public' and tablename = t and cmd <> 'SELECT';
    if bad is not null then
      raise exception 'public.% still has a policy that writes: %', t, bad;
    end if;

    foreach role_name in array array['anon', 'authenticated'] loop
      if has_table_privilege(role_name, format('public.%I', t), 'INSERT, UPDATE, DELETE, TRUNCATE') then
        raise exception '% can still write public.%', role_name, t;
      end if;
    end loop;
  end loop;

  -- Every new products column is there.
  select string_agg(col, ', ') into bad
  from unnest(array[
    'brand_kit_id', 'source_url', 'category', 'dna', 'dna_photos', 'label_strings', 'no_readable_text',
    'logo_box', 'palette', 'angles', 'lock_refs', 'photos_hash', 'status', 'confirmed_at', 'deleted_at'
  ]) col
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name = col
  );
  if bad is not null then
    raise exception 'public.products is missing: %', bad;
  end if;

  -- The three guards are in place.
  select string_agg(tg, ', ') into bad
  from unnest(array[
    'trg_press_tour_products_guard', 'trg_press_tour_brand_kits_guard', 'trg_press_tour_consents_guard'
  ]) tg
  where not exists (select 1 from pg_trigger where tgname = tg and not tgisinternal);
  if bad is not null then
    raise exception 'guards missing: %', bad;
  end if;

  -- The bucket is private, with its limits.
  if not exists (
    select 1 from storage.buckets
    where id = 'press-kit' and public = false and file_size_limit = 104857600
      and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4']
  ) then
    raise exception 'the press-kit bucket is missing, public, or has the wrong limits';
  end if;
  if not exists (
    select 1 from storage.buckets
    where id = 'press-uploads' and public = false and file_size_limit = 12582912
      and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
  ) then
    raise exception 'the press-uploads bucket is missing, public, or has the wrong limits';
  end if;

  -- No storage policy reaches press-kit or press-uploads: none names either,
  -- and none for public, anon or authenticated names no bucket at all (such
  -- a policy would reach every bucket, these included, for reading as much
  -- as for writing).
  select string_agg(format('%s (%s to %s)', policyname, cmd, array_to_string(roles, ',')), '; ')
    into bad
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and (
      coalesce(qual, '') || coalesce(with_check, '') ilike '%press-kit%'
      or coalesce(qual, '') || coalesce(with_check, '') ilike '%press-uploads%'
      or (
        roles && array['public', 'anon', 'authenticated']::name[]
        and coalesce(qual, '') || coalesce(with_check, '') not ilike '%bucket_id%'
      )
    );
  if bad is not null then
    raise exception 'a storage policy reaches press-kit or press-uploads: %', bad;
  end if;

  -- The stale-upload lister is the service role's alone.
  foreach role_name in array array['public', 'anon', 'authenticated'] loop
    if has_function_privilege(role_name, 'public.press_stale_uploads(timestamptz, integer)', 'EXECUTE') then
      raise exception '% can execute public.press_stale_uploads', role_name;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.press_stale_uploads(timestamptz, integer)', 'EXECUTE') then
    raise exception 'service_role cannot execute public.press_stale_uploads (the upload sweep needs it)';
  end if;
  -- It runs with its caller's rights, so the service role must read storage.objects.
  if not has_table_privilege('service_role', 'storage.objects', 'SELECT') then
    raise exception 'service_role cannot read storage.objects (press_stale_uploads runs with its rights)';
  end if;
end $$;

-- One result (the SQL editor shows only the last one). Expect 5 rows: the
-- three tables with RLS on and only SELECT policies, press-kit private at
-- 104857600 bytes, and press-uploads private at 12582912 bytes.
select 'table' as what,
       c.relname as name,
       case when c.relrowsecurity then 'RLS on' else 'RLS OFF' end as state,
       (select string_agg(p.cmd || ': ' || p.policyname, '; ' order by p.policyname)
          from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as detail
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('products', 'brand_kits', 'product_consents')
union all
select 'bucket',
       b.id,
       case when b.public then 'PUBLIC' else 'private' end,
       b.file_size_limit::text || ' bytes; ' || array_to_string(b.allowed_mime_types, ', ')
from storage.buckets b
where b.id in ('press-kit', 'press-uploads')
order by 1 desc, 2;
