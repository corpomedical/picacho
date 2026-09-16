"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";
import { mediaUrl } from "@/lib/media/url";
import { ContentPolicyRefusal, type Scores } from "@/lib/generations/content-policy";
import { assertOutputAllowed, OutputPolicyRefusal } from "@/lib/generations/output-policy";
import { gatePrompt, recentRefusalCount, recordPolicyRefusal } from "@/lib/generations/policy-log";
import { runGeneration } from "@/lib/generations/actions";
import { withModelWrittenPrompt } from "@/lib/generations/refusal-attribution";
import { cancelAstraJob, submitAstraJob } from "@/lib/generations/providers/astra";
import { openAiSafetyId } from "@/lib/openai/safety-id";
import { setsAccess, UUID_RE } from "@/lib/sets/access";
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
  setThumbPath,
} from "@/lib/sets/set-config";
import { cleanText, normaliseSetLayout, normaliseSetSpec, type SetSpec } from "@/lib/sets/set-spec";
import { setBuildInput } from "@/lib/sets/set-builder-prompt";
import { photoBuildRequest, setAstraRequest } from "@/lib/sets/astra-request";
import { buildSetShotPrompt } from "@/lib/sets/set-shot-prompt";
import {
  buildSetTakePrompt,
  isSetTakeEngine,
  SET_TAKE_DEFAULT_ENGINE,
  SET_TAKE_ENGINES,
  SET_TAKES_PER_10_MIN,
} from "@/lib/sets/take";
import { lookStoragePath } from "@/lib/sets/look";
import {
  formatFrame,
  isRigCheckItem,
  normaliseSetRig,
  labLooksOf,
  rigCheckItems,
  rigSentences,
  rigWordsByItem,
  type RigCheckItem,
  type RigFormat,
} from "@/lib/sets/rig";
import { bearingDeg } from "@/lib/sets/light-schemes";
import { readShotRigs, recordShotRig } from "@/lib/sets/shot-rig";
import { isFilmMove, isFilmTexture } from "@/lib/sets/moves";

/** Where the rig's focus is measured to: the figure's eyes (build-scene's stand-in). */
const RIG_EYE_Y = 1.5;
import { lookCutout, removeSetLookCutouts, type LookCutoutResult } from "@/lib/sets/look-cutout-store";
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
  SET_TAKE_BAD_END,
  SET_TAKE_BAD_START,
  SET_TAKE_FAILED,
  setMonthlyCapMessage,
} from "@/lib/sets/messages";

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
    .insert({ ...extra, user_id: access.userId, brief: RESERVED, status: "building", attempts: 0 })
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

async function readyOwnedSpec(
  setId: string,
  userId: string,
): Promise<{ error: string } | { error: null; spec: SetSpec }> {
  if (!UUID_RE.test(setId)) return { error: SET_NOT_FOUND };
  const { data: row } = await createAdminClient()
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

type ShootResult =
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
      /** The rig format the still was cut to (rig.ts); "square" when none. */
      format: RigFormat;
      /** The looks the look check will read it against (rig.ts rigCheckItems); none when the rig asked for none. */
      checks: RigCheckItem[];
    };

/**
 * One still in a Set: the square snapshot the person framed, their
 * character, and a line about the moment. An ordinary image take from here
 * on — see the header.
 */
