-- Onboarding email drip (2026-08-21). Run in the Supabase SQL editor.
--
-- Three lifecycle emails (day-1 nudge, day-3 proof story, day-7 plans, sent
-- by /api/cron/drip once a day). Eligibility lives HERE, in one definer
-- function, because it has to join auth.users — marketing must only ever go
-- to CONFIRMED addresses, and auth.users is where confirmation lives.
-- The dedup table guarantees at-most-once per template per person for life.

CREATE TABLE IF NOT EXISTS public.drip_sends (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  template text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, template)
);

-- Service-role only: the cron route writes it, nobody else.
ALTER TABLE public.drip_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.drip_sends FROM anon, authenticated;

-- Today's send list. Window edges are deliberately wide (24h bands) because
-- the cron fires once a day — a signup is picked up by whichever daily run
-- lands inside its band; anyone missed (downtime) simply ages out rather
-- than getting a stale "welcome" a month later.
CREATE OR REPLACE FUNCTION public.drip_candidates()
RETURNS TABLE (user_id uuid, email text, username text, full_name text, template text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH confirmed AS (
    SELECT u.id, u.email::text AS email, p.username, p.full_name, p.created_at, p.plan
      FROM auth.users u
      JOIN public.profiles p ON p.id = u.id
     WHERE u.email_confirmed_at IS NOT NULL
       AND COALESCE(p.marketing_opt_out, false) = false
       AND COALESCE(p.status, 'active') <> 'suspended'
  )
  SELECT c.id, c.email, c.username, c.full_name, 'drip_day1'
    FROM confirmed c
   WHERE c.created_at BETWEEN now() - interval '48 hours' AND now() - interval '24 hours'
     AND NOT EXISTS (SELECT 1 FROM public.generations g WHERE g.user_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM public.drip_sends d WHERE d.user_id = c.id AND d.template = 'drip_day1')
  UNION ALL
  SELECT c.id, c.email, c.username, c.full_name, 'drip_day3'
    FROM confirmed c
   WHERE c.created_at BETWEEN now() - interval '96 hours' AND now() - interval '72 hours'
     AND NOT EXISTS (SELECT 1 FROM public.drip_sends d WHERE d.user_id = c.id AND d.template = 'drip_day3')
  UNION ALL
  SELECT c.id, c.email, c.username, c.full_name, 'drip_day7'
    FROM confirmed c
   WHERE c.created_at BETWEEN now() - interval '192 hours' AND now() - interval '168 hours'
     AND c.plan = 'none'
     AND NOT EXISTS (SELECT 1 FROM public.drip_sends d WHERE d.user_id = c.id AND d.template = 'drip_day7')
$$;

REVOKE ALL ON FUNCTION public.drip_candidates() FROM anon, authenticated;
