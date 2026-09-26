-- Which wheel opens out of the assistant's lamp (2026-09-27, operator: "I
-- like it, and add blossom. Let there be 2 options for the user to pick
-- from"). Code: src/components/producer/wheel-style.ts (the styles),
-- wheel.tsx + wheel.module.css (how each draws), the picker in Settings >
-- Preferences > Your assistant, and app/app/layout.tsx (reads it).
--
-- Run it before or after the push; the code copes either way. Without the
-- column every lamp opens the default wheel (Filament), and choosing Blossom
-- in Settings says it didn't save. Idempotent: a second paste is harmless.
--
-- Values: filament | blossom. NULL = the default. The code checks the value,
-- so an unknown one also falls back to the default.
alter table public.producer_prefs
  add column if not exists wheel_style text;

-- Check: expected one row, data_type text.
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'producer_prefs' and column_name = 'wheel_style';
