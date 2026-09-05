-- =====================================================================
-- Pending migration, 2026-08-19 — "Made with Picacho" public gallery.
-- Apply to the live Supabase project, then fold into schema.sql on the
-- next re-snapshot. Everything here is idempotent (IF NOT EXISTS), so
-- re-running it is safe.
--
-- Apply BEFORE deploying the matching app changes: the admin user page
-- (admin/users/[id]) now selects generations.featured_at, and /gallery
-- filters on it. Deployed against a database without the column, both
-- degrade rather than break (the admin "Recent generations" card comes
-- back empty and /gallery shows its empty state) — but there's no reason
-- to sit in that window; this file is one ALTER and one index.
--
-- Companion code changes:
--   * lib/admin/actions.ts setGenerationFeatured — the ONLY writer of
--     this column (service client, after requireAdmin + an owner-role
--     check on the row).
--   * app/gallery/page.tsx — public read via the service client:
--     status='succeeded' AND featured_at IS NOT NULL, newest first.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Featured marker.
--
-- A timestamp, not a boolean: featured_at doubles as the gallery's sort
-- key ("most recently featured first"), and NULL means not featured —
-- no second column, no backfill.
--
-- V1 CONTENT-RIGHTS RULE: only generations OWNED BY AN ADMIN account
-- may ever be featured. Customer content is never publishable without a
-- consent mechanism, which is deliberately out of scope for v1 — so the
-- rule is enforced twice in code: setGenerationFeatured refuses to
-- feature a row whose owner's profiles.role is not 'admin', and
-- /gallery's read re-checks the owner's role before rendering, so a
-- featured_at that appears on a customer row by any other route stays
-- invisible to the public.
--
-- No RLS change: the public page reads through the service client, and
-- the existing owner-scoped policies are untouched.
--
-- Grant note (profiles-style — see the 2026-08-18 profiles column
-- lockdown in schema.sql): generations still carries PostgREST's default
-- table-wide UPDATE grant for authenticated, row-scoped by the "Users
-- manage their own generations" policy. In principle a row's OWNER could
-- therefore set featured_at on their own row via the REST API; the
-- owner-role re-check at render time (above) makes that inert for the
-- public gallery. The stronger fix is the same column-level lockdown
-- profiles got:
--
--   REVOKE UPDATE ON public.generations FROM authenticated;
--   GRANT UPDATE (cancel_requested, feedback)
--     ON public.generations TO authenticated;
--
-- (cancel_requested and feedback are the only columns the app updates
-- with a user-session client today — the Stop button and the thumbs
-- rating; everything else already writes via the service role.)
-- OPERATOR: deliberately NOT applied here — it changes live write paths
-- well beyond this feature. Verify that column list against the live
-- app's user-session writes before applying it in a lockdown pass.
-- ---------------------------------------------------------------------
ALTER TABLE public.generations
  ADD COLUMN IF NOT EXISTS featured_at timestamptz;

-- The gallery query is "featured rows, newest first, limit 60" — a
-- partial index keeps it a tiny ordered scan no matter how big the
-- table gets, and costs nothing on the (vast) unfeatured majority.
CREATE INDEX IF NOT EXISTS generations_featured
  ON public.generations (featured_at DESC)
  WHERE featured_at IS NOT NULL;
