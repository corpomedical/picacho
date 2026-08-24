-- Outfit-on-the-character (2026-08-24, from the bmazloum support case: outfit
-- product photos were being crammed into the identity reference slots — and a
-- flat-lay attached to a message REPLACED the face anchor — because outfit
-- photos had no correct home. Now they do.)
--
-- Two columns on character_profiles:
--   outfit_image_urls  — storage paths (character-references bucket, the
--                        owner's own folder, same ownership rules as
--                        reference_image_urls). Capped at 2 by the server.
--   outfit_description — written ONCE at save time by a vision pass over the
--                        first outfit photo (see describeOutfitImage in
--                        describe-image.ts). Injected into prompt drafting for
--                        models whose endpoints can't take a clothing photo
--                        (the Kling family); Seedance and GPT Image get the
--                        actual photo as a cited reference on top of this.
--
-- Writes go through the same user-session UPDATE/INSERT saveCharacterProfile
-- already uses — character_profiles has table-wide grants for authenticated
-- (no column lockdown, unlike generations), so no new grants are needed. If a
-- generations-style column-scoped lockdown is ever applied to this table,
-- these two columns must be included in the user-writable set.

alter table public.character_profiles
  add column if not exists outfit_image_urls text[] not null default '{}',
  add column if not exists outfit_description text;
