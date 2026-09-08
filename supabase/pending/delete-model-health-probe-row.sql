-- A fake model left in model_health by a probe script.
--
-- On 2026-08-31 an investigation script recorded a failure for a model called
-- "zzz" to see how record_model_failure behaved. The row it left — model_id
-- 'zzz', last_error 'probe', no successes — is still there, sitting beside
-- Kling and Seedance in a table the admin providers page reads. It trips
-- nothing (its failure counter is zero) and means nothing. The scripts that
-- made it left the repository on 2026-09-08; this is the last of their
-- residue found so far. Idempotent.
DELETE FROM public.model_health WHERE model_id = 'zzz';
