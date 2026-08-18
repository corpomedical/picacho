-- =====================================================================
-- Pending migration, 2026-08-19 — generation-pipeline review fixes.
-- Apply to the live Supabase project, then fold into schema.sql on the
-- next re-snapshot. Everything here is idempotent (IF NOT EXISTS /
-- CREATE OR REPLACE), so re-running it is safe.
--
-- Companion code changes (already merged, degrade gracefully until this
-- is applied):
--   * job-runner.ts refundGenerationCosts stamps/counts refunded_at
--     (needs the column below; with automatic_refunds OFF — the current
--     state — the code path never runs, so ordering is not urgent).
--   * job-runner.ts reapStaleJobs sweeps orphaned status='generating'
--     rows (works without the index below, just slower).
--   * model-health.ts recordModelFailure calls record_model_failure()
--     (falls back to the old lossy read-modify-write until this exists).
--
-- New env var (separate from this file, for the operator):
--   FAL_ACCOUNT_ID — our fal.ai account/user id, as fal sends it in the
--   x-fal-webhook-user-id header. When set, /api/webhooks/fal rejects
--   validly-signed deliveries for OTHER fal customers' jobs; unset keeps
--   the previous accept-any-customer behavior (warned once at runtime).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Honest refund marker (job-runner.ts refundGenerationCosts).
--
-- The daily refunded-failure cap used to count "failed rows with
-- credits_used = 0" as refunds — but the guarded-spend abort paths (a
-- lost race for the last credit, before any provider call) also produce
-- failed rows with zeroed credits, so every abort silently ate a slot of
-- the cap and withheld legitimate refunds. refunded_at is stamped only
-- by refundGenerationCosts, at the moment it actually releases the
-- allowance, making refunds distinguishable from releases.
-- ---------------------------------------------------------------------
ALTER TABLE public.generations
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

-- The daily-cap query is "this user's refunds in the last 24h" — a
-- partial index keeps it a point lookup no matter how big the table gets.
CREATE INDEX IF NOT EXISTS generations_refunds_by_user
  ON public.generations (user_id, refunded_at)
  WHERE refunded_at IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. Orphaned-generation sweep support (job-runner.ts reapStaleJobs).
--
-- The reaper now also scans for rows stuck at status='generating' with
-- no generation_jobs row (the function died between reserve_generation
-- and saveVideoJob — nothing can ever poll, webhook, or reap those
-- through the job table). That scan filters user_id + status +
-- created_at; this partial index keeps it cheap on every workspace page
-- load. At any moment only a handful of rows are 'generating', so the
-- index stays tiny.
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS generations_generating_by_user
  ON public.generations (user_id, created_at)
  WHERE status = 'generating';

-- ---------------------------------------------------------------------
-- 3. Atomic circuit-breaker increment (model-health.ts).
--
-- recordModelFailure was a JS read-modify-write, which loses counts under
-- concurrent failures — and concurrent failures are exactly what an
-- outage produces: three simultaneous failures could all read
-- consecutive_failures = 0 and all write 1, so the breaker built for
-- outages could fail to trip during one. This serializes the whole
-- increment-merge-trip decision per model under one advisory lock,
-- preserving the failing_user_ids distinct-merge semantics. Thresholds
-- and cooldowns are passed in by the caller so the constants stay
-- single-sourced in model-health.ts.
--
-- NOTE for the operator: model_health has no DDL in the repo (known
-- schema drift — PROJECT_REVIEW_2026-08-19.md item 27). This function
-- assumes model_id is the PK/unique key (what the app's upserts already
-- rely on) and failing_user_ids is uuid[]. If the live column is text[],
-- change p_user_id's two uses below to p_user_id::text and the ARRAY
-- literal's cast to text[].
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_model_failure(
  p_model_id text,
  p_kind text,
  p_error text,
  p_user_id uuid,
  p_failure_threshold int,
  p_min_distinct_users int,
  p_base_cooldown_ms bigint,
  p_max_cooldown_ms bigint
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_failures int;
  v_trip_count int;
  v_users uuid[];
  v_should_trip boolean;
  v_cooldown_ms bigint;
BEGIN
  -- Serialize per model. Seed 29 — distinct from the other advisory-lock
  -- seeds in schema.sql (0, 7, 11, 23) so unrelated locks never collide.
  PERFORM pg_advisory_xact_lock(hashtextextended('model_health:' || p_model_id, 29));

  -- First failure ever for this model: create the base row so the locked
  -- read-update below always has something to work on.
  INSERT INTO public.model_health (model_id, kind, consecutive_failures, failing_user_ids, trip_count, updated_at)
  VALUES (p_model_id, p_kind, 0, '{}', 0, now())
  ON CONFLICT (model_id) DO NOTHING;

  SELECT coalesce(consecutive_failures, 0) + 1,
         coalesce(trip_count, 0),
         (SELECT coalesce(array_agg(DISTINCT u), '{}')
            FROM unnest(
              coalesce(failing_user_ids, '{}')
              || CASE WHEN p_user_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[p_user_id] END
            ) AS u)
    INTO v_failures, v_trip_count, v_users
    FROM public.model_health
   WHERE model_id = p_model_id
   FOR UPDATE;

  v_should_trip := v_failures >= p_failure_threshold
               AND coalesce(array_length(v_users, 1), 0) >= p_min_distinct_users;
  IF v_should_trip THEN
    v_trip_count := v_trip_count + 1;
  END IF;
  -- Cooldown doubles per consecutive trip, capped — mirrors the old JS
  -- calculation exactly (BASE * 2^(trip_count - 1), max MAX).
  v_cooldown_ms := least(
    (p_base_cooldown_ms * (2 ^ greatest(0, v_trip_count - 1))::numeric)::bigint,
    p_max_cooldown_ms
  );

  UPDATE public.model_health
     SET kind = p_kind,
         consecutive_failures = v_failures,
         failing_user_ids = v_users,
         last_error = left(p_error, 500),
         last_failure_at = now(),
         updated_at = now(),
         tripped_at = CASE WHEN v_should_trip THEN now() ELSE tripped_at END,
         retry_after = CASE WHEN v_should_trip
                            THEN now() + make_interval(secs => v_cooldown_ms / 1000.0)
                            ELSE retry_after END,
         trip_count = CASE WHEN v_should_trip THEN v_trip_count ELSE trip_count END
   WHERE model_id = p_model_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.record_model_failure(text,text,text,uuid,int,int,bigint,bigint)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_model_failure(text,text,text,uuid,int,int,bigint,bigint)
  TO service_role;
