"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";
import { assertPromptAllowed, ContentPolicyRefusal } from "@/lib/generations/content-policy";
import { gatePrompt, recordPolicyRefusal } from "@/lib/generations/policy-log";
import { cancelAstraJob, pollAstraJob, submitAstraJob } from "@/lib/generations/providers/astra";
import { openAiSafetyId } from "@/lib/openai/safety-id";
import { setsAccess, UUID_RE } from "@/lib/sets/access";
import { countSpecChanges, holdEditedText } from "@/lib/sets/editor-model";
import {
  SET_BRIEF_TOO_SHORT,
  SET_EDIT_FAILED,
  SET_EDIT_REFUSED,
  SET_EDIT_TIMED_OUT,
  SET_EDIT_TOO_FAST,
  SET_NOT_FOUND,
  SET_NOT_READY,
  SET_SAVE_FAILED,
} from "@/lib/sets/messages";
import { setEditRequest } from "@/lib/sets/set-edit-prompt";
import { SET_EDIT_DEADLINE_MS, SET_EDIT_MAX_CHARS, SET_EDIT_PER_10_MIN, SET_EDIT_POLL_MS } from "@/lib/sets/set-config";
import { cleanText, normaliseSetSpec, parseSetSpecText, specTextForGate, type SetSpec } from "@/lib/sets/set-spec";

// The Set Editor's actions (2026-09-14). The working copy lives in
// `location_sets.edited_spec` (supabase/pending/set-editor.sql); Astra's
// original stays in `spec`, untouched, so it can always be brought back.
//
// The trust boundary holds on every path: whatever a browser sends is a
// spec only after normaliseSetSpec says so, and a browser's edit may move
// and recolour but never write — holdEditedText keeps the title, the
// description and every label what a GATED build or Astra edit wrote.
// Astra's own edits are gated whole (specTextForGate) exactly as a build's
// answer is, before they are saved.

/** The set is the person's own, ready and drawable: its original spec, and the working copy if one is saved. */
async function ownedSpecs(
  setId: string,
  userId: string,
): Promise<{ error: string } | { error: null; spec: SetSpec; edited: SetSpec | null }> {
  if (typeof setId !== "string" || !UUID_RE.test(setId)) return { error: SET_NOT_FOUND };
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("location_sets")
    .select("status, spec")
    .eq("id", setId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!row) return { error: SET_NOT_FOUND };
  if (row.status !== "ready") return { error: SET_NOT_READY };
  const n = normaliseSetSpec(row.spec);
  if (!n.ok) return { error: SET_NOT_FOUND };
  // The working copy, read on its own so the read above never names a column
  // that may not exist yet (set-editor.sql). A read that fails means no copy.
  let edited: SetSpec | null = null;
  const { data: editedRow, error: editedError } = await admin
    .from("location_sets")
    .select("edited_spec")
    .eq("id", setId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (editedError) {
    console.warn("[sets] editor could not read the working copy (set-editor.sql run?):", editedError.message);
  } else if (editedRow?.edited_spec) {
    const e = normaliseSetSpec(editedRow.edited_spec);
    if (e.ok) edited = e.spec;
  }
  return { error: null, spec: n.spec, edited };
}

/** Write the working copy. The caller has already normalised and held its text. */
async function writeEdited(setId: string, userId: string, edited: SetSpec | null): Promise<{ error: string | null }> {
  const { error } = await createAdminClient()
    .from("location_sets")
    .update({ edited_spec: edited, updated_at: new Date().toISOString() })
    .eq("id", setId)
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (error) {
    console.warn("[sets] editor could not save the working copy (set-editor.sql run?):", error.message);
    return { error: SET_SAVE_FAILED };
  }
  return { error: null };
}

/** The editor's autosave: the whole working spec, renormalised, its text held. */
export async function saveSetEdit(setId: string, spec: unknown): Promise<{ error: string | null }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const owned = await ownedSpecs(setId, access.userId);
  if (owned.error !== null) return { error: owned.error };
  const n = normaliseSetSpec(spec);
  if (!n.ok) return { error: SET_SAVE_FAILED };
  if (await rateLimited(access.userId, "set-edit", 60, 40)) return { error: SET_SAVE_FAILED };
  const held = holdEditedText(n.spec, owned.edited ? [owned.edited, owned.spec] : [owned.spec]);
  return writeEdited(setId, access.userId, held);
}

