"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";
import { setsAccess, UUID_RE } from "@/lib/sets/access";
import { SET_NOT_FOUND, SET_NOT_READY } from "@/lib/sets/messages";
import { cleanText, normaliseSetSpec, type SetSpec } from "@/lib/sets/set-spec";
import {
  askShotWords,
  parseShotWords,
  shotWordsInstructions,
  SHOT_WORDS_MAX_CHARS,
  SHOT_WORDS_PER_10_MIN,
  type ShotWords,
} from "@/lib/sets/shot-words";

// Reading a person's words about a shot (Astra chat, 2026-09-14). Its own
// "use server" file: every export here is a client-callable action, and
// there are exactly two — one for a set's page, one for the Sets home.
//
// Both hand back FIELDS (shot-words.ts ShotWords), never the model's text:
// the page composes what it says from its own sentences, in the person's
// language. Both FAIL OPEN: any failure past the access check is
// `words: null`, and the page takes the message as what happens in the
// frame, because a reader that is down must never stop a shot.
//
// NOTHING IS STORED here. The message goes to the reader inline and is not
// logged; what a shot keeps of it is written by the shot action itself
// (shot-words-store.ts), with the still it led to.

/**
 * The set is the person's own, not deleted, ready and drawable: the spec
 * the page draws — the WORKING copy when one is saved (the Set Editor,
 * 2026-09-15), so the reader knows the cameras and marks as they are now,
 * an added camera included, not as Astra first built them. The working
 * copy is read on its own, defensively, like everywhere else.
 */
async function readyOwnedSpec(setId: string, userId: string): Promise<{ error: string } | { error: null; spec: SetSpec }> {
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
  const { data: editedRow, error: editedError } = await admin
    .from("location_sets")
    .select("edited_spec")
    .eq("id", setId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (editedError) console.warn("[sets] reader could not read the working copy:", editedError.message);
  else if (editedRow?.edited_spec) {
    const edited = normaliseSetSpec(editedRow.edited_spec);
    if (edited.ok) return { error: null, spec: edited.spec };
  }
  return { error: null, spec: n.spec };
}

/** The names of the person's characters, so the reader knows a name from a pose. Empty on any failure. */
async function characterNames(userId: string): Promise<string[]> {
  const { data } = await createAdminClient()
    .from("character_profiles")
    .select("name")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? [])
    .map((c) => (typeof c.name === "string" ? c.name.trim() : ""))
    .filter((name) => name.length > 0)
    .slice(0, 20);
}

/** Words on a set's page: the frame they ask for, against that set's cameras and marks. */
export async function readShotWords(
  setId: string,
  input: { text: string },
): Promise<{ error: string } | { error: null; words: ShotWords | null }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const { userId } = access;
  const owned = await readyOwnedSpec(setId, userId);
  if (owned.error !== null) return { error: owned.error };
  const text = cleanText(typeof input?.text === "string" ? input.text : "", SHOT_WORDS_MAX_CHARS);
  if (text.length === 0) return { error: null, words: null };
  // Fails closed like every limiter; a limited reading is simply no reading.
  if (await rateLimited(userId, "set-words", 60 * 10, SHOT_WORDS_PER_10_MIN)) return { error: null, words: null };
  const stage = { spec: owned.spec, characters: await characterNames(userId), askPlace: false };
  const answer = await askShotWords(shotWordsInstructions(stage), text);
  const words = answer === null ? null : parseShotWords(answer, stage);
  if (answer !== null && words === null) console.warn("[sets] shot words failed: the answer was not the shape");
  return { error: null, words };
}

/** Words on the Sets home, before there is a set: the place to build, and the shot to take in it. */
export async function readSetRequest(input: { text: string }): Promise<{ error: string } | { error: null; words: ShotWords | null }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const { userId } = access;
  const text = cleanText(typeof input?.text === "string" ? input.text : "", SHOT_WORDS_MAX_CHARS);
  if (text.length === 0) return { error: null, words: null };
  if (await rateLimited(userId, "set-words", 60 * 10, SHOT_WORDS_PER_10_MIN)) return { error: null, words: null };
  const stage = { spec: null, characters: await characterNames(userId), askPlace: true };
  const answer = await askShotWords(shotWordsInstructions(stage), text);
  const words = answer === null ? null : parseShotWords(answer, stage);
  if (answer !== null && words === null) console.warn("[sets] set request failed: the answer was not the shape");
  return { error: null, words };
}
