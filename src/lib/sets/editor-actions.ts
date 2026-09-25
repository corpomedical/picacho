"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";
import { monthlyWindowStart } from "@/lib/generations/core";
import { assertPromptAllowed, ContentPolicyRefusal } from "@/lib/generations/content-policy";
import { gatePrompt, recordPolicyRefusal } from "@/lib/generations/policy-log";
import { cancelAstraJob, pollAstraJob, submitAstraJob, type AstraJobRequest } from "@/lib/generations/providers/astra";
import { openAiSafetyId } from "@/lib/openai/safety-id";
import { setsAccess, UUID_RE } from "@/lib/sets/access";
import { countSpecChanges, holdEditedText } from "@/lib/sets/editor-model";
import {
  SET_BRIEF_TOO_SHORT,
  SET_EDIT_FAILED,
  SET_EDIT_REFUSED,
  SET_EDIT_STILL_WORKING,
  SET_EDIT_TIMED_OUT,
  SET_EDIT_TOO_BIG,
  SET_EDIT_TOO_FAST,
  SET_EDIT_TRIES_USED,
  SET_NOT_FOUND,
  SET_NOT_READY,
  SET_SAVE_FAILED,
  THING_REBUILD_ADMINS_ONLY,
  THING_REBUILD_DIDNT_FIT,
  THING_REBUILD_FAILED,
  THING_REBUILD_NO_PHOTOS,
  THING_REBUILD_TOO_BIG,
  SET_ELEMENT_GONE,
  setEditMonthlyCapMessage,
} from "@/lib/sets/messages";
import { setEditRequest } from "@/lib/sets/set-edit-prompt";
import {
  SET_EDIT_DEADLINE_MS,
  SET_EDIT_MAX_CHARS,
  SET_EDIT_MAX_SPEC_CHARS,
  SET_EDIT_PER_10_MIN,
  SET_EDIT_POLL_MS,
  SET_EDIT_TRIES_MONTH_SCOPE,
  SET_EDITS_MONTH_SCOPE,
  setEditTriesMonthlyLimit,
  setEditsMonthlyLimit,
} from "@/lib/sets/set-config";
import { astraEditsLeft, countAstraEditsThisMonth } from "@/lib/sets/data";
import { claimAstraPress, endAstraPress, giveBackAstraEdit, parseAstraPressId, readAstraPress } from "@/lib/sets/astra-press";
import { editUndoOf, heldTextOf, sealedEditText, type EditUndo } from "@/lib/sets/edit-seal";
import type { AstraEditRead } from "@/lib/sets/astra-follow";
import { cleanText, normaliseSetSpec, parseSetSpecText, specTextForGate, type SetSpec } from "@/lib/sets/set-spec";
import { ELEMENT_KEY_RE, resolvePhotos, setElements, type ElementPhoto } from "@/lib/sets/elements";
import { listElementPhotos } from "@/lib/sets/references";
import {
  THING_REBUILD_MAX_SENT_CHARS,
  THING_REBUILD_OPEN_TO_ALL,
  parseRebuildText,
  spliceThing,
  thingLocalBlocks,
  thingRebuildRequest,
} from "@/lib/sets/thing-rebuild";
import { listModelFiles } from "@/lib/sets/thing-model-store";
import { THING_MODEL_BUCKET, setModelPath } from "@/lib/sets/thing-model";

// The Set Editor's actions (2026-09-14). The working copy lives in
// `location_sets.edited_spec` (supabase/applied/2026-09-14/set-editor.sql, run in production 2026-09-14); Astra's
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

type Access = Extract<Awaited<ReturnType<typeof setsAccess>>, { error: null }>;

/** A change reserved from the month: given back unless the press saves. */
type Slot = { error: null; editsLeft: number | null; monthly: number; reserved: boolean; given?: boolean };

