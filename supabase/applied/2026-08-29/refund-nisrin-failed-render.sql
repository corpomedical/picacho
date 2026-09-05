-- Goodwill refund for the 2026-08-29 failed render (generation
-- 527b3266): three attempts, every one a provider REJECTION (OpenAI 400,
-- "Invalid image file or mode") — no provider work was ever performed, so
-- the credit should never have been charged. It was, because
-- isProviderRejection only inspected the LAST attempt, which was the
-- "already used its attempts" stub rather than one of the 400s. That rule
-- is fixed in code (refund-rules.ts + tests); this repairs the one row that
-- shipped before the fix.
--
-- Idempotent: only touches the row if it is still charged.
UPDATE public.generations
SET credits_used = 0,
    refunded_at = now()
WHERE id = '527b3266-4697-4c36-9e94-d0e2c56b0339'
  AND user_id = 'b59542fd-7b88-4de0-b1e4-12e2cbd42761'
  AND status = 'failed'
  AND refunded_at IS NULL;
