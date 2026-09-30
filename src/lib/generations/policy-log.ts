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
import { refusalProviderFor } from "@/lib/generations/refusal-attribution";
import { dailyCapReached, rateLimited } from "@/lib/rate-limit";

// The gate's own brakes (2026-09-30, operator: "fix the remaining small
// ones"). Every reading costs two paid models (and two more at an edge), it
// runs before any credit is asked for, and a refused prompt makes no
// generation row, so the 3-second cooldown never slowed a stream of them: a
// script could keep an account refused and us paying for every refusal. Two
// stops now answer before any model is asked, and neither is logged as a
// refusal (they are not a reading of anything the person wrote):
//   - the refusal brake: PROMPT_REFUSAL_BRAKE refusals of their own words
//     in the last hour (recentRefusalCount, which the gate reads anyway)
//     pause new requests until the oldest leaves the hour;
//   - the gate's budget per account: PROMPT_GATES_PER_10_MIN, and
//     PROMPT_GATES_PER_DAY in a rolling day. A heavy day of real work is
//     well under both; a film's beats, a scene's shots, an edit's retries
//     and each Astra turn in the Studio pass through here once.
// Both answer with reason "unavailable", which every caller already reads
// as "we couldn't check it, nothing was spent, try again". Admins pass both
// (support and testing), read beside the refusal count so nothing waits.
export const PROMPT_REFUSAL_BRAKE = 8;
export const PROMPT_GATES_PER_10_MIN = 60;
export const PROMPT_GATES_PER_DAY = 300;
export const GATE_REFUSAL_BRAKE_MESSAGE =
  "Several of your requests were refused in the last hour, so new ones are paused for a while. Nothing was generated and nothing was spent.";
export const GATE_BUSY_MESSAGE =
  "You've sent a lot of requests in a short time, so new ones are paused for a while. Nothing was generated and nothing was spent — try again later.";

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

// The server client, loaded once and shared (2026-09-30): the gate now reads
// the refusal count and the account's role at the same moment, and one load
// serves both (and the refusal log's write).
let serverModule: Promise<typeof import("@/lib/supabase/server")> | null = null;
const supabaseServer = () => (serverModule ??= import("@/lib/supabase/server"));

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
    const { createAdminClient } = await supabaseServer();
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
    const { createAdminClient } = await supabaseServer();
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

/** Whether the account is an admin, for the brakes above. A read that fails is "not an admin": the brakes apply. */
async function isAdminAccount(userId: string): Promise<boolean> {
  try {
    const { createAdminClient } = await supabaseServer();
    const { data } = await createAdminClient().from("profiles").select("role").eq("id", userId).maybeSingle();
    return (data as { role?: unknown } | null)?.role === "admin";
  } catch {
    return false;
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
  const [priorHits, admin] = await Promise.all([recentRefusalCount(input.userId), isAdminAccount(input.userId)]);
  if (!admin) {
    if (priorHits >= PROMPT_REFUSAL_BRAKE) throw new ContentPolicyRefusal("unavailable", GATE_REFUSAL_BRAKE_MESSAGE);
    if (
      (await rateLimited(input.userId, "prompt-gate", 60 * 10, PROMPT_GATES_PER_10_MIN)) ||
      (await dailyCapReached(input.userId, "prompt-gate", PROMPT_GATES_PER_DAY))
    ) {
      throw new ContentPolicyRefusal("unavailable", GATE_BUSY_MESSAGE);
    }
  }
  try {
    const scores = await assertPromptAllowed({
      prompt: input.prompt,
      hasRealPersonReference: input.hasRealPersonReference,
      sessionPriorHits: priorHits,
    });
    return { scores, priorHits };
  } catch (err) {
    if (err instanceof ContentPolicyRefusal) {
      // A Set shot's prompt is mostly the model's words: a refusal they earn
      // on their own is logged under the model and never counts against the
      // person (refusal-attribution.ts). Every other prompt is theirs.
      const provider =
        err.reason === "unavailable"
          ? null
          : await refusalProviderFor(input.prompt, (text) => refusedOnItsOwn(text, input.hasRealPersonReference === true, priorHits));
      await recordPolicyRefusal({
        userId: input.userId,
        gate: "prompt",
        reason: err.reason,
        strictLane: input.hasRealPersonReference === true,
        prompt: input.prompt,
        generationId: input.generationId ?? null,
        ...(provider ? { provider } : {}),
      });
    }
    throw err;
  }
}

/**
 * Whether the prompt gate refuses this text on its own: the same lane and
 * the same session history the refused prompt was judged with, so the only
 * thing that differs is the person's words, taken out. (Judged with no
 * history, a refusal the history tipped would be put on the person as soon
 * as they had typed anything.) A gate that cannot read ("unavailable") is
 * not a refusal. The second judgement refusal-attribution.ts asks for.
 */
export async function refusedOnItsOwn(text: string, strictLane: boolean, sessionPriorHits: number): Promise<boolean> {
  try {
    await assertPromptAllowed({ prompt: text, hasRealPersonReference: strictLane, sessionPriorHits });
    return false;
  } catch (err) {
    if (err instanceof ContentPolicyRefusal) return err.reason !== "unavailable";
    throw err;
  }
}
