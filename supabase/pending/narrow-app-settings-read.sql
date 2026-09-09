-- The last server error is readable by every signed-in user.
--
-- onRequestError (src/instrumentation.ts) writes the most recent server
-- error into app_settings under last_server_error and last_server_error_419,
-- message and digest included, so the operator can read the cause of a #419
-- where they already look. But app_settings' SELECT policy is
-- `to authenticated using (true)` — it was written for the settings the
-- client genuinely needs, and it now also hands any signed-in account the
-- text of our most recent server-side failure. Found in the 2026-09-09
-- review of that day's commits.
--
-- The narrowest fix that changes nothing for the client: the same policy,
-- with the error rows carved out for non-admins. Every key the app reads
-- today still reads; only the two sink rows become admin-only. The UPDATE
-- policy already gates on is_admin() and is untouched.
--
-- Apply as the service role. Idempotent.

drop policy if exists "Authenticated users can read app settings" on public.app_settings;

create policy "Authenticated users can read app settings"
  on public.app_settings
  for select
  to authenticated
  using (
    key not like 'last_server_error%'
    or (select is_admin())
  );

-- Verify: as a non-admin session,
--   select key from app_settings where key like 'last_server_error%';
-- must return zero rows. As an admin it returns two.