/** Astra's original: the working copy goes, and the set opens as first built. */
export async function clearSetEdit(setId: string): Promise<{ error: string | null }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const owned = await ownedSpecs(setId, access.userId);
  if (owned.error !== null) return { error: owned.error };
  if (await rateLimited(access.userId, "set-edit", 60, 40)) return { error: SET_SAVE_FAILED };
  return writeEdited(setId, access.userId, null);
}

/**
 * The prompt bar: one change request, applied by Astra to the working spec.
 * The person's words are gated as their own; Astra's answer is parsed,
 * normalised and gated whole, like a build's — then saved as the working
 * copy and handed back with how many pieces it touched.
 */
export async function editSetWithAstra(
  setId: string,
  instruction: string,
): Promise<{ error: string } | { error: null; spec: SetSpec; changed: number }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const { userId } = access;
  const owned = await ownedSpecs(setId, userId);
  if (owned.error !== null) return { error: owned.error };
  const text = cleanText(typeof instruction === "string" ? instruction : "", SET_EDIT_MAX_CHARS);
  if (text.length < 3) return { error: SET_BRIEF_TOO_SHORT };

  // The person's own words, judged before anything leaves Picacho — as a
  // brief is (actions.ts submitSetBuild). A refusal answers with the gate's
  // own sentence.
  try {
    await gatePrompt({ prompt: text, userId, hasRealPersonReference: false });
  } catch (err) {
    if (err instanceof ContentPolicyRefusal) return { error: err.userMessage };
    throw err;
  }
  if (await rateLimited(userId, "set-astra-edit", 60 * 10, SET_EDIT_PER_10_MIN)) return { error: SET_EDIT_TOO_FAST };

  const working = owned.edited ?? owned.spec;
  const submitted = await submitAstraJob(setEditRequest(working, text, openAiSafetyId(userId)));
  if (!submitted.ok) {
    console.warn("[sets] edit submit failed:", submitted.kind, submitted.detail);
    return { error: submitted.kind === "refused" ? SET_EDIT_REFUSED : SET_EDIT_FAILED };
  }

  // Waited for inside the action, like a match: polls until the deadline,
  // well inside the set page's 300 s budget, then cancels what nobody will
  // collect.
  const deadline = new Date().getTime() + SET_EDIT_DEADLINE_MS;
  let polled = await pollAstraJob(submitted.responseId);
  while (polled.state === "working" && new Date().getTime() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SET_EDIT_POLL_MS));
    polled = await pollAstraJob(submitted.responseId);
  }
  if (polled.state === "working") {
    await cancelAstraJob(submitted.responseId);
    return { error: SET_EDIT_TIMED_OUT };
  }
  if (polled.state === "failed") {
    console.warn("[sets] edit failed:", polled.kind, polled.detail);
    return { error: polled.kind === "refused" ? SET_EDIT_REFUSED : SET_EDIT_FAILED };
  }
  console.info("[sets] edit usage", { setId, usage: polled.usage, costUsd: polled.costUsd });

  const parsed = parseSetSpecText(polled.text);
  if (!parsed.ok) return { error: SET_EDIT_FAILED };
  const next = parsed.spec;

  // Astra's words, judged before anyone reads them — in the strict lane, the
  // lane every shot of this set will render them in (build-tick does the
  // same for a build's answer). Logged under the provider.
  const gateWords = specTextForGate(next);
  try {
    await assertPromptAllowed({ prompt: gateWords, hasRealPersonReference: true });
  } catch (err) {
    if (!(err instanceof ContentPolicyRefusal)) throw err;
    await recordPolicyRefusal({
      userId,
      gate: "prompt",
      reason: err.reason,
      strictLane: true,
      prompt: gateWords,
      provider: "astra",
    });
    return { error: SET_EDIT_REFUSED };
  }

  const saved = await writeEdited(setId, userId, next);
  if (saved.error !== null) return { error: saved.error };
  return { error: null, spec: next, changed: countSpecChanges(working, next) };
}
