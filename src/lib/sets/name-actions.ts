"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";
import { assertPromptAllowed, ContentPolicyRefusal } from "@/lib/generations/content-policy";
import { recordPolicyRefusal } from "@/lib/generations/policy-log";
import { setsAccess, UUID_RE } from "@/lib/sets/access";
import { claimNamingPress, parseAstraPressId } from "@/lib/sets/astra-press";
import { editUndoOf, type EditUndo } from "@/lib/sets/edit-seal";
import { blockKeyOf, namesByBlock, stampNames } from "@/lib/sets/editor-model";
import {
  SET_NAMING_ADMINS_ONLY,
  SET_NAMING_FAILED,
  SET_NAMING_REFUSED,
  SET_NAMING_STILL_WORKING,
  SET_NAMING_TOO_FAST,
  SET_NAMING_UNCHECKED,
  SET_NOT_FOUND,
  SET_NOT_READY,
  SET_SAVE_FAILED,
} from "@/lib/sets/messages";
import { NAME_MAX_COMPLETION, applyNames, nameInput, nameMessages, parseNameAnswer } from "@/lib/sets/name-prompt";
import { readerCallUsd } from "@/lib/sets/reader-prices";
import { SET_NAMING_PER_HOUR } from "@/lib/sets/set-config";
import { normaliseSetSpec, specTextForGate, type SetSpec } from "@/lib/sets/set-spec";
import { askShotReader } from "@/lib/sets/shot-words";

// The naming pass (Helios Cut 4, step B4, 2026-09-26 — operator: "resume";
// the owner's decision D1 (B)). Its own "use server" file: every export
// here is a client-callable action, and there is exactly one.
//
// A NEW PAID CALL, held the way a match is (match-actions.ts): admins
// only, checked here on its own; one gpt-5.4-mini call per press of the
// button, which shows its price (name-prompt.ts NAME_SET_MAX_USD); a burst
// brake of SET_NAMING_PER_HOUR; nothing else calls it (SET_NAMING_AUTO is
// off, and no build or edit runs it). It is not an Astra change: the month
// is never read or counted.
//
// The order is the point:
//   access (admin) → the set is the person's own and ready → the press is
//   claimed once (a resent delivery answers "still naming", before anything
//   is spent) → the brake → the call → the answer, read strictly → the
//   names checked by the content gate in the strict lane, as every word a
//   person reads on a set is (build-tick.ts, editor-actions.ts) → saved.
//
// WHERE THE NAMES GO (the owner's decision D4). On the working copy's
// objects — each thing's blocks, each block of the set itself the model
// named — and, names only, on Astra's original (`spec`): every object there
// that is the same block as a named one, apart from its name, takes it, so
// "Astra's original" keeps the names. The stored copies are read again
// just before the save, and the names go onto them by block, never by
// number: a change saved while the model answered keeps what it did, and a
// block it moved or changed takes no name. Astra's original is written as
// it was stored, with only `name` added to its objects: its other bytes do
// not move. Names are in no key (elements.ts, set-spec.ts specKeyText), so
// no photo, film or eye-line moves.
//
// Never logs the names or the set's words: one usage line with the dollars.

type Stored = { error: string } | { error: null; spec: SetSpec; rawSpec: Record<string, unknown>; edited: SetSpec | null; brief: string | null };