/**
 * One of the month's Astra changes, at the edits' own pace
 * (set-config.ts SET_EDITS_MONTHLY_LIMITS, SET_EDIT_PER_10_MIN): the
 * limiter's window reaches back to the billing month's start, the one
 * builds are counted from. Asked last, so a request the gate or the pace
 * refused is not one of them. Every answer from here on says how many are
 * left (null: no cap, or the count could not be read).
 *
 * RESERVED, not spent (2026-09-25, Cut 1 — operator: "GO ahead"). The
 * change is taken before Astra runs, atomically, so parallel presses can
 * never pass the cap — but a press that does not save gives it back
 * (giveBackAstraChange). Until then "Astra's refusals and timeouts cost
 * too": a Basic month whose one edit timed out and one was refused was
 * spent with nothing on the set. Astra is still billed for every try, so
 * the month's tries are capped as well: the changes plus
 * SET_EDIT_SPARE_TRIES (set-config.ts has the money). The pace still
 * counts every try.
 */
async function astraChangeSlot(access: Access): Promise<{ error: string; editsLeft?: number | null } | Slot> {
  const { userId } = access;
  if (await rateLimited(userId, "set-astra-edit", 60 * 10, SET_EDIT_PER_10_MIN)) return { error: SET_EDIT_TOO_FAST };
  const monthly = setEditsMonthlyLimit(access.plan, access.isAdmin);
  if (monthly < 0) return { error: null, editsLeft: null, monthly, reserved: false };
  const since = monthlyWindowStart(access.periodStart).getTime();
  const windowSeconds = Math.max(1, Math.ceil((new Date().getTime() - since) / 1000));
  // Refused at the cap: nothing was reserved, so nothing is given back.
  if (monthly === 0 || (await rateLimited(userId, SET_EDITS_MONTH_SCOPE, windowSeconds, monthly))) {
    return { error: setEditMonthlyCapMessage(monthly), editsLeft: 0 };
  }
  const slot: Slot = { error: null, editsLeft: null, monthly, reserved: true };
  // Too many tries that didn't land this month: the change just reserved goes back.
  if (await rateLimited(userId, SET_EDIT_TRIES_MONTH_SCOPE, windowSeconds, setEditTriesMonthlyLimit(access.plan, access.isAdmin))) {
    return { error: SET_EDIT_TRIES_USED, editsLeft: await giveBackAstraChange(access, slot) };
  }
  // This reservation included, as the page's own count reads it.
  const used = await countAstraEditsThisMonth(userId, access.periodStart);
  slot.editsLeft = used === null ? null : Math.max(0, monthly - used);
  return slot;
}

/**
 * A press that did not save gives its change back to the month, once
 * however often it is asked (a later throw after a returned failure never
 * refunds twice), and says how many are left after it.
 */
async function giveBackAstraChange(access: Access, slot: Slot): Promise<number | null> {
  if (!slot.reserved || slot.given) return slot.editsLeft;
  slot.given = true;
  await giveBackAstraEdit(createAdminClient(), access.userId);
  const used = await countAstraEditsThisMonth(access.userId, access.periodStart);
  slot.editsLeft = used === null ? null : Math.max(0, slot.monthly - used);
  return slot.editsLeft;
}

/**
 * One Astra job per press (astra-press.ts, 2026-09-25): the page sends a
 * fresh id with each press, and only the first delivery with it runs. A
 * browser's silent resend of the same press is answered at once — never
 * gated, paced, counted or sent to Astra — and the page reads back what
 * the first one saved (astra-follow.ts). The first delivery always leaves
 * an end marker, saved or not, so that read-back has a definite answer;
 * `run` calls `kept` the moment its change is saved. A press with no id
 * (a tab from before this deploy) is served as before.
 */
async function oncePerPress<T extends { error: string | null }>(
  userId: string,
  pressId: unknown,
  run: (kept: () => void) => Promise<T>,
): Promise<T | { error: string; pending: true } | { error: string }> {
  const press = parseAstraPressId(pressId);
  if (press === null) return run(() => {});
  const claim = await claimAstraPress(createAdminClient(), userId, press);
  if (claim === "repeat") return { error: SET_EDIT_STILL_WORKING, pending: true };
  // The claim could not be asked: refused as the pace limiter refuses in the same outage (it fails closed).
  if (claim === "unavailable") return { error: SET_EDIT_TOO_FAST };
  let saved = false;
  try {
    return await run(() => {
      saved = true;
    });
  } finally {
    await endAstraPress(createAdminClient(), userId, press, saved ? "saved" : "unsaved");
  }
}

/**
 * Astra's answer, waited for inside the action, like a match: polls until
 * the deadline, well inside the set page's 300 s budget, then cancels what
 * nobody will collect.
 */