export async function shootInSet(
  setId: string,
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
  },
): Promise<ShootResult> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const { userId } = access;

  const frame = typeof input?.frameDataUri === "string" ? input.frameDataUri : "";
  if (!JPEG_DATA_URI.test(frame)) return { error: SET_FRAME_UNREADABLE };
  const bytes = Buffer.from(frame.slice(frame.indexOf(",") + 1), "base64");
  if (bytes.byteLength > MAX_SET_FRAME_BYTES) return { error: SET_FRAME_TOO_LARGE };
  if (bytes.byteLength < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return { error: SET_FRAME_UNREADABLE };

  const owned = await readyOwnedSpec(setId, userId);
  if (owned.error !== null) return { error: owned.error };

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

  if (await rateLimited(userId, "set-shot", 60 * 10, 12)) return { error: SET_SHOOT_TOO_FAST };

  const admin = createAdminClient();

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
  if (lookAsked) {
    const cut: LookCutoutResult = lookPath
      ? await lookCutout({
          admin,
          userId,
          setId,
          lookGenerationId: lookId,
          stillPath: lookPath,
          spec: owned.spec,
          camera: (await readShotCameras(access.supabase, setId, userId, [lookId])).get(lookId) ?? null,
        })
      : { ok: false, reason: "not a finished still of this set" };
    if (!cut.ok) {
      lookDropped = true;
      console.warn(`[sets] shot without its look: ${cut.reason}`);
    } else {
      const sheet = await lookSheet({ admin, userId, setId, lookGenerationId: lookId, cutoutPath: cut.path });
      if (sheet.ok) {
        look = { url: mediaUrl("generated-images", sheet.path) };
      } else {
        lookDropped = true;
        console.warn(`[sets] shot without its look: ${sheet.reason}`);
      }
    }
  }

  const framePath = setFramePath(userId, crypto.randomUUID());
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
  const push = Array.isArray(input.push) ? input.push.filter(isRigCheckItem) : [];
  const rigCtx = layout?.camera
    ? {
        distanceM: Math.hypot(
          layout.camera.position[0] - layout.mark.x,
          layout.camera.position[1] - RIG_EYE_Y,
          layout.camera.position[2] - layout.mark.z,
        ),
        fovDeg: layout.camera.fovDeg,
        cameraBearingDeg: bearingDeg(layout.mark, { x: layout.camera.position[0], z: layout.camera.position[2] }),
        push,
      }
    : { distanceM: 0, fovDeg: 40, cameraBearingDeg: 0, push };
  const rigWords = rigWordsByItem(rig, rigCtx);
  const rigFrame = formatFrame(rig.format);
  const fd = new FormData();
  // `lifted` only chooses whether the prompt explains a brightened sketch;
  // a false value from a crafted request changes one sentence, still gated.
  const shot = {
    description: owned.spec.description,
    lifted: input.lifted === true,
    layout,
    look,
    sourcePhoto: sourcePhotoUrl !== null,
    rig: rigSentences(rig, rigCtx),
    rigLight: rig.light !== null,
  };
  fd.set("prompt", buildSetShotPrompt({ ...shot, direction }));
  fd.set("set_format", rig.format);
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
    ]),
  );

  const result = await withModelWrittenPrompt({ modelOnlyPrompt, provider: "astra" }, () => runGeneration(fd));
  if (result.error !== null) {
    // Refused or never started: no take holds the frame, so nothing else
    // would ever clean it up.
    await admin.storage.from("chat-attachments").remove([framePath]);
    return { error: result.error };
  }

  const { error: shotError } = await admin
    .from("location_set_shots")
    .insert({ set_id: setId, generation_id: result.id, user_id: userId });
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
  const camera = shotError
    ? null
    : shotCameraOf(input.layout, input.canvasAspect, rigFrame.cut ? { render: rigFrame.renderAspect, band: rigFrame.bandAspect } : null);
  // The rig it was shot with: the format and each checked look's words as
  // sent, for the line under it and the look check (shot-rig.ts). Its own
  // update, failure ignored, like the camera's.
  if (!shotError) await recordShotRig(admin, { setId, generationId: result.id, userId }, { format: rig.format, words: rigWords });
  const recorded = camera ? await recordShotCamera(admin, { setId, generationId: result.id, userId }, camera) : false;
  // Offered as a look only when there is something to cut out of it clear
  // of the person — the same rule the set page reads (data.ts).
  const hasLookObjects = recorded && camera !== null && seesLookObjects(owned.spec, camera);
  if (layout) {
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
    resultUrl: result.resultUrl,
    score: typeof result.matchScore === "number" ? result.matchScore : null,
    hasLookObjects,
    lookDropped,
    format: rig.format,
    checks: rigCheckItems(rig),
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
    ? gen.result_url
    : null;
}

