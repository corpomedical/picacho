-- =====================================================================
-- 2026-08-21  Admin console (picacho-admin PWA) — PENDING, apply to live DB.
--
-- The read-only admin PWA authenticates with the ADMIN'S OWN session over
-- the anon key, so row-level security decides what it can see. That premise
-- held for the tables in the 2026-08-05 schema snapshot (profiles,
-- generations, character_profiles all have "Admins can view all …"
-- policies) but every table added after the snapshot shipped without an
-- admin read policy — credit_purchases, promo_redemptions,
-- generation_reports, api_keys, model_health. The main site never noticed
-- because /admin reads through the service-role key, which bypasses RLS.
-- The PWA noticed: those cards all render empty. Section 1 fixes that.
--
-- The PWA's live feed subscribes to postgres_changes, which only delivers
-- events for tables in the supabase_realtime publication — and no table was
-- ever added to it, so the feed has been silent since day one. Section 2
-- fixes that. Realtime enforces RLS per subscriber: a non-admin who
-- subscribes to these tables receives only rows their own policies let them
-- SELECT (their own generations, their own profile), so publishing adds no
-- new exposure.
--
-- Section 3 creates the table behind real background push (Web Push/VAPID):
-- the PWA stores each admin device's push subscription here with the
-- admin's own JWT; the main app's server reads it with the service role to
-- send. Companion code: picacho-admin/app.js (subscribe flow) and
-- src/lib/push/web-push.ts (sender).
--
-- Everything below is guarded and idempotent: policies are created only if
-- absent, publication entries only if absent, and tables whose DDL never
-- lived in this repo (model_health) are touched only if they exist. RLS is
-- deliberately NOT toggled on pre-existing tables — only policies are
-- added, which never widens non-admin access (every new policy is gated on
-- is_admin()).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Admin read policies on post-snapshot tables.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  t text;
  pol text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'credit_purchases', 'promo_redemptions', 'generation_reports',
    'api_keys', 'model_health', 'drip_sends'
  ] LOOP
    pol := 'Admins can view all ' || replace(t, '_', ' ');
    IF to_regclass('public.' || t) IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = t AND policyname = pol
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT USING (is_admin())', pol, t
      );
    END IF;
  END LOOP;
END $$;

-- model_health is written only by the job runner through the service role
-- (which bypasses RLS), so enabling RLS here breaks nothing and closes the
-- gap where any signed-in user could read provider health. Guarded because
-- the table's DDL never lived in this repo.
DO $$
BEGIN
  IF to_regclass('public.model_health') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.model_health ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. Realtime publication for the live feed.
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY[
      'generations', 'profiles', 'credit_purchases', 'promo_redemptions',
      'generation_reports', 'api_keys'
    ] LOOP
      IF to_regclass('public.' || t) IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3. Web Push subscriptions for admin devices.
--
-- One row per browser/device that enabled alerts in the admin PWA. The
-- endpoint IS the identity (a per-device URL minted by the browser's push
-- service), so it is the primary key and re-enabling on the same device
-- upserts rather than duplicating. p256dh/auth are the client's public
-- encryption parameters — public by design in the Web Push protocol; the
-- private half never leaves the device.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_push_subscriptions (
  endpoint text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

ALTER TABLE public.admin_push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Admins manage their own devices with their own JWT; the sender reads all
-- rows through the service role (bypasses RLS). Non-admins can do nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'admin_push_subscriptions'
       AND policyname = 'Admins manage their own push subscriptions'
  ) THEN
    EXECUTE 'CREATE POLICY "Admins manage their own push subscriptions"
      ON public.admin_push_subscriptions FOR ALL
      USING (auth.uid() = user_id AND is_admin())
      WITH CHECK (auth.uid() = user_id AND is_admin())';
  END IF;
END $$;

REVOKE ALL ON public.admin_push_subscriptions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_push_subscriptions TO authenticated;
