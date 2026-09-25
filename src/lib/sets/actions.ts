"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";
import { mediaUrl, toMediaUrl } from "@/lib/media/url";
import { clearSetRecce } from "@/lib/sets/recce-store";
import { ContentPolicyRefusal, type Scores } from "@/lib/generations/content-policy";
import { assertOutputAllowed, OutputPolicyRefusal } from "@/lib/generations/output-policy";
import { gatePrompt, recentRefusalCount, recordPolicyRefusal } from "@/lib/generations/policy-log";
import { runGeneration } from "@/lib/generations/actions";
import { checkGenerationAllowance } from "@/lib/generations/core";
import { readIdentityThreshold } from "@/lib/generations/face-lock";

import { withModelWrittenPrompt } from "@/lib/generations/refusal-attribution";
import { withServerBuiltFrames } from "@/lib/generations/server-built";
import { withServerPress } from "@/lib/generations/server-press";
import { REPEAT_FOLLOW_DEADLINE_MS } from "@/lib/generations/repeat-send";
import { cancelAstraJob, submitAstraJob } from "@/lib/generations/providers/astra";
import { openAiSafetyId } from "@/lib/openai/safety-id";
import { setsAccess, UUID_RE, type SetsAccess } from "@/lib/sets/access";
// One press, one answer, one charge (press.ts; operator, 2026-09-25: "GO
// ahead" on Cut 1). Server-only, like this file.
import { clearSetPresses, parseFilmBeat, parsePressId, pressClipId, pressLedgerId, renderPaidBefore, runPress } from "@/lib/sets/press";
import { advanceSetBuild, logBriefRefusedByAstra, type PollResult } from "@/lib/sets/build-tick";
import { countSetBuildsThisMonth } from "@/lib/sets/data";
import { isPhotoSetsEnabled } from "@/lib/sets/enabled";
import {
  MAX_SET_FRAME_BYTES,
  MAX_SET_THUMB_BYTES,
  SET_BRIEF_MAX_CHARS,
  SET_BRIEF_MIN_CHARS,
  SET_DIRECTION_MAX_CHARS,
  SET_PHOTO_NOTES_MAX_CHARS,
  SET_RESERVED_BRIEF,
  setFramePath,
  setPhotoPath,
  setThumbPath, setTakesEligible, setElementSheetPath, SET_STILL_START_BY_MS, SET_TAKE_CLIP_START_BY_MS } from "@/lib/sets/set-config";
import { cleanText, normaliseElementOrder, normaliseSetLayout, normaliseSetSpec, type SetSpec } from "@/lib/sets/set-spec";
import { setBuildInput } from "@/lib/sets/set-builder-prompt";
import { photoBuildRequest, setAstraRequest } from "@/lib/sets/astra-request";
import { buildSetShotPrompt } from "@/lib/sets/set-shot-prompt";
import {
  buildSetTakePrompt,
  isSetTakeEngine,
  SET_TAKE_DEFAULT_ENGINE,
  SET_TAKE_ENGINES,
  SET_TAKES_PER_10_MIN,
  takeAspectRatio,
  takesCredits,
} from "@/lib/sets/take";
import { lookStoragePath } from "@/lib/sets/look";
import {
  NEW_SET_RIG,
  RIG_FORMATS,
  formatFrame,
  bandSide,
  isRigCheckItem,
  normaliseSetRig,
  labLooksOf,
  rigCheckItems,
  rigSentences,
  rigWordsByItem,
  type RigCheckItem,
  type RigFormat,
} from "@/lib/sets/rig";
import { hourWords, timeApplies } from "@/lib/sets/time-of-day";
import { bearingDeg } from "@/lib/sets/light-schemes";
import { readShotRigs, recordShotRig } from "@/lib/sets/shot-rig";
import { recordShotTake } from "@/lib/sets/shot-take";
import { isFilmMove, isFilmTexture } from "@/lib/sets/moves";

/** Where the rig's focus is measured to: the figure's eyes (build-scene's stand-in). */
import { lookCutout, removeSetLookCutouts, type LookCutoutResult } from "@/lib/sets/look-cutout-store";
import { removeSetThingModels } from "@/lib/sets/thing-model-store";
import { lookSheet } from "@/lib/sets/look-sheet";
import { seesLookObjects } from "@/lib/sets/look-cutout";
import { readShotCameras, recordShotCamera, shotCameraOf } from "@/lib/sets/shot-camera";
import { recordShotWords, SHOT_WORDS_STORED_MAX_CHARS } from "@/lib/sets/shot-words-store";
import {
  CLEAR_PHOTO_SOURCE,
  isMissingColumn,
  normaliseSetPhoto,
  parseSetPhotoDataUri,
  photoDataUrl,
  photoSourceColumns,
  readPhotoSources,
  removeSetPhoto,
} from "@/lib/sets/photo";
import {
  SETS_NOT_OPEN,
  SETS_SESSION_EXPIRED,
  SETS_UNAVAILABLE,
  SET_BRIEF_TOO_LONG,
  SET_BRIEF_TOO_SHORT,
  SET_BUILD_COULDNT_START,
  SET_BUILD_REFUSED,
  SET_BUILD_TOO_FAST,
  SET_DELETE_FAILED,
  SET_FRAME_SAVE_FAILED,
  SET_FRAME_TOO_LARGE,
  SET_FRAME_UNREADABLE,
  SET_NOT_FOUND,
  SET_NOT_READY,
  SET_PHOTO_NEEDS_DATABASE,
  SET_PHOTO_REFUSED,
  SET_PHOTO_SAVE_FAILED,
  SET_PHOTO_UNCHECKED,
  SET_PICK_CHARACTER,
  SET_SAVE_FAILED,
  SET_SHOOT_TOO_FAST,
  SET_SHOT_NO_TIME,
  SET_TAKE_BAD_END,
  SET_TAKE_BAD_START,
  SET_TAKE_NEEDS_PLAN,
  SET_TAKE_END_FAILED,
  SET_TAKE_FAILED,
  SET_TAKE_LOOK_CANT,
  SET_TAKE_LOOK_DROPPED,
  SET_TAKE_OFF_FACE,
  SET_TAKE_OFF_FACE_KEPT_END,
  SET_TAKE_OFF_FACE_REFUNDED,
  SET_TAKE_OTHER_PERSON,
  SET_TAKE_START_OTHER_PERSON,
  SET_TAKE_END_OTHER_PERSON,
  SET_TAKE_RETRY_END_OTHER_PERSON,
  SET_TAKE_TOO_FAST,
  SET_TAKE_ELEMENT_DROPPED,
  SET_LIKENESS_NEEDED,
  setMonthlyCapMessage,
} from "@/lib/sets/messages";
import { summarizeFailureDetail } from "@/lib/generations/report-constants";
import { findVehicles, vehicleWords } from "@/lib/sets/vehicles";
import { ELEMENT_SHEETS_PER_STILL, SHEET_LANES, elementPlaces, planShotSheets, resolvePhotos, setElements, type ShotElementStatus } from "@/lib/sets/elements";
import { SELECTABLE_IMAGE_MODEL_IDS } from "@/lib/generations/providers/image-models";
import { movedSpec, normalisePlacements } from "@/lib/sets/movers";
import { listElementPhotos } from "@/lib/sets/references";
import { needsLikenessAnswer } from "@/lib/characters/likeness";
import { readLikeness } from "@/lib/characters/likeness-store";
import type { AttemptLog } from "@/lib/generations/pipeline";
import { normaliseRack, rackWords } from "@/lib/sets/furniture";
import { STAND_IN_EYE_M } from "@/lib/sets/build-scene";
import { gazeWords, normaliseGaze } from "@/lib/sets/people";

// Sets' server actions (Astra Sets, Phase 1, 2026-09-10).
//
// THE MONEY. A build's own spend (one Astra call, one automatic retry at
// most) is bounded by a monthly cap per plan and recorded to the cent in
// cost_usd; see set-config.ts for the arithmetic. The cap is enforced by
// RESERVING the build's row before anything is spent and counting the rows
// up to it, so concurrent submits cannot all read "under the cap", and by
// never letting a person delete a row (deletion is soft): a deleted build
// still counts, because it was still paid for. A shot is an ordinary image
// take through runGeneration — quoted, charged, gated, scored and refunded
// exactly as one sent from the composer, because it IS one. A shot whose
// look has not been cut yet also pays for its SAM 2 cuts, one an object and
// at most three — once per still, though the page's default look follows
// the newest still, so most shots pay for one still, and most sets have one
// object that counts — behind the shot's burst brake (look-cutout.ts:
// $0.0056 a cut measured, $0.024 at worst).
//
// THE GATES. The brief is gated before OpenAI sees it (a refusal costs
// nothing and is logged against the person, as is OpenAI refusing the brief
// itself). Astra's own words — title, description, labels — are gated
// before they are saved, in the STRICT lane, because every render of the
// description is a strict-lane take (a frame always rides along); a refusal
// there is logged with provider "astra", which the session context does not
// count (policy-log.ts): the model wrote it, not the person. A shot's prompt
// and picture then pass the prompt gate and the output gate inside
// runGeneration, in the strict lane, like any take with an attachment.
//
// THE CHARACTER never reaches Astra: no photo, no name, no appearance.
//
// THE BUILD ITSELF — collecting Astra's answer, gating its words, the one
// retry — is build-tick.ts's advanceSetBuild, run by pollSetBuild below for
// the page and by the finisher (the per-minute cron) whether or not a page
// is open. It is not in this file because every export here is an action a
// browser can call, and the tick takes a user id on trust.
//
// SETS FROM A PHOTO (docs 3.2, 2026-09-11; admins only, behind a second
// switch). The photo is the brief. It is re-encoded on the server (no EXIF,
// no GPS), judged by the picture check's readers BEFORE it is stored or
// sent to Astra — a refused photo is never written and never reaches Astra —
// then stored in the person's own folder and sent inline (store: false as
// ever). Astra is told never to model, identify or describe anyone in it;
// its title, description and labels pass the same strict-lane gate as a
// text build's. The photo is removed with the set, or when its build fails.
// Every column that marks a photo build is named only in photo.ts, and read
// in its own query: until supabase/applied/2026-09-11/astra-photo-sets.sql runs, text
// sets work exactly as before and a photo build stops at its first write.

