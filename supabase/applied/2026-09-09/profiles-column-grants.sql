-- What a signed-in user may change on their own profile row, written down.
--
-- The table-level UPDATE on public.profiles was revoked from authenticated at
-- some point (schema.sql shows delete/insert/select and no update), and a
-- column-level grant was made BY HAND in the dashboard for the columns the
-- settings page edits through the user's own session. No file in this trail
-- recorded it, so on 2026-09-09 a security pass had to ask the operator to
-- read information_schema.role_column_grants to learn whether `role`, `plan`
-- or the credit columns were among them. They are not; these eight are.
--
-- Running this is a no-op against production today. It exists so the trail
-- matches the database, and so that if profiles is ever rebuilt the grant is
-- re-applied from a file instead of remembered. Never widen this list to
-- role, plan, plan_status, status, purchased_credits or bonus_credits: the
-- row policy lets a user update their own row, and a column here is a
-- column they can set to anything.
GRANT UPDATE (
  company,
  full_name,
  gender,
  has_completed_onboarding,
  rating_prompted_at,
  skip_ai_refinement,
  terms_accepted_at,
  username
) ON public.profiles TO authenticated;
