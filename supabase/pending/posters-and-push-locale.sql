-- Poster frames + per-device push locale (2026-09-05, closing two
-- partially-fixed audit findings). Idempotent; safe to paste twice.
--
-- 1) generations.poster_url — a still frame saved into generated-images at
--    render-finish time (and backfilled by the daily reconcile cron), so a
--    grid of video tiles can paint real thumbnails instead of mounting video
--    elements. Relative /api/media capability URL, same form as result_url.
alter table public.generations
  add column if not exists poster_url text;

-- 2) push_tokens.locale — the language the device's owner was using when the
--    device registered (re-registered on every app launch, so it follows a
--    language switch within a day). The push sender reads it per device so
--    "Your video is ready" arrives in the user's own language — the last
--    English-only surface after the 2026-09-05 server-string localization.
alter table public.push_tokens
  add column if not exists locale text;
