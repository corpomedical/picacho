-- The Producer's lamp look (2026-09-25, operator: "I like Two fireflies. Lets
-- try that and add Eclipse and The original perfected in the settings for the
-- user to select from"). Code: src/components/producer/lamp-look.ts (the
-- looks), lamp-looks.tsx + looks/*.module.css (how each draws), the picker in
-- Settings > Preferences > Your assistant, and app/app/layout.tsx (reads it).
--
-- Run it before or after the push; the code copes either way. Without the
-- column every lamp shows the default look (Two fireflies), and choosing
-- another in Settings says it didn't save. Idempotent: a second paste is
-- harmless.
--
-- Values: fireflies | eclipse | perfected. NULL = the default. The code
-- checks the value, so an unknown one also falls back to the default.
alter table public.producer_prefs
  add column if not exists lamp_look text;

-- Check: expected one row, data_type text.
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'producer_prefs' and column_name = 'lamp_look';
