-- Play Billing groundwork (2026-08-21). Run in the Supabase SQL editor.
--
-- One user can now pay through Stripe (web) OR Google Play (app), and the
-- profile has to say which system owns the current plan — every webhook
-- writes plan fields, and without an owner column a stale event from the
-- OTHER system could silently wipe a live subscription (e.g. an old Stripe
-- subscription.deleted arriving after the user re-subscribed through Play).
-- Both webhooks guard on plan_source before resetting anything.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan_source text
    CHECK (plan_source IN ('stripe', 'play'));

-- The Play product id behind the current plan (e.g. 'sub_growth') — for the
-- settings page ("manage in Google Play"), support, and webhook sanity
-- checks. NULL for Stripe-billed and free profiles.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS play_product_id text;

-- Backfill: every currently paying profile predates Play Billing, so its
-- plan is Stripe's. Free profiles stay NULL.
UPDATE public.profiles
   SET plan_source = 'stripe'
 WHERE plan <> 'none'
   AND plan_source IS NULL
   AND stripe_subscription_id IS NOT NULL;

-- No RLS changes: both columns are written by the service-role webhooks
-- only, and profiles' existing self-read policy covers the settings page.
