-- =====================================================================
-- 2026-08-19  User-actions hardening (round 7) — PENDING, apply to live DB.
--
-- Companion SQL for the fixes in:
--   src/lib/characters/actions.ts   (atomic reference-image caps)
--   src/lib/prompts/actions.ts      (race-safe saved-prompt cap)
--   src/lib/brand-rules/actions.ts  (race-safe rule cap)
--   src/lib/push/actions.ts        (service-role token claim, strict RLS)
--   src/lib/attachments/actions.ts (bucket-level upload limits)
--
-- The code FAILS CLOSED until this file is applied: the reference-image
-- generator, "save prompt" and "add brand rule" all call the RPCs below and
-- return a retry error if the function is missing. Apply this before (or
-- with) the deploy that ships those actions.
--
-- IMPORTANT — schema drift: schema.sql has no DDL for several live tables
-- (reference_image_generations, push_tokens, feedback, saved_prompts,
-- brand_rules). Everything here is idempotent and written against the
-- column names the app actually uses; the operator must reconcile each
-- statement against the live table definitions before applying (in
-- particular: confirm reference_image_generations has `id uuid default
-- gen_random_uuid() primary key`, `user_id uuid`, `created_at timestamptz
-- default now()`, and that saved_prompts / brand_rules columns match the
-- INSERT lists below).
--
-- Advisory-lock keyspace (per-user, hashtextextended(user_id, KEY)):
--   0 = api_rate_check, 7 = record_prompt_assist, 11 = claim_job_advance,
--   23 = reserve_generation(s). New keys claimed here: 29 (reference
--   images), 31 (saved prompts), 37 (brand rules).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Reference-image caps, made atomic (characters/actions.ts).
--
-- Both caps were read-check-generate-record in the action, so a concurrent
-- burst all read the same count/counter and all passed — unlimited free
-- paid-API image generations (same bug class the composer fixed with
-- reserve_generation, commits 538a2ee / 4a4e3ee). The action now reserves
-- BEFORE the paid OpenAI/fal call and refunds on failure, preserving the
-- old "a failed attempt never burns a slot" semantics.
-- ---------------------------------------------------------------------

-- Free tier: atomic "increment iff under the lifetime limit" on the
-- profiles counter — the guarded-UPDATE pattern of spend_free_generation.
-- No advisory lock needed: the single UPDATE is already atomic.
CREATE OR REPLACE FUNCTION public.spend_free_reference_generation(p_user_id uuid, p_limit int)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE updated int;
BEGIN
  UPDATE public.profiles
     SET free_reference_generations_used = coalesce(free_reference_generations_used,0) + 1
   WHERE id = p_user_id AND coalesce(free_reference_generations_used,0) < p_limit;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END $$;