async function askAstra(setId: string, request: AstraJobRequest, what: string, failed: string): Promise<{ error: string } | { error: null; text: string }> {
  const submitted = await submitAstraJob(request);
  if (!submitted.ok) {
    console.warn(`[sets] ${what} submit failed:`, submitted.kind, submitted.detail);
    return { error: submitted.kind === "refused" ? SET_EDIT_REFUSED : failed };
  }
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
    console.warn(`[sets] ${what} failed:`, polled.kind, polled.detail);
    return { error: polled.kind === "refused" ? SET_EDIT_REFUSED : failed };
  }
  console.info(`[sets] ${what} usage`, { setId, usage: polled.usage, costUsd: polled.costUsd });
  return { error: null, text: polled.text };
}

/**
 * The prompt bar: one change request, applied by Astra to the working spec.
 * The person's words are gated as their own; Astra's answer is parsed,
 * normalised and gated whole, like a build's — then saved as the working
 * copy and handed back with how many pieces it touched. `pressId` names
 * this press (oncePerPress); `pending` answers a repeat delivery of one.
 * `undo` seals the words of the copy Astra was handed (edit-seal.ts), so
 * the changed line's Undo can bring them back too (undoAstraEdit); null
 * when nothing can be sealed.
 */
export async function editSetWithAstra(
  setId: string,
  instruction: string,
  pressId?: string,
): Promise<
  | { error: string; editsLeft?: number | null; pending?: true }
  | { error: null; spec: SetSpec; changed: number; editsLeft: number | null; undo: EditUndo | null }
> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const { userId } = access;
  const owned = await ownedSpecs(setId, userId);
  if (owned.error !== null) return { error: owned.error };
  const text = cleanText(typeof instruction === "string" ? instruction : "", SET_EDIT_MAX_CHARS);
  if (text.length < 3) return { error: SET_BRIEF_TOO_SHORT };
  // A set Astra cannot answer whole is not sent: the answer would be cut off
  // and paid for, and counted among the month's changes.
  const working = owned.edited ?? owned.spec;
  if (JSON.stringify(working).length > SET_EDIT_MAX_SPEC_CHARS) return { error: SET_EDIT_TOO_BIG };

  // Everything above is free and gives a repeat the same answer. The press
  // is claimed before the gate, so a repeat delivery never logs a second
  // policy refusal, and before the pace, the month and Astra.
  return oncePerPress(userId, pressId, async (kept) => {
    // The person's own words, judged before anything leaves Picacho — as a
    // brief is (actions.ts submitSetBuild). A refusal answers with the gate's
    // own sentence.
    try {
      await gatePrompt({ prompt: text, userId, hasRealPersonReference: false });
    } catch (err) {
      if (err instanceof ContentPolicyRefusal) return { error: err.userMessage };
      throw err;
    }
    const slot = await astraChangeSlot(access);
    if (slot.error !== null) return slot;

    // From here every answer that does not save gives the change back; so
    // does a throw, which is then passed on.
    try {
      const answer = await askAstra(setId, setEditRequest(working, text, openAiSafetyId(userId)), "edit", SET_EDIT_FAILED);
      if (answer.error !== null) return { error: answer.error, editsLeft: await giveBackAstraChange(access, slot) };

      const parsed = parseSetSpecText(answer.text);
      if (!parsed.ok) return { error: SET_EDIT_FAILED, editsLeft: await giveBackAstraChange(access, slot) };
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
        return { error: SET_EDIT_REFUSED, editsLeft: await giveBackAstraChange(access, slot) };
      }

      const saved = await writeEdited(setId, userId, next);
      if (saved.error !== null) return { error: saved.error, editsLeft: await giveBackAstraChange(access, slot) };
      kept();
      return { error: null, spec: next, changed: countSpecChanges(working, next), editsLeft: slot.editsLeft, undo: editUndoOf(setId, userId, working) };
    } catch (err) {
      await giveBackAstraChange(access, slot);
      throw err;
    }
  });
}