const JPEG_DATA_URI = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
// Why a look could not be made that trying again will not change: the
// still has nothing to cut clear of its person, no recorded camera, is not
// a finished still of the set or cannot be read, its cutout held a person,
// or the model refused its sheet (look-cutout-store.ts, look-sheet.ts).
const LASTING_LOOK_DROPS = new Set(["nothing to cut", "no camera", "not a finished still of this set", "still unreadable", "person in cutout", "sheet refused"]);
// What a reserved row holds until its brief has passed the gate: a refused
// brief is never written, not even for the seconds the gate takes. A photo
// build keeps it when the photographer adds no notes (the column's CHECK
// wants 1–500 characters).
const RESERVED = SET_RESERVED_BRIEF;

type Reserved =
  | { ok: false; error: string; missingColumn: boolean }
  | { ok: true; setId: string; release: () => Promise<void> };

/**
 * RESERVE, then count. The row exists before the cap is checked, and the
 * count runs up to and including it — so of any number of submits racing
 * each other, only as many as the cap allows see themselves inside it. A
 * text build passes no `extra`, so its row is written exactly as before
 * photos existed; a photo build passes its id and photo columns, so a
 * database without those columns refuses it here, before anything is spent.
 */
async function reserveBuildRow(
  access: { userId: string; periodStart: string | null; monthlyLimit: number },
  admin: ReturnType<typeof createAdminClient>,
  extra: Record<string, unknown>,
  label: string,
): Promise<Reserved> {
  const { data: row, error: insertError } = await admin
    .from("location_sets")
    .insert({ ...extra, user_id: access.userId, brief: RESERVED, status: "building", attempts: 0, rig: NEW_SET_RIG })
    .select("id, created_at")
    .single();
  if (insertError || !row) {
    console.error(`${label} reserve failed:`, insertError?.message);
    return { ok: false, error: SET_BUILD_COULDNT_START, missingColumn: isMissingColumn(insertError) };
  }
  const setId = row.id as string;
  const release = async () => {
    await admin.from("location_sets").delete().eq("id", setId);
  };

  if (access.monthlyLimit >= 0) {
    const upToMine = await countSetBuildsThisMonth(access.userId, access.periodStart, row.created_at as string);
    // A count that cannot be read is not "none used": the cap fails closed.
    if (upToMine === null) {
      await release();
      return { ok: false, error: SET_BUILD_COULDNT_START, missingColumn: false };
    }
    if (upToMine > access.monthlyLimit) {
      await release();
      return { ok: false, error: setMonthlyCapMessage(upToMine - 1), missingColumn: false };
    }
  }
  return { ok: true, setId, release };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export async function submitSetBuild(briefInput: string): Promise<{ error: string } | { error: null; id: string }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const { userId } = access;

  const raw = typeof briefInput === "string" ? briefInput.trim() : "";
  if (raw.length > SET_BRIEF_MAX_CHARS) return { error: SET_BRIEF_TOO_LONG };
  const brief = cleanText(raw, SET_BRIEF_MAX_CHARS);
  if (brief.length < SET_BRIEF_MIN_CHARS) return { error: SET_BRIEF_TOO_SHORT };

  // Burst brake. Fails closed like every limiter; admins get more room for
  // testing, not unlimited.
  if (await rateLimited(userId, "set-build", 60 * 60, access.isAdmin ? 12 : 4)) {
    return { error: SET_BUILD_TOO_FAST };
  }

  const admin = createAdminClient();
  const reserved = await reserveBuildRow(access, admin, {}, "submitSetBuild");
  if (!reserved.ok) return { error: reserved.error };
  const { setId, release } = reserved;

  // The person's own words, judged before anything leaves Picacho. A
  // refusal costs nothing, releases the reservation, and counts as session
  // context like any other.
  try {
    await gatePrompt({ prompt: brief, userId, hasRealPersonReference: false });
  } catch (err) {
    await release();
    if (err instanceof ContentPolicyRefusal) return { error: err.userMessage };
    throw err;
  }
  // The retry reads the brief back from the row, so this write is checked:
  // a retry must never send the placeholder.
  const { data: briefed, error: briefError } = await admin
    .from("location_sets")
    .update({ brief })
    .eq("id", setId)
    .is("deleted_at", null)
    .select("id");
  if (briefError || !briefed?.length) {
    await release();
    return { error: SET_BUILD_COULDNT_START };
  }

  const submitted = await submitAstraJob(setAstraRequest(setBuildInput(brief), openAiSafetyId(userId), "text"));
  if (!submitted.ok) {
    console.error("submitSetBuild astra submit failed:", submitted.kind, submitted.detail);
    await admin
      .from("location_sets")
      .update({ status: "failed", failure: submitted.kind === "refused" ? "refused" : "start", updated_at: new Date().toISOString() })
      .eq("id", setId);
    if (submitted.kind === "refused") {
      await logBriefRefusedByAstra(userId, brief);
      return { error: SET_BUILD_REFUSED };
    }
    return { error: SET_BUILD_COULDNT_START };
  }
  // A job whose id is stored nowhere can be neither collected nor
  // cancelled, and OpenAI bills it anyway — so this write is checked.
  const { data: recorded, error: recordError } = await admin
    .from("location_sets")
    .update({ response_id: submitted.responseId, attempts: 1, updated_at: new Date().toISOString() })
    .eq("id", setId)
    .is("deleted_at", null)
    .select("id");
  if (recordError || !recorded?.length) {
    await cancelAstraJob(submitted.responseId);
    await admin
      .from("location_sets")
      .update({ status: "failed", failure: "start", updated_at: new Date().toISOString() })
      .eq("id", setId);
    return { error: SET_BUILD_COULDNT_START };
  }
  return { error: null, id: setId };
}

/**
 * A Set from a photo (docs 3.2): the photo is the brief, and camera 1 stands
 * where the photographer stood. Admins only, behind astra_photo_sets. See
 * the header for what happens to the photo; the order below is the point:
 *
 *   read the photo → burst brake → re-encode (no EXIF) → reserve the slot
 *   (a database without the photo columns stops here, before anything is
 *   spent) → gate the notes → gate the PICTURE (a refusal: nothing stored,
 *   nothing sent to Astra, the slot released) → store it → send it.
 *
 * The picture check reads for 10–100 s; the page this runs under declares
 * the 300 s budget (app/app/sets/page.tsx).
 */
export async function submitSetPhotoBuild(input: {
  photoDataUri: string;
  notes: string;
}): Promise<{ error: string } | { error: null; id: string }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const { userId } = access;
  // Checked here on its own, not through setsEligible: opening text sets to
  // plans must never open photo sets with them.
  if (!access.isAdmin) return { error: SETS_NOT_OPEN };
  if (!(await isPhotoSetsEnabled(access.supabase))) return { error: SETS_UNAVAILABLE };

  // What the photo cannot show, in the photographer's words: cut silently at
  // the limit, like a shot's direction. The placeholder is never a note.
  let notes = cleanText(typeof input?.notes === "string" ? input.notes : "", SET_PHOTO_NOTES_MAX_CHARS);
  if (notes === RESERVED) notes = "";

  const parsed = parseSetPhotoDataUri(input?.photoDataUri);
  if (!parsed.ok) return { error: parsed.error };

  // The same burst brake and the same monthly slot as a text build.
  if (await rateLimited(userId, "set-build", 60 * 60, access.isAdmin ? 12 : 4)) {
    return { error: SET_BUILD_TOO_FAST };
  }

  // Never the browser's bytes: re-encoded here, whatever arrived.
  const photo = await normaliseSetPhoto(parsed.bytes);
  if (!photo.ok) return { error: photo.error };

  const admin = createAdminClient();
  const setId = crypto.randomUUID();
  const reserved = await reserveBuildRow(
    access,
    admin,
    { id: setId, ...photoSourceColumns(userId, setId, photo.sha256) },
    "submitSetPhotoBuild",
  );
  if (!reserved.ok) return { error: reserved.missingColumn ? SET_PHOTO_NEEDS_DATABASE : reserved.error };
  const { release } = reserved;

  // The notes sit beside a real photograph, so they are judged in the lane
  // the set's description will be: a real person's photo in view.
  let scores: Scores | undefined;
  let priorHits = 0;
  if (notes) {
    try {
      ({ scores, priorHits } = await gatePrompt({ prompt: notes, userId, hasRealPersonReference: true }));
    } catch (err) {
      await release();
      if (err instanceof ContentPolicyRefusal) return { error: err.userMessage };
      throw err;
    }
  } else {
    priorHits = await recentRefusalCount(userId);
  }

  // The picture itself, judged from its bytes before it is stored or sent
  // to Astra: the strict lane, because a real place can hold real people.
  // A refusal is logged as a picture refusal — it never makes the person's
  // next hour stricter (policy-log.ts counts only the prompt gate).
  const dataUrl = photoDataUrl(photo.jpeg);
  try {
    await assertOutputAllowed({
      imageUrl: dataUrl,
      strictLane: true,
      promptScores: scores ?? null,
      sessionPriorHits: priorHits,
    });
  } catch (err) {
    await release();
    if (err instanceof OutputPolicyRefusal) {
      await recordPolicyRefusal({
        userId,
        gate: "output",
        reason: err.reason,
        strictLane: true,
        bands: err.readings,
        provider: "set-photo",
      });
      return { error: err.reason === "unavailable" ? SET_PHOTO_UNCHECKED : SET_PHOTO_REFUSED };
    }
    throw err;
  }

  // Still there after the check's up to ~100 s (a delete in the meantime
  // wins), and the notes written — checked, because a retry reads them back.
  // This also restarts the stale clock the check has been running down.
  const { data: live, error: liveError } = await admin
    .from("location_sets")
    .update({ brief: notes || RESERVED, updated_at: new Date().toISOString() })
    .eq("id", setId)
    .is("deleted_at", null)
    .select("id");
  if (liveError || !live?.length) {
    await release();
    return { error: SET_BUILD_COULDNT_START };
  }

  // Stored once, never rewritten: the bytes at a media path are cached as
  // immutable. A retry resends these bytes only if they still hash the same.
  const { error: uploadError } = await admin.storage
    .from("generated-images")
    .upload(setPhotoPath(userId, setId), photo.jpeg, { contentType: "image/jpeg", upsert: false });
  if (uploadError) {
    console.error("submitSetPhotoBuild photo upload failed:", uploadError.message);
    await removeSetPhoto(admin, userId, setId);
    await release();
    return { error: SET_PHOTO_SAVE_FAILED };
  }

  // The bytes in hand, not a re-read: the same ones the check passed; the
  // photo caps (astra-request.ts).
  const submitted = await submitAstraJob(photoBuildRequest(dataUrl, notes, openAiSafetyId(userId)));
  if (!submitted.ok) {
    console.error("submitSetPhotoBuild astra submit failed:", submitted.kind, submitted.detail);
    await admin
      .from("location_sets")
      .update({ status: "failed", failure: submitted.kind === "refused" ? "refused" : "start", updated_at: new Date().toISOString() })
      .eq("id", setId);
    await removeSetPhoto(admin, userId, setId);
    if (submitted.kind === "refused") {
      // The input was the person's photo and words plus our fixed rules:
      // counted like a refused brief.
      await logBriefRefusedByAstra(userId, notes || null);
      return { error: SET_PHOTO_REFUSED };
    }
    return { error: SET_BUILD_COULDNT_START };
  }
  // Checked, as for a text build — and it closes the race with a delete
  // during the upload or the submit: the job is stopped and the photo goes.
  const { data: recorded, error: recordError } = await admin
    .from("location_sets")
    .update({ response_id: submitted.responseId, attempts: 1, updated_at: new Date().toISOString() })
    .eq("id", setId)
    .is("deleted_at", null)
    .select("id");
  if (recordError || !recorded?.length) {
    await cancelAstraJob(submitted.responseId);
    await admin
      .from("location_sets")
      .update({ status: "failed", failure: "start", updated_at: new Date().toISOString() })
      .eq("id", setId);
    await removeSetPhoto(admin, userId, setId);
    return { error: SET_BUILD_COULDNT_START };
  }
  return { error: null, id: setId };
}