-- Refund for a failed generation (provider error, safety rejection, upload
-- failure). greatest(0, ...) so a stray double-refund can't mint allowance.
CREATE OR REPLACE FUNCTION public.refund_free_reference_generation(p_user_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.profiles
     SET free_reference_generations_used = greatest(0, coalesce(free_reference_generations_used,0) - 1)
   WHERE id = p_user_id;
$$;

-- Paid plans: serialize count-and-insert per user under one advisory lock
-- (style of record_prompt_assist). Returns the reserved meter row's id so
-- the caller can delete exactly that row on failure, or NULL when the
-- billing-period cap is already spent.
CREATE OR REPLACE FUNCTION public.reserve_reference_image_generation(
  p_user_id uuid, p_cap int, p_since timestamptz
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE used int; new_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 29));
  SELECT count(*) INTO used FROM public.reference_image_generations
   WHERE user_id = p_user_id AND created_at >= p_since;
  IF used >= p_cap THEN RETURN NULL; END IF;
  INSERT INTO public.reference_image_generations (user_id) VALUES (p_user_id)
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.spend_free_reference_generation(uuid,int) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_free_reference_generation(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_reference_image_generation(uuid,int,timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spend_free_reference_generation(uuid,int) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_free_reference_generation(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_reference_image_generation(uuid,int,timestamptz) TO service_role;

-- ---------------------------------------------------------------------
-- 2. reference_image_generations must not be user-writable.
--
-- The table is a billing meter: if authenticated can DELETE its own rows,
-- a user resets their own monthly cap; if it can INSERT arbitrary rows it
-- can (at worst) only hurt itself, but there is no reason to allow it —
-- all inserts now go through reserve_reference_image_generation (service
-- role). Table grants trump RLS policies, so revoking here closes the
-- hole regardless of what policies exist on the live table.
--
-- OPERATOR: verify against the live DB that (a) RLS is enabled on this
-- table, (b) no permissive FOR ALL / INSERT / UPDATE / DELETE policy for
-- authenticated remains (drop it if so), and (c) nothing else reads it
-- with a user-scoped client (as of this change, only the service-role RPC
-- above touches it; an owner-scoped SELECT policy is harmless to keep).
-- ---------------------------------------------------------------------
ALTER TABLE public.reference_image_generations ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.reference_image_generations FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. push_tokens: registration is service-role only; RLS stays strict.
--
-- registerPushToken now claims a token for the signing-in account through
-- the service-role client regardless of which account held it before —
-- the only write that can safely cross owners, because it is keyed on the
-- exact token the device itself presented (see push/actions.ts). An
-- owner-scoped RLS INSERT/UPDATE policy cannot express that reassignment
-- without also letting any user rewrite anyone's rows, so authenticated
-- loses INSERT/UPDATE entirely. DELETE stays owner-scoped: forgetPushToken
-- (sign-out) deletes the caller's own row with the user client.
--
-- OPERATOR: verify against the live DB that RLS is enabled and the
-- remaining authenticated policies are at most: SELECT own rows
-- (user_id = auth.uid()) and DELETE own rows (user_id = auth.uid()).
-- Drop any INSERT/UPDATE/FOR ALL policy for authenticated.
-- ---------------------------------------------------------------------
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE ON public.push_tokens FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Race-safe saved-prompt cap (prompts/actions.ts savePrompt).
--
-- Count-then-insert raced: a concurrent burst all counted 199 and all
-- inserted. Same advisory-lock check-and-insert as record_prompt_assist.
-- Returns the inserted row as jsonb (the action echoes it back to the
-- client), or NULL when the library is full.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.insert_saved_prompt_capped(
  p_user_id uuid, p_cap int, p_prompt text, p_source_input text,
  p_character_profile_id uuid, p_content_type text, p_source text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE used int; rec record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 31));
  SELECT count(*) INTO used FROM public.saved_prompts WHERE user_id = p_user_id;
  IF used >= p_cap THEN RETURN NULL; END IF;
  INSERT INTO public.saved_prompts
    (user_id, prompt, source_input, character_profile_id, content_type, source)
  VALUES
    (p_user_id, p_prompt, p_source_input, p_character_profile_id, p_content_type, p_source)
  RETURNING id, prompt, source_input, character_profile_id, content_type, source, created_at
    INTO rec;
  RETURN to_jsonb(rec);
END $$;
REVOKE EXECUTE ON FUNCTION public.insert_saved_prompt_capped(uuid,int,text,text,uuid,text,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_saved_prompt_capped(uuid,int,text,text,uuid,text,text) TO service_role;

-- ---------------------------------------------------------------------
-- 5. Race-safe brand-rule cap (brand-rules/actions.ts addBrandRule +
-- applyBrandRulePack). Batch form, because a pack inserts several rules
-- under one cap check. Returns the number inserted, or -1 when the batch
-- would push the account past the cap (nothing inserted in that case).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.insert_brand_rules_capped(
  p_user_id uuid, p_cap int, p_rules jsonb
) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing int; n int; elem jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 37));
  SELECT count(*) INTO existing FROM public.brand_rules WHERE user_id = p_user_id;
  n := coalesce(jsonb_array_length(p_rules), 0);
  IF n = 0 THEN RETURN 0; END IF;
  IF existing + n > p_cap THEN RETURN -1; END IF;
  FOR elem IN SELECT * FROM jsonb_array_elements(p_rules) LOOP
    INSERT INTO public.brand_rules (user_id, kind, label, value, applies_to, severity)
    VALUES (p_user_id, elem->>'kind', elem->>'label', elem->>'value',
            elem->>'applies_to', elem->>'severity');
  END LOOP;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.insert_brand_rules_capped(uuid,int,jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_brand_rules_capped(uuid,int,jsonb) TO service_role;

-- ---------------------------------------------------------------------
-- 6. Storage bucket hardening (attachments/actions.ts and the character /
-- generation image paths).
--
-- The 25MB cap and filename sanitization live in the server actions, but
-- storage RLS lets authenticated upload DIRECTLY to these buckets from the
-- client (that is by design — the character form uploads before saving),
-- so the action-level caps are advisory until the bucket enforces them.
-- Limits are picked from what the app actually sends:
--   chat-attachments      — composer accepts image/*, video/*, .pdf, .txt,
--                           .doc, .docx (generate-form.tsx), and
--                           uploadChatAttachment falls back to
--                           application/octet-stream for unknown types.
--                           25MB, matching MAX_FILE_BYTES in the action.
--   character-references  — user photos (accept="image/*") plus server-
--                           generated PNGs. Images only, 25MB.
--   generated-images      — server-side PNG output only. Images only,
--                           50MB of headroom for large renders.
--
-- OPERATOR: apply via SQL or the dashboard; verify bucket ids match the
-- live project, and that existing legitimate uploads aren't rejected
-- (file_size_limit is in bytes; storage-api enforces both fields on
-- every upload regardless of role).
-- ---------------------------------------------------------------------
UPDATE storage.buckets
   SET file_size_limit = 26214400, -- 25MB, = MAX_FILE_BYTES in attachments/actions.ts
       allowed_mime_types = ARRAY[
         'image/*', 'video/*', 'application/pdf', 'text/plain',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/octet-stream'
       ]
 WHERE id = 'chat-attachments';

UPDATE storage.buckets
   SET file_size_limit = 26214400, -- 25MB
       allowed_mime_types = ARRAY['image/*']
 WHERE id = 'character-references';

UPDATE storage.buckets
   SET file_size_limit = 52428800, -- 50MB
       allowed_mime_types = ARRAY['image/*']
 WHERE id = 'generated-images';

-- ---------------------------------------------------------------------
-- 7. No new SQL needed for the voice / feedback / attachment rate limits —
-- they reuse public.api_rate_check (schema.sql), which is already
-- SECURITY DEFINER, advisory-locked, and REVOKEd from authenticated.
-- ---------------------------------------------------------------------
