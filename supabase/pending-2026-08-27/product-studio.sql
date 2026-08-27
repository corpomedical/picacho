-- =====================================================================
-- 2026-08-27  Product Studio ("B on A") — PENDING, apply to live DB
-- BEFORE the deploy that ships /app/products and /app/studio.
--
-- One new table: products — the user's catalog (name, product photos, an
-- optional logo). Photos and logos are STORAGE PATHS in the existing
-- character-references bucket under the owner's own folder
-- (${userId}/products/...), the same reuse the outfit slot chose on
-- 2026-08-24: the bucket's owner-folder RLS and the /api/media route
-- already cover it, so no storage SQL is needed here at all.
--
-- Caps (3 photos, 1 logo) are enforced by the server action; RLS mirrors
-- projects: owners do everything on their own rows, admins can read for
-- support.
-- =====================================================================

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  image_paths text[] not null default '{}',
  logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products enable row level security;

drop policy if exists "Users manage their own products" on public.products;
create policy "Users manage their own products"
  on public.products for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Admins can view all products" on public.products;
create policy "Admins can view all products"
  on public.products for select
  using (is_admin());

grant select, insert, update, delete on public.products to authenticated;