// One tick of a build, for the page: the person's own session and access,
// then exactly the tick the finisher runs (build-tick.ts, where the claim,
// the gates and the one retry are described). A build this settles is
// never pushed: the page announces it itself, with a notification of its
// own when its tab is hidden (sets-home.tsx). Only the finisher pushes.
export async function pollSetBuild(setId: string): Promise<PollResult & { settledHere?: true }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  if (!UUID_RE.test(setId)) return { error: SET_NOT_FOUND };
  const tick = await advanceSetBuild({
    admin: createAdminClient(),
    setId,
    userId: access.userId,
    photoSwitchOn: () => isPhotoSetsEnabled(access.supabase),
  });
  // Whether THIS poll's own write settled the build. The page announces a
  // build it settled itself; one the finisher settled, the finisher pushed.
  return tick.settledHere ? { ...tick.result, settledHere: true } : tick.result;
}

// ---------------------------------------------------------------------------
// Arranging and shooting
// ---------------------------------------------------------------------------

/**
 * The set as the page draws it: the person's own, not deleted, ready, and
 * the WORKING copy where the Build editor has saved one (`edited_spec`),
 * exactly as the page (data.ts `drawn`) and the words reader
 * (words-actions.ts) read it. The still is composed on the sketch of that
 * copy, so everything held against it — the mark, the eye-line's and the
 * rack's things, the look's boxes, the description — has to be that copy
 * too, or the words describe a set nobody is looking at (found reviewing
 * Helios, 2026-09-17). The working copy is read on its own, defensively,
 * as everywhere else: a read that fails uses the set as Astra built it.
 */
async function readyOwnedSpec(
  setId: string,
  userId: string,
): Promise<{ error: string } | { error: null; spec: SetSpec }> {
  if (!UUID_RE.test(setId)) return { error: SET_NOT_FOUND };
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
  if (editedError) console.warn("[sets] could not read the working copy:", editedError.message);
  else if (editedRow?.edited_spec) {
    const edited = normaliseSetSpec(editedRow.edited_spec);
    if (edited.ok) return { error: null, spec: edited.spec };
  }
  return { error: null, spec: n.spec };
}

/** Where the person put the stand-in and the camera. Free: nothing is called. */
export async function saveSetLayout(setId: string, layout: unknown): Promise<{ error: string | null }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const owned = await readyOwnedSpec(setId, access.userId);
  if (owned.error !== null) return { error: owned.error };
  const clean = normaliseSetLayout(layout, owned.spec);
  if (!clean) return { error: SET_SAVE_FAILED };
  if (await rateLimited(access.userId, "set-layout", 60, 30)) return { error: SET_SAVE_FAILED };
  const { error } = await createAdminClient()
    .from("location_sets")
    .update({ layout: clean, updated_at: new Date().toISOString() })
    .eq("id", setId)
    .eq("user_id", access.userId)
    .is("deleted_at", null);
  return { error: error ? SET_SAVE_FAILED : null };
}

/** The card picture on the Sets page, taken by the browser from the first camera. */
export async function saveSetThumbnail(setId: string, dataUri: string): Promise<{ error: string | null }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  if (typeof dataUri !== "string" || !JPEG_DATA_URI.test(dataUri)) return { error: SET_FRAME_UNREADABLE };
  const bytes = Buffer.from(dataUri.slice(dataUri.indexOf(",") + 1), "base64");
  if (bytes.byteLength > MAX_SET_THUMB_BYTES) return { error: SET_FRAME_TOO_LARGE };
  if (bytes.byteLength < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return { error: SET_FRAME_UNREADABLE };
  const owned = await readyOwnedSpec(setId, access.userId);
  if (owned.error !== null) return { error: owned.error };
  if (await rateLimited(access.userId, "set-thumb", 600, 20)) return { error: SET_SAVE_FAILED };
  const admin = createAdminClient();
  const path = setThumbPath(access.userId, setId);
  const { data: before } = await admin
    .from("location_sets")
    .select("thumb_path")
    .eq("id", setId)
    .eq("user_id", access.userId)
    .is("deleted_at", null)
    .maybeSingle();
  const { error: uploadError } = await admin.storage
    .from("generated-images")
    .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
  if (uploadError) return { error: SET_SAVE_FAILED };
  const { data: moved } = await admin
    .from("location_sets")
    .update({ thumb_path: path })
    .eq("id", setId)
    .eq("user_id", access.userId)
    .is("deleted_at", null)
    .select("id");
  // A card from before the current thumbnail version (set-config.ts) lived
  // at another path; once the row points at the new one, the old file goes.
  const old = typeof before?.thumb_path === "string" ? before.thumb_path : null;
  if (moved?.length && old && old !== path && old.startsWith(`${access.userId}/sets/`)) {
    await admin.storage.from("generated-images").remove([old]);
  }
  return { error: null };
}

export type ShootResult =
  | { error: string }
  | {
      error: null;
      generationId: string;
      succeeded: boolean;
      resultUrl: string | null;
      score: number | null;
      /** This still can be a later shot's look: its frame was recorded and it shows objects to cut clear of the person (look-cutout.ts). */
      hasLookObjects: boolean;
      /** A look was asked for and did not ride: the still was shot without it. */
      lookDropped: boolean;
      /** A look was asked for and kept out on purpose: it shows a thing now drawn from its own photos (2026-09-24). */
      lookAside: boolean;
      /** The rig format the still was cut to (rig.ts); "square" when none. */
      format: RigFormat;
      /** The anamorphic squeeze it was cut at: 1 unless the rig had one (2026-09-18). */
      squeeze: number;
      /** The looks the look check will read it against (rig.ts rigCheckItems); none when the rig asked for none. */
      checks: RigCheckItem[];
      /**
       * Why a still that did not pass did not (2026-09-21): the render's own
       * reason — a brand rule with its quoted words and a fix, a refusal, a
       * miss — the sentence History shows. Null when it passed.
       */
      failure: string | null;
      /**
       * What became of each thing with photos in this frame (R1, 2026-09-21,
       * elements.ts ShotElementStatus): whose sheet rode, as which sheet, and
       * why the others did not. Empty when no thing has photos.
       */
      elements: ShotElementStatus[];
    };

/** Who is asking, once setsAccess has said yes. */
type SetsOk = Extract<SetsAccess, { error: null }>;

/**
 * What the still is told by the caller that shot it (2026-09-25, Cut 1).
 * shootInSet passes the first two; only takeInSet sets the rest. None of
 * them is ever a request field.
 */
type ShootOpts = {
  /** The press's first line: the request's 300 s count from here (set-config.ts SET_STILL_START_BY_MS). Only shootInSet and takeInSet set it; never a request field. */
  startedAt: number;
  /** The still's row id, made from the press's id (press.ts): a resend meets it at the reservation. Only shootInSet and takeInSet set it; never a request field. */
  generationId?: string | null;
  /** The take's limiter, asked just before the still's first paid step; a sentence stops the still. Only takeInSet sets it; never a request field. */
  beforePaid?: () => Promise<string | null>;
  /** A film Render already counted by an earlier beat: the stills limiter is not asked again. Only takeInSet sets it; never a request field. */
  skipShotBrake?: boolean;
};

/** A character's photos with no likeness answer for them (likeness.ts); a missing table blocks nothing. */
async function likenessBlocks(db: Awaited<ReturnType<typeof createClient>>, userId: string, characterId: string, paths: readonly string[]): Promise<boolean> {
  const kept = await readLikeness(db, userId, [characterId]);
  return !kept.missing && needsLikenessAnswer({ paths, record: kept.records.get(characterId) ?? null });
}

/**
 * The reason a still did not pass, in the words History uses
 * (report-constants.ts summarizeFailureDetail): a brand rule's block with
 * the words it quoted and its fix, a refusal, a miss. Null for a stop.
 */
function stillFailure(result: { attempts: AttemptLog[]; rulesBlock?: { label: string; evidence: string; fix: string }[] }): string | null {
  if (result.rulesBlock && result.rulesBlock.length > 0) {
    return `Blocked by your brand rules: ${result.rulesBlock
      .map((r) => `${r.label} (triggered by: "${r.evidence}"${r.fix ? ` — try: ${r.fix}` : ""})`)
      .join("; ")}.`;
  }
  return summarizeFailureDetail(result.attempts);
}

/**
 * One still in a Set: the square snapshot the person framed, their
 * character, and a line about the moment. An ordinary image take from here
 * on — see the header.
 *
 * ONE PRESS, ONE CHARGE (operator, 2026-09-25: "GO ahead" on Cut 1). The
 * page names each press (`pressId`, a fresh id per Shoot). A browser that
 * resends the request after a dropped connection delivers the same press
 * twice; the second delivery meets the first's claim row before anything is
 * counted, drawn, uploaded or charged, and answers with the first's answer
 * (press.ts runPress). The still's row id IS the press id, so even without
 * the ledger the reservation refuses a second charge. The clock starts on
 * this first line: the request's 300 s count from here (server-press.ts).
 */
