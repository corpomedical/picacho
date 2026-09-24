-- Live — MiniMax H3 Max Director (2026-09-24): a take that streams while the
-- person keeps typing directions into it. Code: src/lib/live/, the page at
-- /app/live, the relay at /api/live/relay.
--
-- RUN THIS BEFORE PUSHING THE CODE. Idempotent: a second paste is harmless.
--
-- TWO SWITCHES (operator, 2026-09-24: "Admins first"):
--   live             ON  — Live exists: admins can use it. Turning it off in
--                          Admin hides the door everywhere and the relay
--                          refuses every call at once (the kill switch).
--   live_paid_plans  OFF — flip it on after the first paid admin take shows
--                          fal's own filter refusing what it should: then
--                          every paid plan gets Live. (A live take's words go
--                          browser → fal, where no server can read them, so
--                          fal's filter is the last guard against someone who
--                          skips ours.)
--
-- NO TABLE, the recast.sql shape: a take is an ordinary generations row
-- (model_id 'live-h3-director') plus ONE jsonb column holding the meter —
-- the paid length, when fal's session opened, the last heartbeat the relay
-- forwarded, and how it settled. Only src/lib/live/ names this column.
alter table public.generations add column if not exists live jsonb;

-- Bounded: the server writes a few KB at most (twenty directions of 300
-- characters, ~18 KB in a three-byte script); the bound keeps a bug from
-- storing a novel.
alter table public.generations drop constraint if exists generations_live_check;
alter table public.generations add constraint generations_live_check check (
  live is null or pg_column_size(live) <= 65536
);

insert into public.feature_flags (key, enabled, description)
values (
  'live',
  true,
  'Live (H3 Max Director): a take that streams while you direct it. Off = the door disappears and the relay refuses. Needs FAL_KEY.'
)
on conflict (key) do nothing;

insert into public.feature_flags (key, enabled, description)
values (
  'live_paid_plans',
  false,
  'Live for every paid plan. Off = admins only. Turn on after a paid admin take shows fal refusing what it should: a live take''s words go straight from the browser to fal.'
)
on conflict (key) do nothing;