export async function takeInSet(
  setId: string,
  input: {
    startGenerationId: string;
    /**
     * A finished still of this set to END on instead of shooting one — a film
     * beat whose clip is rendered again on the end frame it already has
     * (film.ts filmJobs). Checked like the start; the frame is then unused.
     */
    endGenerationId?: string | null;
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
  },
): Promise<TakeResult> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const { userId } = access;

  // The start: a finished still of THIS set, the person's own, not deleted.
  const startId = typeof input?.startGenerationId === "string" ? input.startGenerationId : "";
  const startUrl = await finishedStillUrl(access.supabase, setId, userId, startId);
  if (!startUrl) return { error: SET_TAKE_BAD_START };
  // An end frame the set already has: the same checks, before a take is counted.
  const reuseId = typeof input?.endGenerationId === "string" && input.endGenerationId.length > 0 ? input.endGenerationId : null;
  const reusedUrl = reuseId ? await finishedStillUrl(access.supabase, setId, userId, reuseId) : null;
  if (reuseId && !reusedUrl) return { error: SET_TAKE_BAD_END };
  if (await rateLimited(userId, "set-take", 60 * 10, SET_TAKES_PER_10_MIN)) return { error: SET_SHOOT_TOO_FAST };

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
      format: rigs.get(reuseId)?.rig?.format ?? "square",
      checks: [],
    };
    endUrl = reusedUrl;
  } else {
    // The end frame: an ordinary still, every check inside running again,
    // with the start riding as its look so the two frames share one world.
    const shot = await shootInSet(setId, {
      frameDataUri: input.frameDataUri,
      characterId: input.characterId,
      direction: input.direction,
      layout: input.layout,
      lifted: input.lifted,
      canvasAspect: input.canvasAspect,
      words: input.words,
      lookGenerationId: startId,
      rig: input.rig,
    });
    if (shot.error !== null) return { error: shot.error };
    still = shot;
    if (!still.succeeded) return { error: null, still, reusedEnd: false, takeGenerationId: null, takeError: SET_TAKE_FAILED };

    // The two frames' RAW stored urls — resolveMaybeSignedUrl in the video
    // lane takes our own /api/media paths, never a thumbnail transform.
    const { data: endGen } = await access.supabase
      .from("generations")
      .select("result_url")
      .eq("id", still.generationId)
      .eq("user_id", userId)
      .maybeSingle();
    endUrl = typeof endGen?.result_url === "string" ? endGen.result_url : null;
  }
  const reusedEnd = reuseId !== null;
  if (!endUrl) return { error: null, still, reusedEnd, takeGenerationId: null, takeError: SET_TAKE_FAILED };

  const engine = SET_TAKE_ENGINES[isSetTakeEngine(input.engine) ? input.engine : SET_TAKE_DEFAULT_ENGINE];
  const fd = new FormData();
  fd.set("content_type", "video");
  fd.set("video_model_id", engine.model);
  fd.set("video_duration_seconds", String(engine.seconds));
  fd.set("character_id", input.characterId);
  const textures = Array.isArray(input.textures) ? [...new Set(input.textures.filter(isFilmTexture))] : [];
  fd.set(
    "prompt",
    buildSetTakePrompt(typeof input.direction === "string" ? input.direction : "", {
      move: isFilmMove(input.move) ? input.move : null,
      textures,
    }),
  );
  // A tall frame renders a tall clip; every other rig format renders 16:9
  // and the page plays it inside its frame lines (shot-rig.ts keeps the format).
  if (still.format === "vertical") fd.set("video_aspect_ratio", "9:16");
  fd.set("storyboard_start_path", startUrl);
  fd.set("storyboard_end_path", endUrl);
  const clip = await runGeneration(fd);
  if (clip.error !== null) {
    console.warn("takeInSet video leg refused:", clip.error);
    return { error: null, still, reusedEnd, takeGenerationId: null, takeError: clip.error };
  }

  // The take joins the set's shots like a still does, with the words that
  // asked for it; a failure to record leaves it in History all the same.
  const admin = createAdminClient();
  const { error: takeRowError } = await admin
    .from("location_set_shots")
    .insert({ set_id: setId, generation_id: clip.id, user_id: userId });
  if (takeRowError) console.error("takeInSet couldn't record the take:", takeRowError.message);
  else {
    const words = cleanText(typeof input.words === "string" ? input.words : "", SHOT_WORDS_STORED_MAX_CHARS);
    if (words.length > 0) await recordShotWords(admin, { setId, generationId: clip.id, userId }, words);
    if (still.format !== "square") await recordShotRig(admin, { setId, generationId: clip.id, userId }, { format: still.format, words: {} });
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
// decision.
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
    // The looks' cutouts: the set's objects cut out of its stills, kept
    // beside its card at fixed names (set-config.ts setLookCutoutPath), so
    // listing the folder finds them all. Best-effort, like the photo.
    await removeSetLookCutouts(admin, userId, setId);
    return { error: null };
  }
  return { error: SET_DELETE_FAILED };
}
