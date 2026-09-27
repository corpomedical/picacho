-- Which wheel opens out of the assistant's lamp, and how its chat shows
-- itself (2026-09-27, operator: "I like it, and add blossom. Let there be 2
-- options for the user to pick from", then "Add the subtitles too as an
-- option in settings"). Code: src/components/producer/wheel-style.ts and
-- chat-style.ts (the choices), wheel.tsx / producer-lamp.tsx (how each
-- draws), the pickers in Settings > Preferences > Your assistant, and
-- app/app/layout.tsx (reads them).
--
-- Run it before or after the push; the code copes either way. Without the
-- columns every lamp opens the default wheel (Filament) and the floating
-- card, and choosing another in Settings says it didn't save. Idempotent: a
-- second paste is harmless (also after an earlier paste of the wheel line).
--
-- wheel_style: filament | blossom. chat_style: card | subtitles. NULL = the
-- default. The code checks the value, so an unknown one also falls back.
alter table public.producer_prefs
  add column if not exists wheel_style text;
alter table public.producer_prefs
  add column if not exists chat_style text;

-- Check: expected two rows, both data_type text.
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'producer_prefs' and column_name in ('wheel_style', 'chat_style');