/** The person's own set, ready, both copies as stored and as drawn, and the brief it was built from. */
async function storedCopies(setId: string, userId: string): Promise<Stored> {
  if (typeof setId !== "string" || !UUID_RE.test(setId)) return { error: SET_NOT_FOUND };
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("location_sets")
    .select("status, spec, brief")
    .eq("id", setId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!row) return { error: SET_NOT_FOUND };
  if (row.status !== "ready") return { error: SET_NOT_READY };
  const n = normaliseSetSpec(row.spec);
  if (!n.ok || !row.spec || typeof row.spec !== "object" || Array.isArray(row.spec)) return { error: SET_NOT_FOUND };
  // The working copy on its own, as the editor reads it (editor-actions.ts ownedSpecs).
  let edited: SetSpec | null = null;
  const { data: editedRow, error: editedError } = await admin
    .from("location_sets")
    .select("edited_spec")
    .eq("id", setId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (editedError) console.warn("[sets] naming could not read the working copy:", editedError.message);
  else if (editedRow?.edited_spec) {
    const e = normaliseSetSpec(editedRow.edited_spec);
    if (e.ok) edited = e.spec;
  }
  return { error: null, spec: n.spec, rawSpec: row.spec as Record<string, unknown>, edited, brief: typeof row.brief === "string" ? row.brief : null };
}

/**
 * Astra's original with the names on it and nothing else changed: `name`
 * added to each stored object whose drawn block is a named one. Null when
 * its objects can't be matched one for one (the normaliser dropped or
 * trimmed some), or when nothing would change.
 */
function stampStored(raw: Record<string, unknown>, drawn: SetSpec, named: ReadonlyMap<string, string>): Record<string, unknown> | null {
  const objects = raw.objects;
  if (!Array.isArray(objects) || objects.length !== drawn.objects.length) return null;
  let stamped = 0;
  const next = objects.map((o: unknown, i) => {
    const name = named.get(blockKeyOf(drawn.objects[i]));
    if (name === undefined || drawn.objects[i].name === name || !o || typeof o !== "object" || Array.isArray(o)) return o;
    stamped += 1;
    return { ...(o as Record<string, unknown>), name };
  });
  if (stamped === 0) return null;
  const out = { ...raw, objects: next };
  // Read back as every reader reads it: the same set, now with the names.
  const check = normaliseSetSpec(out);
  const want = stampNames(named, drawn).spec;
  return check.ok && JSON.stringify(check.spec) === JSON.stringify(want) ? out : null;
}

export async function nameSet(
  setId: string,
  pressId?: string,
): Promise<{ error: string } | { error: null; spec: SetSpec; named: number; seal: EditUndo | null }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  // Checked here on its own: widening anything else to plans must never widen this with it.
  if (!access.isAdmin) return { error: SET_NAMING_ADMINS_ONLY };
  const { userId } = access;
  const first = await storedCopies(setId, userId);
  if (first.error !== null) return { error: first.error };

  // One call per press: a press with no id of its own is never sent.
  const press = parseAstraPressId(pressId);
  if (press === null) return { error: SET_NAMING_FAILED };
  const claim = await claimNamingPress(createAdminClient(), userId, press);
  if (claim === "repeat") return { error: SET_NAMING_STILL_WORKING };
  // The claim could not be asked: refused as the brake refuses in the same outage (it fails closed).
  if (claim === "unavailable") return { error: SET_NAMING_TOO_FAST };
  if (await rateLimited(userId, "set-name", 60 * 60, SET_NAMING_PER_HOUR)) return { error: SET_NAMING_TOO_FAST };

  const working = first.edited ?? first.spec;
  const input = nameInput(working, first.brief);
  const answer = await askShotReader(nameMessages(input), { maxCompletionTokens: NAME_MAX_COMPLETION, reader: "naming" });
  if (!answer) return { error: SET_NAMING_FAILED };
  // What it cost, from the usage it reported (reader-prices.ts): counts and dollars, never words.
  console.info("[sets] naming usage", { setId, lines: input.lines.length, usage: answer.usage, effort: answer.effort, costUsd: readerCallUsd(answer.usage) });
  const parsed = parseNameAnswer(answer.text, input.lines.map((l) => l.alias));
  if (!parsed) return { error: SET_NAMING_FAILED };
  const named = applyNames(working, input.lines, parsed.names);
  // Nothing named: nothing to check or save.
  if (named.named === 0) return { error: null, spec: working, named: 0, seal: editUndoOf(setId, userId, working) };

  // The names, judged with every other word of the set before anyone reads
  // them, in the strict lane — as Astra's own words are. Logged under the
  // pass, so a refusal of a model's words never counts against the person.
  const gateWords = specTextForGate(named.spec);
  try {
    await assertPromptAllowed({ prompt: gateWords, hasRealPersonReference: true });
  } catch (err) {
    if (!(err instanceof ContentPolicyRefusal)) throw err;
    await recordPolicyRefusal({ userId, gate: "prompt", reason: err.reason, strictLane: true, prompt: gateWords, provider: "naming" });
    return { error: err.reason === "unavailable" ? SET_NAMING_UNCHECKED : SET_NAMING_REFUSED };
  }

  // Saved onto the copies as they are now, by block.
  const fresh = await storedCopies(setId, userId);
  if (fresh.error !== null) return { error: fresh.error };
  const byBlock = namesByBlock(named.spec.objects);
  const original = stampStored(fresh.rawSpec, fresh.spec, byBlock);
  let editedNext: SetSpec | null = fresh.edited ? stampNames(byBlock, fresh.edited).spec : null;
  // No working copy, and Astra's original can't take the names as stored: they go on a working copy of it.
  if (!fresh.edited && !original) {
    const onCopy = stampNames(byBlock, fresh.spec);
    if (onCopy.stamped > 0) editedNext = onCopy.spec;
  }
  const update: Record<string, unknown> = {};
  if (original) update.spec = original;
  if (editedNext && editedNext !== fresh.edited) update.edited_spec = editedNext;
  const nowDrawn = editedNext ?? (original ? stampNames(byBlock, fresh.spec).spec : (fresh.edited ?? fresh.spec));
  if (Object.keys(update).length === 0) return { error: null, spec: nowDrawn, named: 0, seal: editUndoOf(setId, userId, nowDrawn) };
  const { error } = await createAdminClient()
    .from("location_sets")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("id", setId)
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (error) {
    console.warn("[sets] naming could not save the names:", error.message);
    return { error: SET_SAVE_FAILED };
  }
  return { error: null, spec: nowDrawn, named: named.named, seal: editUndoOf(setId, userId, nowDrawn) };
}
