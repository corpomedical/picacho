import { createHmac } from "node:crypto";

// OpenAI's safety_identifier (2026-09-10): a stable, opaque id per end user,
// sent with a request so that OpenAI can act on ONE account that misuses the
// API instead of on Picacho's whole organisation. Picacho sent none before
// this — every request looked like it came from one very busy user.
//
// Opaque by construction: an HMAC of the account id, never the id or the
// email itself, so nothing OpenAI stores can be joined back to a person
// without our key. Keyed with a dedicated secret when the operator sets one,
// the service-role key otherwise (the media signer's pattern, lib/media/url.ts
// — no new secret required to ship). Changing the key re-issues every id,
// which only resets OpenAI's per-user history; it breaks nothing here.
//
// Relative imports only: tests import this without the "@/" alias.

const LABEL = "picacho:openai-safety-id:v1:";

export function openAiSafetyId(userId: string): string | undefined {
  const key = process.env.OPENAI_SAFETY_ID_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !userId) return undefined;
  // 64 hex characters, within the field's documented limit.
  return createHmac("sha256", key).update(LABEL + userId).digest("hex");
}
