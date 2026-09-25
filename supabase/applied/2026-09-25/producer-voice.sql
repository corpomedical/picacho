-- The Producer's voice (2026-09-25, operator: "lets change the voice
-- character, its sounds ai"). Code: src/lib/producer/ (speech.ts speakHuman,
-- store.ts loadProducerVoice), the voice picker in Settings > Preferences.
--
-- APPLIED 2026-09-25 (the operator ran it with the push: "Pushed, SQL ran";
-- the live Settings page lists the four voices from voice_presets and a
-- preview came back from fal). Idempotent: a second paste is harmless.
--
-- Which of the admin-picked voices (voice_presets, the same list characters
-- choose from) the person's Producer speaks with. NULL = the first voice in
-- that list. A voice deleted in Admin falls back to the first again.
alter table public.producer_prefs
  add column if not exists voice_preset_id uuid references public.voice_presets (id) on delete set null;

-- Check: expected one row, data_type uuid.
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'producer_prefs' and column_name = 'voice_preset_id';
