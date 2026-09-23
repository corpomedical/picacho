-- EVERY CHARACTER HAS A VOICE (2026-09-23).
--
-- THE HOLE. character_profiles.voice_id is nullable with no default, and the
-- character form's voice picker was optional with a "No voice — video only"
-- entry at the top of the list. So a character could be saved with no voice
-- at all, forever, silently. Every other voice defect in the product is
-- about how a voice is CARRIED; this one is the absence of the thing being
-- carried. "This character always sounds like this" has no `this`.
--
-- It is also the amplifier for the worst-sounding failure: a character with
-- no voice and no typed dialogue line renders with generate_audio true, so
-- Veo / Kling O3 / Seedance invent a voice per render, and MiniMax H3 and
-- Gemini Omni Flash invent one with no switch to stop them.
--
-- AFTER THIS: no character_profiles row has a null voice_id, and no admin
-- can delete a preset back out from under one.
--
-- SQL-FIRST: paste and confirm this BEFORE pushing the code. The code is
-- safe either way — saveCharacterProfile assigns a voice to rows it writes
-- and logs loudly if the catalogue cannot be read — but without step 1 the
-- characters that already exist stay voiceless, and without step 2 a single
-- admin delete puts them back. Idempotent; a double-paste is harmless.

-- 0. Nothing to assign from? Stop here rather than reporting success. An
--    empty catalogue means Admin > Voices was never filled in, and every
--    statement below would be a silent no-op.
do $$
begin
  if (select count(*) from public.voice_presets) = 0 then
    raise exception 'voice_presets is empty — add voices in Admin > Voices before running this.';
  end if;
end $$;

-- 1. Give every voiceless character a voice, spread across the catalogue.
--
--    Deterministic on the character's own id, like assignedVoiceFor() in
--    src/lib/generations/voice-lock.ts. The two do NOT pick the same row as
--    each other and do not need to: each decides a voice once, and the
--    answer is persisted here in the column. What matters is that a rerun of
--    this statement is stable (it is — hashtext is immutable) and that every
--    character lands on a real preset.
--
--    hashtext() returns a signed int4, and abs() on its most negative value
--    overflows; shifting into bigint first avoids that edge entirely.
with ordered as (
  select
    id,
    (row_number() over (order by sort_order, id)) - 1 as idx,
    count(*) over () as total
  from public.voice_presets
)
update public.character_profiles c
set voice_id = o.id,
    updated_at = now()
from ordered o
where c.voice_id is null
  and o.idx = mod(hashtext(c.id::text)::bigint + 2147483648, o.total);

-- 2. Stop a delete in Admin > Voices from undoing step 1.
--
--    The constraint was ON DELETE SET NULL, so removing one preset silently
--    un-voiced every character pointing at it — the exact state step 1 just
--    cleared, restorable by one admin click. RESTRICT makes the database
--    refuse; deleteVoicePreset() checks first and says so in words, so the
--    constraint is the backstop rather than the user experience.
alter table public.character_profiles
  drop constraint if exists character_profiles_voice_id_fkey;

alter table public.character_profiles
  add constraint character_profiles_voice_id_fkey
  foreign key (voice_id) references public.voice_presets(id) on delete restrict;

-- 3. Prove it. Both counts must be zero.
--    voiceless: characters that still have no voice.
--    dangling:  characters pointing at a preset that no longer exists.
select
  count(*) filter (where voice_id is null) as voiceless,
  count(*) filter (
    where voice_id is not null
      and not exists (select 1 from public.voice_presets p where p.id = voice_id)
  ) as dangling
from public.character_profiles;
