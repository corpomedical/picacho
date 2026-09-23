-- EVERY TAKE RECORDS WHOSE VOICE WAS IN IT (2026-09-23).
--
-- THE HOLE. Nothing in this database has ever recorded which voice a
-- delivered clip was spoken in. The resolved ElevenLabs id rode the job
-- row's `resume` and was erased with it at delivery, so the product's
-- central promise — this character always sounds like this — could not be
-- checked after the fact, or even after a complaint.
--
-- The face has had this since 2026-09-18: generations.match_score and
-- match_notes, written in finish(), which is how "the face held all the way
-- through" is a number instead of a hope. These four columns are the voice's
-- equivalent, written in the same terminal write, at the same choke point.
--
-- WHAT THE CLAIM BECOMES. 100% cannot mean identical audio — ElevenLabs says
-- in writing that its seed is "best effort... Determinism is not
-- guaranteed". It can mean exactly one thing, and this column is what makes
-- it falsifiable:
--
--     no voice that is not this character's is ever in a delivered file
--
-- which is `select voice_source, count(*) ... group by 1` and nothing else.
--
-- SQL-FIRST: paste and confirm BEFORE pushing the code. The code fails
-- CLOSED without it in the most literal way — the terminal update in
-- finish() would name columns that do not exist, the write would error, and
-- a finished render would not transition. Idempotent; a double-paste is
-- harmless.

-- 1. Which voice spoke, and how it was configured.
--
--    dialogue_voice_id is the catalogue row. dialogue_voice_external_id is
--    the provider's own permanent id, kept SEPARATELY and deliberately
--    without a foreign key: character_profiles.voice_id is nullable and a
--    preset can be retired, and a record that evaporates with the catalogue
--    row is not a record. This column is the one that survives.
alter table public.generations
  add column if not exists dialogue_voice_id uuid,
  add column if not exists dialogue_voice_external_id text,
  add column if not exists voice_settings jsonb;

-- 2. WHERE THE AUDIBLE VOICE CAME FROM. The whole point of the migration.
--
--    character — a track we synthesised from this character's own voice.
--    silent    — no voice track at all.
--    engine    — the video model's own invented voice reached the file.
--    source    — a REAL performer's recorded voice, carried over from a clip
--                the person uploaded (recast keep_audio / keep_original_sound,
--                and the long take, which re-encodes that track across every
--                join). Kept apart from `engine` because it is a different
--                kind of wrong and a worse one: not a machine inventing a
--                voice, but a specific human speaking as someone else's
--                character.
--
--    Nullable, because every row written before today genuinely has no
--    answer and guessing one would be the lie this column exists to stop.
--    Read the counts over a date window, not over all time.
alter table public.generations
  add column if not exists voice_source text;

alter table public.generations
  drop constraint if exists generations_voice_source_check;

alter table public.generations
  add constraint generations_voice_source_check
  check (voice_source is null or voice_source in ('character', 'silent', 'engine', 'source'));

-- 3. The count the claim is judged by. Cheap enough without an index at
--    today's volumes; this one keeps it that way as the table grows, and is
--    partial so it costs nothing for the rows that predate the column.
create index if not exists generations_voice_source_idx
  on public.generations (voice_source, created_at desc)
  where voice_source is not null;

-- 4. THE CLAIM, as one query. Run it after the first day of real traffic.
--    `character` is the only good row. `engine` and `source` are the gap,
--    and their size is the thing nobody has ever been able to state.
select
  voice_source,
  count(*) as takes
from public.generations
where content_type = 'video'
  and status = 'succeeded'
  and voice_source is not null
  and created_at > now() - interval '7 days'
group by voice_source
order by takes desc;
