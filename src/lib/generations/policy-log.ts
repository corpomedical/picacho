// The refusal log, and the session context both content gates read from it.
//
// Four things one table is, at once (2026-09-10):
//   1. SESSION CONTEXT. The prompt gate reads how many refusals this account
//      drew in the last hour and judges the next request with that in front
//      of it. That is what catches "make it more spicy" — five words that
//      mean nothing alone and everything after a boudoir refusal. The
//      policy's own header called this essential; until today nothing
//      supplied it, and every gate ran with sessionPriorHits = 0.
//   2. THE FALSE-POSITIVE DETECTOR. A refusal in production was invisible;
//      the only way to find one was to replay the whole database.
//   3. THE AUDIT TRAIL. What a Play reviewer would ask for.
//   4. A PROVIDER SIGNAL. An output block on a prompt the prompt gate scored
//      NEGLIGIBLE is the provider going off-script — a model-health fact,
//      not a customer fact.
//
// No prompt text is stored: a hash, the reason, the lane, and the bands.
//
// Everything here is best-effort in ONE direction. A refusal that cannot be
// logged is still a refusal; a count that cannot be read is zero — which is
// exactly how the gates behaved before this file existed, never an allow of
// anything and never a refusal of anything. Until the operator runs
// supabase/applied/2026-09-11/policy-refusals.sql the table does not exist and both
// calls degrade that way (one warning per process, not one per call), so
// the code ships ahead of the SQL without a customer noticing either order.
//
// Reason "unavailable" — a classifier outage, not a reading of anything the
// person wrote — is logged for the record but never counted as context, and
// neither is an output block (see recentRefusalCount).

import { createHash } from "node:crypto";
import {
  assertPromptAllowed,
  ContentPolicyRefusal,
  type Scores,
} from "@/lib/generations/content-policy";

/** prompt: before a render; output: the rendered picture; feed: a post to the community feed. */
export type PolicyGate = "prompt" | "output" | "feed";

export type PolicyRefusalRecord = {
  userId: string;
  gate: PolicyGate;
  reason: string;
  strictLane?: boolean;
  /** Hashed before it is stored; the text itself is never written. */
  prompt?: string | null;
  generationId?: string | null;
  /** The refusing gate's own readings. */
  bands?: unknown;
  /** The prompt gate's bands, when an OUTPUT block follows an allowed prompt. */
  promptBands?: Scores | null;
  provider?: string | null;
};

const CONTEXT_WINDOW_MS = 60 * 60 * 1000;

const warned = new Set<string>();
function warnOnce(op: string, message: string) {
  if (warned.has(op)) return;
  warned.add(op);
  console.warn(`[policy-log] ${op} failed (further failures of this kind are not logged): ${message}`);
}

export function promptDigest(prompt: string): string {
  return createHash("sha256").update(prompt.trim()).digest("hex");
}

/** Write one refusal row. Never throws. */
export async function recordPolicyRefusal(rec: PolicyRefusalRecord): Promise<void> {
  try {
    const { createAdminClient } = await import("@/lib/supabase/server");
    const { error } = await createAdminClient()
      .from("policy_refusals")
      .insert({
        user_id: rec.userId,
        gate: rec.gate,
        reason: rec.reason,
        strict_lane: rec.strictLane === true,
        prompt_sha256: rec.prompt ? promptDigest(rec.prompt) : null,
        generation_id: rec.generationId ?? null,
        bands: rec.bands ?? null,
        prompt_bands: rec.promptBands ?? null,
        provider: rec.provider ?? null,
      });
    if (error) warnOnce("record", error.message);
  } catch (err) {
    warnOnce("record", err instanceof Error ? err.message : String(err));
  }
}

/**
 * How many times the PROMPT gate refused this account in the last hour, not
 * counting outages. Only that gate: an output block is the provider going
 * past an allowed request — the person is told "your request was fine",
 * and judging their next one harder for an hour would make that a lie.
 * Zero on any failure — see the header.
 *
 * Only rows with no provider (2026-09-10): a prompt-gate refusal that names
 * a provider is a reading of text a MODEL wrote — Astra's description of a
 * Set — not of anything the person typed, and it must not make their next
 * hour stricter. A refusal of the person's OWN words by a provider (OpenAI
 * refusing a Set's brief, reason "astra_refused") is written without a
 * provider for exactly that reason: it is about what they asked, and
 * counts. Before this line no prompt-gate row set a provider (read from
 * production the same day: 0 of 3), so nothing already counted stops
 * counting.
 */
export async function recentRefusalCount(userId: string, windowMs = CONTEXT_WINDOW_MS): Promise<number> {
  try {
    const { createAdminClient } = await import("@/lib/supabase/server");
    const { count, error } = await createAdminClient()
      .from("policy_refusals")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("gate", "prompt")
      .is("provider", null)
      .neq("reason", "unavailable")
      .gte("created_at", new Date(Date.now() - windowMs).toISOString());
    if (error) {
      warnOnce("count", error.message);
      return 0;
    }
    return count ?? 0;
  } catch (err) {
    warnOnce("count", err instanceof Error ? err.message : String(err));
    return 0;
  }
}

/**
 * The prompt gate, with its session context read and its refusals logged.
 * Every entry-point gate goes through here; the pipeline's own re-gate of
 * the compiled prompt does the same two things inline, because it already
 * holds the count for the output gate.
 *
 * Throws {@link ContentPolicyRefusal} exactly as assertPromptAllowed does —
 * callers keep their `instanceof` handling unchanged.
 */
export async function gatePrompt(input: {
  prompt: string;
  userId: string;
  hasRealPersonReference?: boolean;
  generationId?: string | null;
}): Promise<{ scores: Scores | undefined; priorHits: number }> {
  const priorHits = await recentRefusalCount(input.userId);
  try {
    const scores = await assertPromptAllowed({
      prompt: input.prompt,
      hasRealPersonReference: input.hasRealPersonReference,
      sessionPriorHits: priorHits,
    });
    return { scores, priorHits };
  } catch (err) {
    if (err instanceof ContentPolicyRefusal) {
      await recordPolicyRefusal({
        userId: input.userId,
        gate: "prompt",
        reason: err.reason,
        strictLane: input.hasRealPersonReference === true,
        prompt: input.prompt,
        generationId: input.generationId ?? null,
      });
    }
    throw err;
  }
}