/**
 * A thing rebuilt from its photos (thing-rebuild.ts, 2026-09-24): Astra is
 * handed the thing's own blocks and its reference photos (their bytes — the
 * photos passed the picture gate when they were put on it), and its new
 * blocks replace the old ones in the working copy, where the old ones
 * stood. No words: the answer is only blocks, so nothing new can reach a
 * render prompt. One of the month's Astra changes, like any edit — counted
 * only when it saves (2026-09-25). A thing whose new blocks would not be
 * one thing where the old one stood is left as it was, and the page says so.
 */
export async function rebuildThingFromPhotos(
  setId: string,
  key: string,
  pressId?: string,
): Promise<
  | { error: string; editsLeft?: number | null; pending?: true }
  | { error: null; spec: SetSpec; changed: number; key: string; blocks: number; editsLeft: number | null }
> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const { userId } = access;
  if (!THING_REBUILD_OPEN_TO_ALL && !access.isAdmin) return { error: THING_REBUILD_ADMINS_ONLY };
  const owned = await ownedSpecs(setId, userId);
  if (owned.error !== null) return { error: owned.error };
  if (typeof key !== "string" || !ELEMENT_KEY_RE.test(key)) return { error: SET_ELEMENT_GONE };
  const working = owned.edited ?? owned.spec;

  // The thing the page named, on the saved set now (the page may be a moment
  // ahead: a key that merely moved still finds it), and the photos on it.
  const els = setElements(working);
  const probe: ElementPhoto = { refId: "00000000-0000-4000-8000-000000000000", anchor: key, slot: 1, at: 0, url: "" };
  const thingKey = resolvePhotos(els, [probe]).held[0]?.key ?? null;
  const thing = els.find((e) => e.key === thingKey);
  if (!thing) return { error: SET_ELEMENT_GONE };
  // A rebuild sends only this thing's blocks, never the whole set, so it is
  // judged by exactly what thingRebuildInput stringifies (2026-09-25): the
  // whole-set limit (SET_EDIT_MAX_SPEC_CHARS) belongs to chat edits, which
  // send the whole set, and refused a small car on a big set. Before any
  // photo is read, the press claimed or anything spent.
  if (JSON.stringify(thingLocalBlocks(working, thing)).length > THING_REBUILD_MAX_SENT_CHARS) return { error: THING_REBUILD_TOO_BIG };
  const admin = createAdminClient();
  const listing = await listElementPhotos(admin, userId, setId);
  const held = resolvePhotos(els, listing.photos).held.find((h) => h.key === thing.key);
  const pathOf = new Map(listing.photos.map((p) => [p.refId, p.path]));
  const paths = (held?.photos ?? []).map((p) => pathOf.get(p.refId)).filter((p): p is string => Boolean(p));
  if (paths.length === 0) return { error: THING_REBUILD_NO_PHOTOS };

  // Claimed before the photos are downloaded, so a repeat delivery is
  // caught during those seconds too (oncePerPress).
  return oncePerPress(userId, pressId, async (kept) => {
    const photos: string[] = [];
    for (const path of paths) {
      const { data, error } = await admin.storage.from("generated-images").download(path);
      if (error || !data) {
        console.warn("[sets] rebuild could not read a photo:", error?.message);
        return { error: THING_REBUILD_FAILED };
      }
      photos.push(`data:image/jpeg;base64,${Buffer.from(await data.arrayBuffer()).toString("base64")}`);
    }

    const slot = await astraChangeSlot(access);
    if (slot.error !== null) return slot;
    // From here every answer that does not save gives the change back; so
    // does a throw, which is then passed on.
    try {
      const answer = await askAstra(setId, thingRebuildRequest(working, thing, photos, openAiSafetyId(userId)), "rebuild", THING_REBUILD_FAILED);
      if (answer.error !== null) return { error: answer.error, editsLeft: await giveBackAstraChange(access, slot) };
      const raw = parseRebuildText(answer.text);
      if (!raw) return { error: THING_REBUILD_FAILED, editsLeft: await giveBackAstraChange(access, slot) };
      const spliced = spliceThing(working, thing, raw);
      if (!spliced.ok) {
        console.warn("[sets] rebuild did not fit:", spliced.why);
        return { error: THING_REBUILD_DIDNT_FIT, editsLeft: await giveBackAstraChange(access, slot) };
      }
      const next = holdEditedText(spliced.spec, owned.edited ? [owned.edited, owned.spec] : [owned.spec]);
      const saved = await writeEdited(setId, userId, next);
      if (saved.error !== null) return { error: saved.error, editsLeft: await giveBackAstraChange(access, slot) };
      kept();

      // A model file kept on the thing (thing-model.ts) follows it to its new
      // key. The rebuild is saved already: a failure here is logged, and never
      // turns a saved rebuild into an error or an unsaved press.
      try {
        const keptModel = (await listModelFiles(admin, userId, setId)).find((f) => f.key === thing.key);
        if (keptModel) {
          const { error } = await admin.storage
            .from(THING_MODEL_BUCKET)
            .move(keptModel.path, setModelPath(userId, setId, spliced.key, keptModel.at, keptModel.flip));
          if (error) console.warn("[sets] a kept model stays on the old key:", error.message);
        }
      } catch (err) {
        console.warn("[sets] a kept model stays on the old key:", err instanceof Error ? err.message : String(err));
      }
      return { error: null, spec: next, changed: countSpecChanges(working, next), key: spliced.key, blocks: spliced.blocks, editsLeft: slot.editsLeft };
    } catch (err) {
      await giveBackAstraChange(access, slot);
      throw err;
    }
  });
}

