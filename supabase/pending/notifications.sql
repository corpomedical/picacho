-- Settings → Notifications (2026-09-11).
--
-- Three per-account switches, a once-per-period stamp for the low-credit
-- alert, and a table for browser (Web Push) devices — the twin of
-- push_tokens, which holds the native shell's FCM tokens.
--
-- Safe to run before or after the code ships: every reader fails open (a
-- missing column means "on", a missing table means "no browser devices"),
-- so neither order breaks a render or a notification. Idempotent.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notify_render_ready    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_render_failed   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_low_credits     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS low_credit_notified_at timestamptz;

CREATE TABLE IF NOT EXISTS public.user_push_subscriptions (
  endpoint     text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  p256dh       text NOT NULL,
  auth         text NOT NULL,
  locale       text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS user_push_subscriptions_user_idx
  ON public.user_push_subscriptions (user_id);

ALTER TABLE public.user_push_subscriptions ENABLE ROW LEVEL SECURITY;

-- People may see and remove their own browser devices. Every WRITE that
-- creates or claims a row goes through the service role (a shared browser
-- changing hands must move to the new account — owner-scoped RLS cannot
-- express that), exactly as push_tokens does.
DROP POLICY IF EXISTS "Users read their own push subscriptions" ON public.user_push_subscriptions;
CREATE POLICY "Users read their own push subscriptions"
  ON public.user_push_subscriptions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete their own push subscriptions" ON public.user_push_subscriptions;
CREATE POLICY "Users delete their own push subscriptions"
  ON public.user_push_subscriptions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

REVOKE ALL ON public.user_push_subscriptions FROM anon, authenticated;
GRANT SELECT, DELETE ON public.user_push_subscriptions TO authenticated;
GRANT ALL ON public.user_push_subscriptions TO service_role;

-- Verify:
--   select column_name from information_schema.columns
--    where table_name = 'profiles' and column_name like 'notify_%';   -> 3 rows
--   select count(*) from public.user_push_subscriptions;               -> 0