export async function shootInSet(setId: string, input: Parameters<typeof shootStill>[3] & { pressId?: string }): Promise<ShootResult> {
  const startedAt = Date.now();
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const owned = await readyOwnedSpec(setId, access.userId);
  if (owned.error !== null) return { error: owned.error };
  const pressId = parsePressId(input?.pressId);
  return runPress(createAdminClient(), { id: pressId, userId: access.userId, setId, kind: "shot" }, { deadlineAt: startedAt + REPEAT_FOLLOW_DEADLINE_MS }, () =>
    withServerPress({ startedAt, skipCooldown: false }, () => shootStill(access, setId, owned, input, { startedAt, generationId: pressId })),
  );
}

/**
 * The still itself, for shootInSet and for a take's end frame (takeInSet).
 * Not exported: only those two may hand it the press's options, and both
 * have checked who is asking and that the set is theirs.
 */
async function shootStill(
  access: SetsOk,
  setId: string,
  owned: { spec: SetSpec },
  input: {
    frameDataUri: string;
    characterId: string;
    direction: string;
    layout: unknown;
    lifted?: boolean;
    /** An earlier still from this set whose objects this one keeps (look.ts). */
    lookGenerationId?: string | null;
    /** Width ÷ height of the stage canvas the frame's square was cut from (set-view.tsx canvasAspect). */
    canvasAspect?: number;
    /** What the person asked for, as they wrote it: kept with the still for the set's conversation (shot-words-store.ts). */
    words?: string;
    /** The set's rig as the page holds it (rig.ts): normalised here, never trusted. */
    rig?: unknown;
    /** Looks to say harder this time ("Shoot again, pushed"): check items, anything else dropped. */
    push?: unknown;
    /**
     * A film beat's end frame (renderFilm): its layout is the BEAT's — the
     * figure where the beat leaves it, its pose and its eye-line — so it
     * says what the frame shows, and is not saved as the set's arrangement
     * (2026-09-17).
     */
    beat?: boolean;
    /**
     * A film's beat must carry its look (takeInSet, 2026-09-21): "picked"
     * (a look the person chose) stops the shot on any failure to make it,
     * "default" (the film's opening still) only on one that may pass next
     * time. Stopped before anything is shot or charged.
     */
    lookRequired?: "picked" | "default";
    /** The person's order for the things' sheets (R1, set-view's strip): keys, first rides first; anything else dropped. */
    elementOrder?: unknown;
    /**
     * A film's beat must carry its things' sheets (takeInSet, R1): one that
     * should ride and is not drawn stops the shot before anything is shot
     * or charged. A single still goes without it and says so.
     */
    elementsRequired?: boolean;
    /**
     * A film beat's movers (movers.ts, 2026-09-23): the things this frame is
     * shot with, where the beat leaves them. The page drew its sketch with
     * them there, so every word written here about where things stand —
     * which are in the frame, which sheet is which, which way a car is
     * turned, what an eye-line looks at — is written about the same set.
     * Read against this set's own things here, never trusted.
     */
    movers?: unknown;
    /**
     * The picture engine the person picked for stills (2026-09-24, "Cant
     * change from gpt to nano banana"): one of the composer's own lanes,
     * else the admin default. The render re-checks it (a free account is
     * pinned to the default whatever this says).
     */
    stillEngine?: unknown;
    /**
     * The things the page drew plain grey in the sketch (2026-09-24): their
     * own sheets give their colour and design, so the sketch's block colours
     * cannot fight them. The words say so only when every thing whose sheet
     * rides was drawn grey.
     */
    greyed?: unknown;
  },
  opts: ShootOpts,
): Promise<ShootResult> {
  const { userId } = access;

  const frame = typeof input?.frameDataUri === "string" ? input.frameDataUri : "";
  if (!JPEG_DATA_URI.test(frame)) return { error: SET_FRAME_UNREADABLE };
  const bytes = Buffer.from(frame.slice(frame.indexOf(",") + 1), "base64");
  if (bytes.byteLength > MAX_SET_FRAME_BYTES) return { error: SET_FRAME_TOO_LARGE };
  if (bytes.byteLength < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return { error: SET_FRAME_UNREADABLE };

  const characterId = typeof input.characterId === "string" ? input.characterId : "";
  if (!UUID_RE.test(characterId)) return { error: SET_PICK_CHARACTER };
  const { data: character } = await access.supabase
    .from("character_profiles")
    .select("id, reference_image_urls")
    .eq("id", characterId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!character || !Array.isArray(character.reference_image_urls) || character.reference_image_urls.length === 0) {
    return { error: SET_PICK_CHARACTER };
  }
  // Who is in the character's photos (R1.12, likeness.ts): answered for
  // exactly these photos, or no shot — the figure's card asks. A missing
  // table (the SQL not run yet) lets the shot go on, and says so in the
  // logs; the character form still asks before it saves.
  if (await likenessBlocks(access.supabase, userId, characterId, character.reference_image_urls as string[])) return { error: SET_LIKENESS_NEEDED };

  // The look: an earlier still the browser names by id. It must be a shot of
  // THIS set, the person's own, finished and not deleted, and its picture
  // must sit in their own folder (look.ts). Anything else and the still is
  // shot without a look — a stale id (a take deleted in another tab) is no
  // reason to refuse the shot.
  const lookId = typeof input.lookGenerationId === "string" ? input.lookGenerationId : "";
  const lookAsked = UUID_RE.test(lookId);
  let lookPath: string | null = null;
  if (lookAsked) {
    const { data: lookShot } = await access.supabase
      .from("location_set_shots")
      .select("generation_id")
      .eq("set_id", setId)
      .eq("generation_id", lookId)
      .eq("user_id", userId)
      .maybeSingle();
    if (lookShot) {
      const { data: lookTake } = await access.supabase
        .from("generations")
        .select("status, result_url, deleted_at")
        .eq("id", lookId)
        .eq("user_id", userId)
        .maybeSingle();
      lookPath =
        lookTake && lookTake.status === "succeeded" && !lookTake.deleted_at
          ? lookStoragePath(lookTake.result_url, userId)
          : null;
    }
  }

  // The burst brake, before the look's paid cuts and sheet. A film Render
  // is counted once, at its first paid beat (takeInSet, 2026-09-25): its
  // later beats' end frames are not counted again, so a film is never
  // stopped halfway by the stills it is made of.
  if (!opts.skipShotBrake && (await rateLimited(userId, "set-shot", 60 * 10, 12))) return { error: SET_SHOOT_TOO_FAST };

  const admin = createAdminClient();

  // The arrangement the frame was taken from, normalised against the set: it
  // is saved below, and the prompt reads it to say which way the figure faces
  // as the camera sees it. A crafted layout changes that one clause, still
  // gated.
  const layout = normaliseSetLayout(input.layout, owned.spec);
  // The rig (rig.ts, Helios Cinema): its words are worked out here from the
  // frame's own camera and mark — the focus distances, where the light
  // stands as this camera sees it — and the format names the cut the image
  // lane makes after the render (generations/actions.ts set_format).
  const rig = normaliseSetRig(input.rig);
  const rigFrame = formatFrame(rig.format, rig.squeeze);
  // The frame's camera exactly as the page sent it, cut to the rig's band
  // (shot-camera.ts): what the things' places in the frame are measured on,
  // and what is recorded with the still below.
  const frameCamera = shotCameraOf(
    input.layout,
    input.canvasAspect,
    // The squeeze rides too: the band is already widened by it, but the
    // stored lens is the pose's own, so the boxes are only measured on
    // the shape the still really has if the squeeze is there to widen it
    // (look-cutout.ts sketchProjector).
    rigFrame.cut ? { render: rigFrame.renderAspect, band: rigFrame.bandAspect, squeeze: rigFrame.squeeze } : null,
  );

  // The set's things' own photos (R1, 2026-09-21, elements.ts): which
  // things in this frame have photos, and whose sheets ride — at most
  // ELEMENT_SHEETS_PER_STILL, in the person's order, each named by where it
  // stands. On GPT Image only, the model the render lane sends them to
  // (generations/actions.ts elementImageUrls). Free: the sheets are drawn
  // before the shot (element-actions.ts prepareElementSheets), and one that
  // is not just doesn't ride, and says so. Worked out before anything is
  // shot, so a film's beat that needs one stops here, free.
  const pickedEngine = (SELECTABLE_IMAGE_MODEL_IDS as readonly unknown[]).includes(input.stillEngine) ? (input.stillEngine as string) : null;
  const els = setElements(owned.spec);
  // The set as this frame shows it: a beat that drives a thing is shot with
  // it driven (movers.ts). The THINGS are the arrangement's — a moved car
  // keeps its key and its photos — and only where they stand changes.
  const shown = movedSpec(owned.spec, els, normalisePlacements(input.movers));
  let elementPlan: ReturnType<typeof planShotSheets> = { riding: [], sentences: [], statuses: [] };
  if (els.length > 0) {
    const [{ data: imageModelSetting }, listing] = await Promise.all([
      access.supabase.from("app_settings").select("value").eq("key", "image_model").maybeSingle(),
      listElementPhotos(admin, userId, setId),
    ]);
    const stillModel = pickedEngine ?? imageModelSetting?.value ?? "gpt-image";
    elementPlan = planShotSheets({
      els,
      held: resolvePhotos(els, listing.photos).held,
      sheets: listing.sheets,
      // A film's own order when one is sent (takeInSet), else the person's
      // saved one, which rides in the layout (the cast strip).
      order: normaliseElementOrder(input.elementOrder) ?? layout?.elementOrder,
      vehicles: findVehicles(shown),
      shotCamera: frameCamera,
      // Which way a car is turned, in the same camera the vehicle words use.
      poseCamera: layout?.camera ?? null,
      budget: (SHEET_LANES as readonly string[]).includes(stillModel) ? ELEMENT_SHEETS_PER_STILL : 0,
      spec: shown,
    });
  }
  const greyed = new Set(Array.isArray(input.greyed) ? input.greyed.filter((k): k is string => typeof k === "string") : []);
  const allGrey = elementPlan.riding.length > 0 && elementPlan.riding.every((r) => greyed.has(r.key));
  if (input.elementsRequired === true && elementPlan.statuses.some((e) => e.status === "no-sheet")) {
    return { error: SET_TAKE_ELEMENT_DROPPED };
  }

  // What rides as the look is NEVER that still (2026-09-12): handed a
  // finished photograph of the same place, GPT Image copies its camera and
  // framing, whatever the prompt says. Its objects are cut out onto grey —
  // kept from an earlier shot, or cut now from the camera recorded with the
  // still, one SAM 2 request an object (look-cutout-store.ts) — and what
  // rides is the object sheet drawn from that cutout (look-sheet.ts,
  // 2026-09-14): the objects four ways round on grey, made once per still,
  // because a cutout from one side kept a car's design only from that side.
  // The URL is the sheet's own; the still's is never made. Any step that
  // fails and the shot goes without a look and says so, rather than send
  // the whole still again. Past the burst brake, because a cut and a sheet
  // are paid for.
  let look: { url: string } | null = null;
  let lookDropped = false;
  let lookDropReason = "";
  // A look that shows a thing now drawn from its own photos stays out
  // (2026-09-24, "Each rendered image is a different car"): the look's copy
  // of the car is an earlier still's car — the operator's red one, against
  // his photo of a yellow one — and two pictures of the wrong car beat one
  // picture and a sentence of the right one. The thing's own sheet carries
  // it; a film keeps its car through the same sheet on every beat.
  let lookAside = false;
  if (lookAsked && elementPlan.riding.length > 0) {
    const lookCamera = (await readShotCameras(access.supabase, setId, userId, [lookId])).get(lookId) ?? null;
    const riding = new Set(elementPlan.riding.map((r) => r.key));
    lookAside = lookCamera === null || elementPlaces(owned.spec, els, lookCamera).some((p) => p.seen && riding.has(p.key));
  }
  if (lookAsked && !lookAside) {
    const cut: LookCutoutResult = lookPath
      ? await lookCutout({
          admin,
          userId,
          setId,
          lookGenerationId: lookId,
          stillPath: lookPath,
          spec: shown,
          camera: (await readShotCameras(access.supabase, setId, userId, [lookId])).get(lookId) ?? null,
        })
      : { ok: false, reason: "not a finished still of this set" };
    if (!cut.ok) {
      lookDropped = true;
      lookDropReason = cut.reason;
      console.warn(`[sets] shot without its look: ${cut.reason}`);
    } else {
      const sheet = await lookSheet({ admin, userId, setId, lookGenerationId: lookId, cutoutPath: cut.path });
      if (sheet.ok) {
        look = { url: mediaUrl("generated-images", sheet.path) };
      } else {
        lookDropped = true;
        lookDropReason = sheet.reason;
        console.warn(`[sets] shot without its look: ${sheet.reason}`);
      }
    }
  }

  const framePath = setFramePath(userId, crypto.randomUUID());
  // A film's beat that could not have its look stops here, before anything
  // is uploaded, shot or charged (2026-09-21): an end frame drawn without the
  // design its clip opens on is the mismatch the video engine cross-fades
  // across. A look the person picked stops on any failure; the film's own
  // opening still only on one that may pass next time. A still with nothing
  // to cut clear of its person never will, and the Film tab says so before
  // Render (set-view.tsx filmLookNone).
  if (lookDropped && (input.lookRequired === "picked" || (input.lookRequired === "default" && !LASTING_LOOK_DROPS.has(lookDropReason)))) {
    // A picked look that can never be made from its still says so, and not
    // "try again", which looped the film on the same refusal (2026-09-25).
    // A lasting reason reaches here only for a picked look.
    return { error: LASTING_LOOK_DROPS.has(lookDropReason) ? SET_TAKE_LOOK_CANT : SET_TAKE_LOOK_DROPPED };
  }
  // Time: the look's cutout and sheet may have taken most of the request's
  // 300 s (2026-09-25). A render started this late can be cut off by the
  // platform after it was reserved and charged, so it is not started. Free;
  // the sheet is kept, so the next press is quick.
  if (Date.now() - opts.startedAt > SET_STILL_START_BY_MS) return { error: SET_SHOT_NO_TIME };
  // A take's press is counted here, just before its first paid step, after
  // every stop above that costs nothing (takeInSet, 2026-09-25).
  if (opts.beforePaid) {
    const stop = await opts.beforePaid();
    if (stop) return { error: stop };
  }
  const { error: uploadError } = await admin.storage
    .from("chat-attachments")
    .upload(framePath, bytes, { contentType: "image/jpeg", upsert: false });
  if (uploadError) {
    console.error("shootInSet frame upload failed:", uploadError.message);
    return { error: SET_FRAME_SAVE_FAILED };
  }

  // A photo set's shot carries the very photograph the set was built from
  // (2026-09-15): without it the render inherited the photo only through
  // Astra's words, and everything the words didn't pin drifted — the
  // operator's pyramid wall art came back as flat squares, the sea view as
  // trees (docs/ASTRA_SETS.md). The prompt gives it one job — materials and
  // details, never the camera — and names anyone in it out of the shot. A
  // read that fails just shoots without it, as every shot did before.
  const photoSource = (await readPhotoSources(admin, [setId], userId)).sources.get(setId) ?? null;
  const sourcePhotoUrl = photoSource ? mediaUrl("generated-images", photoSource.path) : null;

  const direction = cleanText(input.direction, SET_DIRECTION_MAX_CHARS);
  const push = Array.isArray(input.push) ? input.push.filter(isRigCheckItem) : [];
  const rigCtx = layout?.camera
    ? {
        distanceM: Math.hypot(
          layout.camera.position[0] - layout.mark.x,
          layout.camera.position[1] - STAND_IN_EYE_M[layout.pose],
          layout.camera.position[2] - layout.mark.z,
        ),
        fovDeg: layout.camera.fovDeg,
        cameraBearingDeg: bearingDeg(layout.mark, { x: layout.camera.position[0], z: layout.camera.position[2] }),
        push,
      }
    : { distanceM: 0, fovDeg: 40, cameraBearingDeg: 0, push };
  const rigWords = rigWordsByItem(rig, rigCtx);
  const fd = new FormData();
  // `lifted` only chooses whether the prompt explains a brightened sketch;
  // a false value from a crafted request changes one sentence, still gated.
  const shot = {
    description: owned.spec.description,
    lifted: input.lifted === true,
    layout,
    // The eye-line (cut D): the layout's gaze, read against the set, in Picacho's words.
    gaze: layout ? gazeWords(layout.gaze, shown, layout.mark) : "",
    look,
    sourcePhoto: sourcePhotoUrl !== null,
    rig: rigSentences(rig, rigCtx),
    rigLight: rig.light !== null,
    // The hour the STAGE drew (time-of-day.ts): the description is the set as
    // Astra built it, and the rig can stage another — a night market at noon
    // was still described as night, over a noon sketch (2026-09-18). Silent
    // under a plot whose key is a sun, where the plot's words describe the
    // light: timeApplies is the rule the stage itself follows.
    hour: hourWords(timeApplies(rig) ? rig.time : null),
    // The band's strips on the sketch (rig.ts letterbox): the picture is what lies between them.
    band: bandSide(rigFrame),
    // Which way each vehicle in the frame faces, read from the set's own
    // lamps and wing (vehicles.ts), in this camera's terms: the blocks do
    // not say which end of a car is its nose (2026-09-21).
    vehicles: vehicleWords(shown, layout?.camera),
    // Which sheet is which thing, in sheet order (elements.ts planSheets).
    elements: elementPlan.sentences,
    elementsGrey: allGrey,
  };
  fd.set("prompt", buildSetShotPrompt({ ...shot, direction }));
  fd.set("set_format", rig.format);
  // The engine the person picked, and on Nano Banana the render's own shape
  // (rig.ts RIG_FORMATS): the cut to the frame lines is by proportion, so a
  // 3:2 render cuts exactly as GPT Image's 1536 × 1024 does.
  if (pickedEngine) fd.set("image_model_id", pickedEngine);
  if (pickedEngine === "gemini") {
    const [w, h] = RIG_FORMATS[rig.format].render;
    fd.set("image_aspect", w === h ? "1:1" : w > h ? "3:2" : "2:3");
  }
  // The anamorphic squeeze: the band it widens is worked out server-side
  // from these two names alone, as the format always was (2026-09-18).
  fd.set("set_squeeze", String(rig.squeeze));
  // What the lab develops after the cut (lab-grade.ts): the stock, the
  // lens's character, black and white. Never in the words above.
  const lab = labLooksOf(rig);
  if (lab) fd.set("set_lab", JSON.stringify(lab));
  // The same prompt without the person's direction: all of it Astra's
  // description and Picacho's sentences. If the gate refuses the shot, this
  // part is judged again alone, and a refusal it earns by itself is logged
  // under Astra, never against the person (refusal-attribution.ts).
  const modelOnlyPrompt = buildSetShotPrompt({ ...shot, direction: "" });
  fd.set("content_type", "image");
  // The press's id is the still's row id (2026-09-25): a resend of this press
  // meets it at the reservation and follows the first delivery's still
  // instead of paying for another (generations/repeat-send.ts).
  if (opts.generationId) fd.set("generation_id", opts.generationId);
  fd.set("character_id", characterId);
  // The prompt is already the one the image model should read: the drafter
  // would rewrite the composition instructions it exists to carry. Still
  // gated, in the strict lane, inside runGeneration.
  fd.set("prompt_is_final", "1");
  // Its brand rules are judged with Picacho's fixed sentences taken out
  // (pipeline.ts setShot, set-shot-prompt.ts stripSetShotScaffold).
  fd.set("set_shot", "1");
  // The sketch rides as the one neutral reference; the look, when there is
  // one, as a "look" photo (pipeline.ts says what it is, so it is never
  // taken for the person). The look is the set's kept cutout in
  // generated-images: it is not a chat attachment, so deleting this take
  // never deletes it.
  fd.set(
    "attachment_roles",
    JSON.stringify([
      { url: mediaUrl("chat-attachments", framePath), role: "reference" },
      ...(look ? [{ url: look.url, role: "look" }] : []),
      // The source photograph rides under the scene role, which a set shot
      // reads as PIXELS (generations/actions.ts placeImageUrl) — the prompt
      // describes it by what it shows, the same pattern as the look sheet.
      // Stored in generated-images with the set, so deleting this take
      // never deletes it.
      ...(sourcePhotoUrl ? [{ url: sourcePhotoUrl, role: "scene" as const }] : []),
      // The things' own sheets, in sheet order: the render lane sends them
      // last, so "the last reference photos" in the words are exactly them
      // (image-references.ts). Stored with the set, never a take's.
      ...elementPlan.riding.map((r) => ({ url: mediaUrl("generated-images", setElementSheetPath(userId, setId, r.hash)), role: "element" as const })),
    ]),
  );

  const result = await withModelWrittenPrompt({ modelOnlyPrompt, provider: "astra" }, () => runGeneration(fd));
  if (result.error !== null) {
    // Refused or never started: no take holds the frame, so nothing else
    // would ever clean it up.
    await admin.storage.from("chat-attachments").remove([framePath]);
    return { error: result.error };
  }

  const { error: shotInsertError } = await admin
    .from("location_set_shots")
    .insert({ set_id: setId, generation_id: result.id, user_id: userId });
  // A duplicate is this press's other delivery having recorded the same
  // still (its id is the press's, 2026-09-25): it is recorded.
  const shotError = shotInsertError?.code === "23505" ? null : shotInsertError;
  if (shotError) console.error("shootInSet couldn't record the shot:", shotError.message);
  // The person's message, as written, in an update of its own whose failure
  // is ignored (shot-words-store.ts: until set-shot-words.sql runs the
  // column is missing). Cleaned as the direction is, a little longer.
  if (!shotError) {
    const words = cleanText(typeof input.words === "string" ? input.words : "", SHOT_WORDS_STORED_MAX_CHARS);
    if (words.length > 0) await recordShotWords(admin, { setId, generationId: result.id, userId }, words);
  }
  // The frame this still was drawn from, so it can be a later shot's look:
  // the stage's pose and the figure's mark exactly as the page sent them,
  // never the layout normalised above, which holds the camera to the set's
  // reach and so can be a camera the frame was not taken from
  // (shot-camera.ts). In an update of its own after the row is in, whose
  // failure is ignored — until set-shot-camera.sql runs the column is
  // missing, and naming it in the insert above would fail every shot.
  const camera = shotError ? null : frameCamera;
  // The rig it was shot with: the format and each checked look's words as
  // sent, for the line under it and the look check (shot-rig.ts). Its own
  // update, failure ignored, like the camera's.
  if (!shotError) await recordShotRig(admin, { setId, generationId: result.id, userId }, { format: rig.format, squeeze: rig.squeeze, words: rigWords });
  const recorded = camera ? await recordShotCamera(admin, { setId, generationId: result.id, userId }, camera) : false;
  // Offered as a look only when there is something to cut out of it clear
  // of the person — the same rule the set page reads (data.ts).
  const hasLookObjects = recorded && camera !== null && seesLookObjects(shown, camera);
  if (layout && input.beat !== true) {
    await admin
      .from("location_sets")
      .update({ layout, updated_at: new Date().toISOString() })
      .eq("id", setId)
      .eq("user_id", userId)
      .is("deleted_at", null);
  }

  return {
    error: null,
    generationId: result.id,
    succeeded: result.succeeded,
    failure: result.succeeded ? null : stillFailure(result),
    resultUrl: result.resultUrl,
    score: typeof result.matchScore === "number" ? result.matchScore : null,
    hasLookObjects,
    lookDropped,
    format: rig.format,
    /** The look stayed out: it shows a thing now drawn from its own photos. */
    lookAside,
    /** The squeeze it was cut at: a take shot from it plays in the band that widened. */
    squeeze: rig.squeeze,
    checks: rigCheckItems(rig),
    // A sheet planned but not sent (the render lane's own guard said no:
    // generations/actions.ts elementImageUrls) says so.
    elements: elementPlan.statuses.map((e) =>
      e.status === "rode" && (e.sheet ?? 0) > (result.elementSheets ?? 0) ? { key: e.key, status: "not-sent" as const } : e,
    ),
  };
}

export type TakeResult =
  | { error: string }
  | {
      error: null;
      /** The end frame, shot first — a whole ShootResult of its own. */
      still: Extract<ShootResult, { error: null }>;
      /** The end frame was a still the set already had (endGenerationId), not one shot for this take: nothing new joins the set. */
      reusedEnd: boolean;
      /** The clip's row, rendering in the background when it started; null when the video leg could not start. */
      takeGenerationId: string | null;
      /** Said when takeGenerationId is null: the end still is in, the clip is not. */
      takeError: string | null;
      /** A film's beat stopped before its clip (2026-09-21): its end frame scored under the identity bar, and the film must not keep it as the beat's end. */
      stopped?: "face";
    };

/**
 * What takeInSet hands the take's body (2026-09-25, Cut 1), all worked out
 * on the server from the press: the first line's time, the rows' ids made
 * from the press id, and for a film beat its Render.
 */
type TakeCtx = {
  /** The press's first line: the request's 300 s count from here (set-config.ts SET_TAKE_CLIP_START_BY_MS). */
  startedAt: number;
  /** The end still's row id (press.ts): the press's own, or its film beat's. Null for a press that named none. */
  stillId: string | null;
  /** The clip's row id, made from the still's (press.ts pressClipId). */
  clipId: string | null;
  /** A film beat's Render and its number: an earlier beat of the same Render already counted it (press.ts renderPaidBefore). */
  render: { pressId: string; beat: number } | null;
};

/**
 * A take in Helios (take.ts, 2026-09-15): a clip from an earlier still to
 * the frame on the stage now. The end frame is shot first as an ordinary
 * still with the START riding as its look, so both frames show the same
 * world; then the engine's start-and-end-frame lane animates between the
 * two rendered stills, through the ordinary video pipeline — drafted,
 * gated, priced and scored like any clip. Two engines (take.ts): Gemini
 * Omni Flash the take, Veo 3.1 the premium take; an unknown engine falls
 * back to the default rather than failing a real frame over a bad enum.
 * The clip returns QUEUED: it renders in the background and the page shows
 * it as a take still rendering.
 */
/**
 * A finished still of this set — the person's own, succeeded, not deleted,
 * an image — as its RAW stored url; null for anything else. What a take may
 * start on, and a film beat rendered again may end on.
 */
async function finishedStillUrl(
  db: Awaited<ReturnType<typeof createClient>>,
  setId: string,
  userId: string,
  generationId: string,
): Promise<string | null> {
  if (!UUID_RE.test(generationId)) return null;
  const { data: shot } = await db
    .from("location_set_shots")
    .select("generation_id")
    .eq("set_id", setId)
    .eq("generation_id", generationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!shot) return null;
  const { data: gen } = await db
    .from("generations")
    .select("status, result_url, content_type, deleted_at")
    .eq("id", generationId)
    .eq("user_id", userId)
    .maybeSingle();
  return gen && gen.status === "succeeded" && !gen.deleted_at && gen.content_type === "image" && typeof gen.result_url === "string"
    ? // Signed again under today's key, as every other reader of a stored
      // link does (media/url.ts toMediaUrl): the frames go to the video
      // lane, which fetches them over the open internet.
      toMediaUrl(gen.result_url)
    : null;
}

/**
 * ONE PRESS, ONE CHARGE (operator, 2026-09-25: "GO ahead" on Cut 1): as a
 * still's (shootInSet). The page names each Take and each clip rendered
 * again (`pressId`), and a film Render once for all its beats, each beat
 * saying which it is (`filmBeat`). A second delivery of the same press meets
 * the first's claim row before anything is counted, drawn, uploaded or
 * charged, and answers with the first's answer. The end still's row id and
 * the clip's are made from the press id, so even without the ledger the
 * reservation refuses a second charge. Its renders count the request's
 * 300 s from this first line (server-press.ts). A film's beats also skip
 * runGeneration's 3-second cooldown: the next beat follows the last one's
 * clip within seconds, one Render bounded by the take limiter. A single
 * take or a clip rendered again keeps it, as any send does (review,
 * 2026-09-25): its clip comes a whole still's render after its end still.
 */
export async function takeInSet(setId: string, input: Parameters<typeof takeWork>[3] & { pressId?: string; filmBeat?: number }): Promise<TakeResult> {
  const startedAt = Date.now();
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  // A take is every paid plan's since 2026-09-19 ("Open to all plans",
  // set-config.ts setTakesEligible): said here, before its end still is
  // shot and paid for, not by the clip's own send afterwards.
  if (!setTakesEligible(access.plan, access.isAdmin)) return { error: SET_TAKE_NEEDS_PLAN };
  // The set, for the rack's words (cut C): a rack names one of its things.
  const owned = await readyOwnedSpec(setId, access.userId);
  if (owned.error !== null) return { error: owned.error };
  const film = input?.film === true;
  const pressId = parsePressId(input?.pressId);
  const beat = film ? parseFilmBeat(input?.filmBeat) : null;
  // A film's beats share their Render's id; a beat that does not say which it is is served untracked, never taken for another beat's repeat.
  const ledgerId = pressId === null || (film && beat === null) ? null : pressLedgerId(pressId, beat);
  const ctx: TakeCtx = { startedAt, stillId: ledgerId, clipId: ledgerId ? pressClipId(ledgerId) : null, render: film && pressId !== null && beat !== null ? { pressId, beat } : null };
  return runPress(createAdminClient(), { id: ledgerId, userId: access.userId, setId, kind: "take" }, { deadlineAt: startedAt + REPEAT_FOLLOW_DEADLINE_MS }, (claim) =>
    withServerPress({ startedAt, skipCooldown: ctx.render !== null }, () =>
      // A Render is counted once only when this delivery holds its claim
      // (review, 2026-09-25): untracked (the ledger's SQL not run yet, or the
      // claim failed), every beat is counted by the limiters, as before.
      takeWork(access, setId, owned, input, claim.kind === "claimed" ? ctx : { ...ctx, render: null }),
    ),
  );
}

async function takeWork(
  access: SetsOk,
  setId: string,
  owned: { spec: SetSpec },
  input: {
    startGenerationId: string;
    /**
     * A finished still of this set to END on instead of shooting one — a film
     * beat whose clip is rendered again on the end frame it already has
     * (film.ts filmJobs). Checked like the start; the frame is then unused.
     */
    endGenerationId?: string | null;
    /**
     * The film's one look (renderFilm, 2026-09-21): a still of this set, the
     * same for every beat, never the beat before's end still. Absent, the
     * take's start still is its look, as a single take's is. Checked in
     * shootStill like any look. A thing's own photos ride as its sheet
     * instead (R1), never as the look.
     */
    lookGenerationId?: string | null;
    /** That look was picked by the person (a still other than the opening one), not the film's default. */
    lookPicked?: boolean;
    frameDataUri: string;
    characterId: string;
    direction: string;
    layout: unknown;
    engine?: string;
    lifted?: boolean;
    canvasAspect?: number;
    words?: string;
    /** The set's rig (rig.ts): the end still shoots with it, and its format sets the clip's shape. */
    rig?: unknown;
    /** A film beat's move and textures (moves.ts): words for the path between the frames. */
    move?: unknown;
    textures?: unknown;
    /** A film beat's rack of focus (furniture.ts): read against the set's things here, never trusted. */
    rack?: unknown;
    /** A film beat's eye-line at its end (people.ts): read against the set's things here, never trusted. */
    gaze?: unknown;
    /** A film's beat (renderFilm): kept as the film's, which renders it again itself (shot-take.ts). */
    film?: boolean;
    /** The person's order for the things' sheets (R1): passed to the end still's shot. */
    elementOrder?: unknown;
    /** The beat's movers (movers.ts): where the things that move stand in its end frame, and in the words written about it. */
    movers?: unknown;
    /** The still engine and the things drawn grey in the sketch, as a still's (shootStill). */
    stillEngine?: unknown;
    greyed?: unknown;
  },
  ctx: TakeCtx,
): Promise<TakeResult> {
  const { userId } = access;

  // The start: a finished still of THIS set, the person's own, not deleted.
  const startId = typeof input?.startGenerationId === "string" ? input.startGenerationId : "";
  const startUrl = await finishedStillUrl(access.supabase, setId, userId, startId);
  if (!startUrl) return { error: SET_TAKE_BAD_START };
  // Who the take is of. A film's beat is shot with the person its start
  // still shows (2026-09-21): the first film opened on a still of one
  // character with another picked, and beat 1 morphed one into the other.
  // Every take now, a single take and a clip rendered again too
  // (2026-09-25): the engine morphed one person into the other, charged in
  // full (the 2 and 6 face scores of 21 Sep). The start still, and a kept
  // end still, must show the person picked; a still with no person on record
  // passes, as before. Stopped before anything is counted, shot or charged.
  const characterId = typeof input?.characterId === "string" ? input.characterId : "";
  if (!UUID_RE.test(characterId)) return { error: SET_PICK_CHARACTER };
  const reuseId = typeof input?.endGenerationId === "string" && input.endGenerationId.length > 0 ? input.endGenerationId : null;
  const framesOf = reuseId && UUID_RE.test(reuseId) ? [startId, reuseId] : [startId];
  const { data: framePeople } = await access.supabase.from("generations").select("id, character_profile_id").in("id", framesOf).eq("user_id", userId);
  const otherIn = (frameId: string) =>
    (framePeople ?? []).some(
      (g) => g.id === frameId && typeof g.character_profile_id === "string" && g.character_profile_id.toLowerCase() !== characterId.toLowerCase(),
    );
  if (otherIn(startId)) return { error: input.film === true ? SET_TAKE_OTHER_PERSON : SET_TAKE_START_OTHER_PERSON };
  // The kept end frame is the one of someone else (review, 2026-09-25): said
  // as the end's, never as "the film opens on", and a film's page drops that
  // end so its next Render shoots the beat whole.
  if (reuseId && otherIn(reuseId)) return { error: input.film === true ? SET_TAKE_END_OTHER_PERSON : SET_TAKE_RETRY_END_OTHER_PERSON };
  // Who is in the character's photos (R1.12): the end still's shot asks
  // too, but a take on a kept end frame never shoots one.
  {
    const { data: who } = await access.supabase.from("character_profiles").select("reference_image_urls").eq("id", characterId).eq("user_id", userId).maybeSingle();
    const paths = Array.isArray(who?.reference_image_urls) ? (who.reference_image_urls as string[]) : [];
    if (await likenessBlocks(access.supabase, userId, characterId, paths)) return { error: SET_LIKENESS_NEEDED };
  }
  // An end frame the set already has: the same checks, before a take is counted.
  const reusedUrl = reuseId ? await finishedStillUrl(access.supabase, setId, userId, reuseId) : null;
  if (reuseId && !reusedUrl) return { error: SET_TAKE_BAD_END };
  const engineKey = isSetTakeEngine(input.engine) ? input.engine : SET_TAKE_DEFAULT_ENGINE;
  // The whole take is paid for, or none of it. The end still is charged
  // before the clip is asked for, so a person who could pay for the still
  // but not the clip was left with a still they had not asked for on its
  // own, and no clip. Both are asked for at once, before anything is spent
  // or counted — one check on the sum is exact for everyone Helios admits
  // (plans and admins; the free day's slot never applies). A reused end
  // leaves only the clip, which runGeneration asks for itself.
  if (!reuseId) {
    const allowance = await checkGenerationAllowance(access.supabase, userId, takesCredits(engineKey, { clips: 1, stills: 1 }), {
      skipCooldown: true,
    });
    if (allowance.error) return { error: allowance.error };
  }
  // The take limiter counts a press once, as it is about to pay (2026-09-25):
  // after every stop above and in the end still's shot that costs nothing
  // (the look, the things' sheets, the time), just before its first paid
  // render — the end still's, or the clip's when the end is kept. A film
  // Render is one press: its later beats find what its first paid beat
  // reserved (the rows under the Render's ids, press.ts renderPaidBefore)
  // and are counted by neither limiter, so a film is refused at its first
  // paid beat or not at all, never halfway. It cannot be bypassed: a Render
  // id is good for at most FILM_MAX_BEATS beats, and a new one costs a slot.
  // The limiter cannot give a slot back: a render the prompt gate or the
  // person's own brand rules refuse after this point still counts.
  const renderCounted = ctx.render ? await renderPaidBefore(access.supabase, userId, { ...ctx.render, setId }) : false;
  const takeBrake = async (): Promise<string | null> => {
    if (renderCounted) return null;
    return (await rateLimited(userId, "set-take", 60 * 10, SET_TAKES_PER_10_MIN)) ? SET_TAKE_TOO_FAST : null;
  };

  let still: Extract<ShootResult, { error: null }>;
  let endUrl: string | null;
  if (reuseId && reusedUrl) {
    // Nothing is shot and nothing is charged for the frame: only the clip
    // renders, on the frame the beat already ends on, cut as it was cut.
    const rigs = await readShotRigs(access.supabase, setId, userId, [reuseId]);
    still = {
      error: null,
      generationId: reuseId,
      succeeded: true,
      resultUrl: null,
      score: null,
      hasLookObjects: false,
      lookDropped: false,
      lookAside: false,
      format: rigs.get(reuseId)?.rig?.format ?? "square",
      squeeze: rigs.get(reuseId)?.rig?.squeeze ?? 1,
      failure: null,
      checks: [],
      // Nothing was shot, so nothing rode.
      elements: [],
    };
    endUrl = reusedUrl;
    // An end frame kept from an earlier render is held to the same bar before
    // its clip is paid for (2026-09-21): ends shot before a film stopped on
    // the bar were never checked. Nothing is charged; the film shoots the
    // beat whole on the next Render.
    if (input.film === true) {
      const { data: endRow } = await access.supabase
        .from("generations")
        .select("match_score")
        .eq("id", reuseId)
        .eq("user_id", userId)
        .maybeSingle();
      const score = typeof endRow?.match_score === "number" ? endRow.match_score : null;
      const bar = score !== null ? await readIdentityThreshold(access.supabase) : 0;
      if (score !== null && bar > 0 && score < bar) {
        // Nothing was shot, so nothing was charged, and it says so (2026-09-25).
        return { error: null, still: { ...still, score }, reusedEnd: true, takeGenerationId: null, takeError: SET_TAKE_OFF_FACE_KEPT_END, stopped: "face" };
      }
    }
    // Counted here, just before the press's one paid step: the clip.
    const braked = await takeBrake();
    if (braked) return { error: braked };
  } else {
    // The end frame: an ordinary still, every check inside running again,
    // with the start riding as its look so the two frames share one world.
    const shot = await shootStill(access, setId, owned, {
      frameDataUri: input.frameDataUri,
      characterId: input.characterId,
      direction: input.direction,
      layout: input.layout,
      lifted: input.lifted,
      canvasAspect: input.canvasAspect,
      words: input.words,
      // The look the caller named (a film's one look), else the start.
      // A named look is required: the beat stops, free, rather than shoot
      // an end frame without it (shootStill lookRequired).
      ...(input.lookGenerationId !== undefined
        ? {
            lookGenerationId: input.lookGenerationId ?? null,
            lookRequired: input.lookPicked === true ? ("picked" as const) : ("default" as const),
          }
        : { lookGenerationId: startId }),
      rig: input.rig,
      beat: input.film === true,
      // The things' sheets ride the end frame as they ride any still; a
      // film's beat stops, free, rather than shoot its end frame without
      // one (R1, 2026-09-21).
      elementOrder: input.elementOrder,
      elementsRequired: input.film === true,
      stillEngine: input.stillEngine,
      greyed: input.greyed,
      // Where this beat leaves the things that move (movers.ts): the frame
      // was drawn with them there.
      movers: input.movers,
    }, {
      startedAt: ctx.startedAt,
      // The end still's row id is the press's (press.ts), so a resend meets it.
      generationId: ctx.stillId,
      // The take is counted just before the still's first paid step.
      beforePaid: takeBrake,
      // A film Render counted by an earlier beat: not counted again.
      skipShotBrake: renderCounted,
    });
    if (shot.error !== null) return { error: shot.error };
    still = shot;
    // Said as what it is: the end frame did not pass, so no clip was asked
    // for (2026-09-21 — this used to say "the end frame is in").
    if (!still.succeeded) return { error: null, still, reusedEnd: false, takeGenerationId: null, takeError: SET_TAKE_END_FAILED };
    // The end frame's row, read once its checks are done: its RAW stored url
    // — resolveMaybeSignedUrl in the video lane takes our own /api/media
    // paths, never a thumbnail transform — and what it was charged.
    const { data: endGen } = await access.supabase
      .from("generations")
      .select("result_url, credits_used")
      .eq("id", still.generationId)
      .eq("user_id", userId)
      .maybeSingle();
    // A film's end frame under the identity bar makes no clip (2026-09-21):
    // the video engine morphs between two different faces. The film shoots
    // the beat again on the next Render.
    if (input.film === true && still.score !== null) {
      const bar = await readIdentityThreshold(access.supabase);
      if (bar > 0 && still.score < bar) {
        // Said as it is (2026-09-25): the identity gate refunds a frame it
        // settled, within the plan's daily ceiling (generations/actions.ts,
        // the gate's settlement), and its row then says 0. A row that can't
        // be read is said as charged: never a refund it can't confirm.
        const offFace = endGen?.credits_used === 0 ? SET_TAKE_OFF_FACE_REFUNDED : SET_TAKE_OFF_FACE;
        return { error: null, still, reusedEnd: false, takeGenerationId: null, takeError: offFace, stopped: "face" };
      }
    }
    endUrl = typeof endGen?.result_url === "string" ? toMediaUrl(endGen.result_url) : null;
  }
  const reusedEnd = reuseId !== null;
  if (!endUrl) return { error: null, still, reusedEnd, takeGenerationId: null, takeError: SET_TAKE_FAILED };
  // Time (2026-09-25): a clip started this late can be cut off by the
  // platform after its reservation, and sit charged on "generating" until
  // the reaper. It is not started: the end frame is kept, and the clip is
  // rendered again on its own — the page offers that when the still is in
  // and the clip is not, and a film keeps the end and renders the clip
  // alone on its next Render.
  if (Date.now() - ctx.startedAt > SET_TAKE_CLIP_START_BY_MS) return { error: null, still, reusedEnd, takeGenerationId: null, takeError: SET_TAKE_FAILED };

  const engine = SET_TAKE_ENGINES[engineKey];
  const fd = new FormData();
  fd.set("content_type", "video");
  fd.set("video_model_id", engine.model);
  fd.set("video_duration_seconds", String(engine.seconds));
  fd.set("character_id", input.characterId);
  // The clip's row id, made from the press's (press.ts, 2026-09-25): a
  // resend of this press meets it at the reservation instead of paying for
  // a second clip.
  if (ctx.clipId) fd.set("generation_id", ctx.clipId);
  const textures = Array.isArray(input.textures) ? [...new Set(input.textures.filter(isFilmTexture))] : [];
  // Where the figure ends (the take's own layout), for the eye-line's side words.
  const endLayout = normaliseSetLayout(input.layout, owned.spec);
  // And where the things that move end (movers.ts), for the same words.
  const endShown = movedSpec(owned.spec, setElements(owned.spec), normalisePlacements(input.movers));
  const endMark = endLayout?.mark ?? { x: owned.spec.marks[0].x, z: owned.spec.marks[0].z, facingDeg: owned.spec.marks[0].facingDeg };
  fd.set(
    "prompt",
    buildSetTakePrompt(typeof input.direction === "string" ? input.direction : "", {
      move: isFilmMove(input.move) ? input.move : null,
      textures,
      // Against the set as the beat ENDS (movers.ts): a rack or an eye-line
      // names a thing by where it stands, and a thing that drove away stands
      // somewhere else by the last frame.
      rack: rackWords(normaliseRack(input.rack, owned.spec.objects.length), endShown),
      gaze: gazeWords(normaliseGaze(input.gaze, owned.spec.objects.length), endShown, endMark, "take"),
    }),
  );
  // The words are already what the video model should read: the drafter
  // would expand them into "2 to 4 vivid sentences" and add the character's
  // saved traits and way of moving, rewriting the move the person picked,
  // as it would a still's composition (shootInSet). Still gated, brand
  // rules included, inside runGeneration (2026-09-21, the first real film).
  fd.set("prompt_is_final", "1");
  // Its brand rules are judged with Picacho's fixed take sentences taken
  // out, as a still's are (pipeline.ts setTake, take-scaffold.ts,
  // 2026-09-25): the operator's 16 rules were reading "One continuous shot,
  // no cuts…" as his words. The platform's gates read it whole.
  // runGeneration knows a take by the frames' mark in server memory
  // (withServerBuiltFrames below), never by a form field.
  // The still's own shape, the one ratio the frames already hold: a tall
  // frame renders a tall clip, every other rig format 16:9, and the page
  // plays it inside its frame lines (shot-rig.ts keeps the format). Sent
  // for every take, and runGeneration lets no words in the direction turn
  // it (heliosTake, 2026-09-25): "like a reel" rendered a 9:16 clip between
  // two 16:9 frames.
  fd.set("video_aspect_ratio", takeAspectRatio(still.format));
  fd.set("storyboard_start_path", startUrl);
  fd.set("storyboard_end_path", endUrl);
  // The clip's frames are ours, and the plan was checked above: the frames
  // gate reads the mark from server memory (server-built.ts).
  const clip = await withServerBuiltFrames(() => runGeneration(fd));
  if (clip.error !== null) {
    console.warn("takeInSet video leg refused:", clip.error);
    return { error: null, still, reusedEnd, takeGenerationId: null, takeError: clip.error };
  }

  // The take joins the set's shots like a still does, with the words that
  // asked for it; a failure to record leaves it in History all the same.
  const admin = createAdminClient();
  const { error: takeInsertError } = await admin
    .from("location_set_shots")
    .insert({ set_id: setId, generation_id: clip.id, user_id: userId });
  // A duplicate is this press's other delivery having recorded the same
  // clip (its id is made from the press's, 2026-09-25): it is recorded.
  const takeRowError = takeInsertError?.code === "23505" ? null : takeInsertError;
  if (takeRowError) console.error("takeInSet couldn't record the take:", takeRowError.message);
  else {
    const key = { setId, generationId: clip.id, userId };
    const words = cleanText(typeof input.words === "string" ? input.words : "", SHOT_WORDS_STORED_MAX_CHARS);
    if (words.length > 0) await recordShotWords(admin, key, words);
    if (still.format !== "square" || still.squeeze > 1) await recordShotRig(admin, key, { format: still.format, squeeze: still.squeeze, words: {} });
    // What the clip was rendered from, so a clip that fails can be rendered
    // again between the same two stills on a later visit too (shot-take.ts).
    // Its own update, failure ignored, like the rig's.
    await recordShotTake(admin, key, {
      start: startId,
      end: still.generationId,
      engine: engineKey,
      direction: typeof input.direction === "string" ? input.direction : "",
      film: input.film === true,
    });
  }
  return { error: null, still, reusedEnd, takeGenerationId: clip.id, takeError: null };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

// Deleting your own set needs no switch and no plan: a person can always
// remove what is theirs. It is a SOFT delete — the row stays, emptied of
// the person's words and the set itself, because the monthly cap counts
// builds and a deleted build was still a build (see the header). The takes
// shot in it stay in History: they are takes, and deleting one is History's
// decision. What the set kept about them goes (2026-09-16).
const CLEAR_SET_WORK = { edited_spec: null, film: null, rig: null } as const;

export async function deleteSet(setId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: SETS_SESSION_EXPIRED };
  if (!UUID_RE.test(setId)) return { error: SET_NOT_FOUND };
  const userId = userData.user.id;
  const admin = createAdminClient();

  // The job id is cleared ON THE VALUE READ, and the read is repeated if the
  // row moved on in between: a tick can swap the claim for a retry's id
  // between this read and this write, and cancelling the stale value would
  // leave that retry running, uncollected and unbilled to the set.
  for (let tries = 0; tries < 3; tries++) {
    const { data: row } = await admin
      .from("location_sets")
      .select("status, response_id, thumb_path")
      .eq("id", setId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!row) return { error: SET_DELETE_FAILED };

    const now = new Date().toISOString();
    let write = admin
      .from("location_sets")
      .update({
        deleted_at: now,
        updated_at: now,
        // Clearing the id is what tells a tick holding the claim that the set
        // is gone (every write after a claim is conditioned on it).
        response_id: null,
        brief: RESERVED,
        title: "",
        description: "",
        spec: null,
        layout: null,
        thumb_path: null,
      })
      .eq("id", setId)
      .eq("user_id", userId)
      .is("deleted_at", null);
    write = row.response_id === null ? write.is("response_id", null) : write.eq("response_id", row.response_id as string);
    const { data: gone, error } = await write.select("id");
    if (error) {
      console.error("deleteSet failed:", error.message);
      return { error: SET_DELETE_FAILED };
    }
    if (!gone?.length) continue;
    if (row.status === "building" && typeof row.response_id === "string" && row.response_id !== "claiming") {
      await cancelAstraJob(row.response_id);
    }
    if (row.thumb_path) {
      await admin.storage.from("generated-images").remove([row.thumb_path as string]);
    }
    // A photo set's photo lives at a fixed path, so it is removed without
    // reading anything — harmless for a set built from words. Then its
    // record, in a write of its own whose failure is ignored: the photo's
    // hash is the person's data like the brief cleared above, and naming
    // those columns in the delete itself would fail every delete until
    // astra-photo-sets.sql has run.
    await removeSetPhoto(admin, userId, setId);
    await admin.from("location_sets").update(CLEAR_PHOTO_SOURCE).eq("id", setId);
    // The looks' cutouts (the set's objects cut out of its stills) and the
    // person's reference photos with their sheets, kept beside its card at
    // fixed names (set-config.ts setLookCutoutPath, setRefPhotoPath), so
    // listing the folder finds them all. Best-effort, like the photo.
    await removeSetLookCutouts(admin, userId, setId);
    // The models kept on its things (thing-model-store.ts), the same way.
    await removeSetThingModels(admin, userId, setId);
    // What later work kept on the row, cleared like the words and the spec
    // above: the Build editor's working copy (the set itself), the film (the
    // person's words for each beat, and its camera moves) and the rig. A
    // write of its own, so the delete above never names a column that may
    // not exist; a failure is said and the delete stands.
    const { error: workError } = await admin
      .from("location_sets")
      .update(CLEAR_SET_WORK)
      .eq("id", setId)
      .eq("user_id", userId);
    if (workError) console.warn("deleteSet couldn't clear the working copy, film and rig:", workError.message);
    // And what the Recce read from a clip (recce-store.ts, which is the only
    // module that names its column), in a write of its own.
    await clearSetRecce(admin, setId, userId);
    // And the set's record of each shot — the person's words for it, what a
    // take was made from, the rig it was shot with and what the check read,
    // the camera it was framed from. The stills and takes themselves stay in
    // History; nothing reads these rows once their set is gone (the storage
    // audit counts only live sets', and the cutouts went above).
    const { error: shotsError } = await admin.from("location_set_shots").delete().eq("set_id", setId).eq("user_id", userId);
    if (shotsError) console.warn("deleteSet couldn't remove the set's shot records:", shotsError.message);
    // And its presses' answers (press.ts, 2026-09-25): an answer can quote
    // the person's words (a brand rule's block). Failures ignored; they are
    // pruned within a day anyway.
    await clearSetPresses(admin, setId, userId);
    return { error: null };
  }
  return { error: SET_DELETE_FAILED };
}