/**
 * The changed line's Undo of an Astra change (Helios Cut 2, step 2,
 * 2026-09-25): the set as it stood before, saved back — with the words it
 * had then when the page sends the seal of them (edit-seal.ts), so an
 * undone "add a row of flags" no longer leaves "lined with flags" in the
 * description every later still reads. Without a seal that opens (a change
 * read back after a dropped connection, a page from before this deploy, a
 * rebuild — which never changes the words), it is exactly saveSetEdit: the
 * words stay the server's, and the page says so when they differ from the
 * set's before (`textRestored`). Never calls Astra and
 * never touches the month's count: the change still counts, and the page
 * says that too. The saved copy comes back, so the page draws what the
 * server holds.
 */
export async function undoAstraEdit(
  setId: string,
  before: unknown,
  undo?: { text: unknown; seal: unknown } | null,
): Promise<{ error: string } | { error: null; spec: SetSpec; textRestored: boolean }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const owned = await ownedSpecs(setId, access.userId);
  if (owned.error !== null) return { error: owned.error };
  const n = normaliseSetSpec(before);
  if (!n.ok) return { error: SET_SAVE_FAILED };
  if (await rateLimited(access.userId, "set-edit", 60, 40)) return { error: SET_SAVE_FAILED };
  const stored = owned.edited ? [owned.edited, owned.spec] : [owned.spec];
  const sealed = sealedEditText(setId, access.userId, undo);
  const held = holdEditedText(n.spec, sealed ? [heldTextOf(sealed), ...stored] : stored);
  const saved = await writeEdited(setId, access.userId, held);
  if (saved.error !== null) return { error: saved.error };
  // Whether the set's words are the ones it had before, read off what was
  // saved: through the seal, or because Astra never changed them (a plain
  // recolour) — so the page never says the description still mentions a
  // change it never had.
  return { error: null, spec: held, textRestored: held.title === n.spec.title && held.description === n.spec.description };
}

/**
 * What became of an Astra press, for the page after a dropped connection or
 * a repeat's `pending` answer (astra-follow.ts, 2026-09-25): where the press
 * stands and the working copy as saved, with how many changes are left once
 * the press has ended. The person's own set, and their own press rows only.
 * No limiter, like the other reads: the page reads at most every 4 s, for
 * at most ~350 s.
 */
export async function readAstraEdit(setId: string, pressId: string): Promise<AstraEditRead> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const press = parseAstraPressId(pressId);
  if (press === null) return { error: SET_NOT_FOUND };
  // The press's end marker is written after its save, so it is read first:
  // a spec read after a "saved" is never older than that save.
  const state = await readAstraPress(createAdminClient(), access.userId, press);
  const owned = await ownedSpecs(setId, access.userId);
  if (owned.error !== null) return { error: owned.error };
  const ended = state === "saved" || state === "unsaved" || state === "lost";
  return { error: null, press: state, spec: owned.edited ?? owned.spec, ...(ended ? { editsLeft: await astraEditsLeft(access) } : {}) };
}
