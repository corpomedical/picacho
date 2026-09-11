"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";
import { mediaUrl } from "@/lib/media/url";
import { assertPromptAllowed, ContentPolicyRefusal, type Scores } from "@/lib/generations/content-policy";
import { assertOutputAllowed, OutputPolicyRefusal } from "@/lib/generations/output-policy";
import { gatePrompt, recentRefusalCount, recordPolicyRefusal } from "@/lib/generations/policy-log";
import { runGeneration } from "@/lib/generations/actions";
import { cancelAstraJob, pollAstraJob, submitAstraJob, type AstraJobRequest } from "@/lib/generations/providers/astra";
import { openAiSafetyId } from "@/lib/openai/safety-id";
import { setsAccess, UUID_RE } from "@/lib/sets/access";
import { countSetBuildsThisMonth } from "@/lib/sets/data";
import { isPhotoSetsEnabled } from "@/lib/sets/enabled";
import {
  MAX_SET_FRAME_BYTES,
  MAX_SET_THUMB_BYTES,
  SET_BRIEF_MAX_CHARS,
  SET_BRIEF_MIN_CHARS,
  SET_BUILD_MAX_ATTEMPTS,
  SET_BUILD_STALE_MS,
  SET_DIRECTION_MAX_CHARS,
  SET_PHOTO_BUILD_INPUT_TOKENS,
  SET_PHOTO_CLOSE_RETRY_INPUT_TOKENS,
  SET_PHOTO_NOTES_MAX_CHARS,
  SET_RESERVED_BRIEF,
  setFramePath,
  setPhotoPath,
  setThumbPath,
} from "@/lib/sets/set-config";
import {
  cleanText,
  normaliseSetLayout,
  normaliseSetSpec,
  parseSetSpecText,
  specTextForGate,
  type SetSpec,
} from "@/lib/sets/set-spec";
import { setBuildInput } from "@/lib/sets/set-builder-prompt";
import { photoBuildRequest, retryBuildRequest, setAstraRequest, type SetRetry } from "@/lib/sets/astra-request";
import { buildSetShotPrompt } from "@/lib/sets/set-shot-prompt";
import { hasSavedOutfit, lookStoragePath } from "@/lib/sets/look";
import { decideAfterValidAnswer } from "@/lib/sets/build-retry";
import {
  CLEAR_PHOTO_SOURCE,
  isMissingColumn,
  normaliseSetPhoto,
  parseSetPhotoDataUri,
  photoDataUrl,
  photoForRetry,
  photoSourceColumns,
  readPhotoSources,
  removeSetPhoto,
} from "@/lib/sets/photo";
import type { SetKind } from "@/lib/sets/types";
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
  setFailureMessage,
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
// exactly as one sent from the composer, because it IS one.
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
// SETS FROM A PHOTO (docs 3.2, 2026-09-11; admins only, behind a second
// switch). The photo is the brief. It is re-encoded on the server (no EXIF,
// no GPS), judged by the picture check's readers BEFORE it is stored or
// sent to Astra — a refused photo is never written and never reaches Astra —
// then stored in the person's own folder and sent inline (store: false as
// ever). Astra is told never to model, identify or describe anyone in it;
// its title, description and labels pass the same strict-lane gate as a
// text build's. The photo is removed with the set, or when its build fails.
// Every column that marks a photo build is named only in photo.ts, and read
// in its own query: until supabase/pending/astra-photo-sets.sql runs, text
// sets work exactly as before and a photo build stops at its first write.

const JPEG_DATA_URI = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
// What a reserved row holds until its brief has passed the gate: a refused
// brief is never written, not even for the seconds the gate takes. A photo
// build keeps it when the photographer adds no notes (the column's CHECK
// wants 1–500 characters).
const RESERVED = SET_RESERVED_BRIEF;

/**
 * OpenAI refused the person's own input — their brief, or their photo and
 * notes: logged like any refusal of their words, and counted as session
 * context. A photo build without notes logs no text at all.
 */
async function logBriefRefusedByAstra(userId: string, prompt: string | null) {
  await recordPolicyRefusal({ userId, gate: "prompt", reason: "astra_refused", prompt: prompt || null });
}

/**
 * OpenAI refused a CLOSING retry — the input it had already accepted, plus
 * Astra's own set and our instruction. Mostly text the model wrote, so it
 * is logged under the provider and never counts as the person's session
 * context (policy-log.ts recentRefusalCount).
 */
async function logClosingRetryRefused(userId: string, prompt: string | null) {
  await recordPolicyRefusal({ userId, gate: "prompt", reason: "astra_refused", prompt: prompt || null, provider: "astra" });
}

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

type PollResult =
  | { error: string }
  | { error: null; state: "building" }
  | { error: null; state: "ready" }
  | { error: null; state: "failed"; message: string };

/** How open a set is, measured (closure.ts). Never costs a build: a check that cannot run reads as closed. */
async function closureOf(spec: SetSpec): Promise<{ open: number; sides: string[] }> {
  try {
    const THREE = await import("three");
    const { measureClosure, describeOpenSides } = await import("@/lib/sets/closure");
    const report = measureClosure(THREE, spec);
    return { open: report.openBearings.length, sides: describeOpenSides(spec, report.openSides) };
  } catch (err) {
    console.error("[sets] closure measurement failed:", err instanceof Error ? err.message : err);
    return { open: 0, sides: [] };
  }
}

// One tick of a build, driven by the page. Exactly one tick may act on a
// finished answer: it CLAIMS the row by swapping response_id for a sentinel,
// so two tabs polling the same set cannot both save, both retry, or both
// count the cost. Every write after the claim is conditioned on still
// holding it; deleting the set clears it, and the tick then records what
// the build cost and cancels anything it started.
//
// THE ONE RETRY is spent on the first problem found: an answer that ran out
// of room or came back unusable is built again; a valid set that is OPEN —
// a side a camera can see past, measured by closure.ts — is sent back to
// be closed, and is kept meanwhile as a DRAFT in the spec column. A draft
// has passed every check, so from then on nothing ends in a failed build:
// whatever happens to the closing retry, the person gets the better of the
// two sets, or the draft.
export async function pollSetBuild(setId: string): Promise<PollResult> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  if (!UUID_RE.test(setId)) return { error: SET_NOT_FOUND };
  const { userId } = access;
  const admin = createAdminClient();

  const { data: row } = await admin
    .from("location_sets")
    .select("id, status, brief, response_id, attempts, cost_usd, failure, updated_at, spec")
    .eq("id", setId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!row) return { error: SET_NOT_FOUND };
  if (row.status === "ready") return { error: null, state: "ready" };
  // Which kind of build this is, read on its own (photo.ts). The photo
  // columns not there yet reads as a text build, which every build is until
  // they are. A read that fails for any other reason is not an answer, and
  // this tick acts on nothing: on a guess of "text" a photo build's retry
  // would send its notes as a brief, with no photo and the text caps, and a
  // failure would leave its photo behind. The next tick reads again;
  // background mode keeps the answer meanwhile.
  const sources = await readPhotoSources(admin, [setId], userId);
  if (!sources.known) return { error: null, state: "building" };
  const src = sources.sources.get(setId) ?? null;
  const kind: SetKind = src ? "photo" : "text";
  if (row.status === "failed") return { error: null, state: "failed", message: setFailureMessage(row.failure, kind) };

  const stale = Date.now() - Date.parse(row.updated_at as string) > SET_BUILD_STALE_MS;
  const responseId = row.response_id as string | null;
  const priorCost = Number(row.cost_usd ?? 0);
  const attempts = Number(row.attempts ?? 1);
  const brief = row.brief as string;
  // A photo build's brief column holds the photographer's notes, or the
  // placeholder when there are none.
  const notes = kind === "photo" && brief !== RESERVED ? brief : "";
  // What a refusal of the person's own input is logged with: their words.
  const ownWords = kind === "photo" ? notes || null : brief;
  const safetyId = openAiSafetyId(userId);
  const kept = row.spec ? normaliseSetSpec(row.spec) : null;
  const draft = kept?.ok ? kept.spec : null;

  // What a retry sends (astra-request.ts retryBuildRequest): a text build
  // its brief, never the placeholder; a photo build its STORED photo, only
  // while the photo switch is on and only the bytes that passed the picture
  // check (photo.ts photoForRetry) — or no retry at all, never the notes
  // alone. Null: the set in hand, or the failure, stands. The photo is read
  // once, and only when a retry is wanted.
  let storedPhoto: string | null | undefined;
  const retryRequest = async (retry: SetRetry): Promise<AstraJobRequest | null> => {
    if (kind === "text") return retryBuildRequest({ kind, brief }, retry, safetyId);
    if (storedPhoto === undefined) storedPhoto = await photoForRetry(admin, src, () => isPhotoSetsEnabled(access.supabase));
    return retryBuildRequest({ kind, notes, photo: storedPhoto }, retry, safetyId);
  };

  const closeFailed = async (failure: string, costUsd: number) => {
    const { data: closed } = await admin
      .from("location_sets")
      .update({ status: "failed", failure, response_id: null, cost_usd: costUsd, updated_at: new Date().toISOString() })
      .eq("id", setId)
      .eq("status", "building")
      .select("id");
    // A failed card cannot be retried, so its photo has no use left; the
    // row keeps the record that it was a photo build. Removed whatever this
    // tick took the kind to be: the path is fixed, and removing it is
    // harmless for a set built from words, as in deleteSet.
    if (closed?.length) await removeSetPhoto(admin, userId, setId);
    return { error: null, state: "failed" as const, message: setFailureMessage(failure, kind) };
  };
  // The set was deleted while this tick held the claim: keep the record of
  // what it cost, and say so the way a missing set is said.
  const deletedMeanwhile = async (costUsd: number) => {
    await admin.from("location_sets").update({ cost_usd: costUsd }).eq("id", setId);
    return { error: SET_NOT_FOUND };
  };
  const finishReady = async (spec: SetSpec, costUsd: number, holdsClaim: boolean): Promise<PollResult> => {
    let write = admin
      .from("location_sets")
      .update({
        status: "ready",
        spec,
        title: spec.title,
        description: spec.description,
        response_id: null,
        failure: null,
        cost_usd: costUsd,
        updated_at: new Date().toISOString(),
      })
      .eq("id", setId)
      .eq("status", "building");
    write = holdsClaim ? write.eq("response_id", "claiming") : write.is("deleted_at", null);
    const { data: saved, error: saveError } = await write.select("id");
    if (saveError) {
      console.error("pollSetBuild save failed:", saveError.message);
      return closeFailed("save", costUsd);
    }
    if (!saved?.length) return holdsClaim ? deletedMeanwhile(costUsd) : { error: null, state: "building" };
    return { error: null, state: "ready" };
  };

  // No answer to collect: another tick holds the claim, or the submit never
  // recorded its id. Either finishes, or goes stale — and a stale build with
  // a draft delivers the draft rather than failing.
  if (!responseId || responseId === "claiming") {
    if (stale) return draft ? finishReady(draft, priorCost, false) : closeFailed("lost", priorCost);
    return { error: null, state: "building" };
  }

  const polled = await pollAstraJob(responseId);
  if (polled.state === "working") {
    if (stale) {
      await cancelAstraJob(responseId);
      return draft ? finishReady(draft, priorCost, false) : closeFailed("lost", priorCost);
    }
    return { error: null, state: "building" };
  }

  const { data: claimed } = await admin
    .from("location_sets")
    .update({ response_id: "claiming", updated_at: new Date().toISOString() })
    .eq("id", setId)
    .eq("status", "building")
    .eq("response_id", responseId)
    .is("deleted_at", null)
    .select("id");
  if (!claimed?.length) return { error: null, state: "building" };

  const cost = Math.round((priorCost + polled.costUsd) * 10_000) / 10_000;
  let failure: string;

  // What a photo costs Astra was measured on three test builds (set-config.ts);
  // every photo attempt's usage is still logged, and one past its budget is
  // flagged, so live builds keep checking the bound.
  if (kind === "photo") {
    console.info("[sets] photo usage", { setId, attempt: attempts, usage: polled.usage });
    const bound = attempts <= 1 ? SET_PHOTO_BUILD_INPUT_TOKENS : SET_PHOTO_CLOSE_RETRY_INPUT_TOKENS;
    const inputTokens = polled.usage?.input_tokens ?? 0;
    if (typeof inputTokens === "number" && inputTokens > bound) {
      console.warn("[sets] photo input past its budget", { setId, attempt: attempts, inputTokens, bound });
    }
  }

  if (polled.state === "done") {
    const parsed = parseSetSpecText(polled.text);
    // A photo set without Astra's own first camera has nothing to lay
    // beside the photo: the normaliser's stand-in camera makes it invalid.
    if (parsed.ok && !(kind === "photo" && parsed.notes.includes("default_camera"))) {
      const spec = parsed.spec;
      const words = specTextForGate(spec);
      // Astra's words, judged before anyone reads them — in the strict lane,
      // the lane every shot of this set will render them in. Logged under
      // the provider, so the person's next hour is not judged harder for
      // text they did not write.
      try {
        await assertPromptAllowed({ prompt: words, hasRealPersonReference: true });
      } catch (err) {
        if (!(err instanceof ContentPolicyRefusal)) throw err;
        await recordPolicyRefusal({
          userId,
          gate: "prompt",
          reason: err.reason,
          strictLane: true,
          prompt: words,
          provider: "astra",
        });
        if (err.reason === "unavailable") {
          // Not a reading: hand the answer back to the next tick, which
          // tries the check again while background mode still holds it.
          await admin
            .from("location_sets")
            .update({ response_id: responseId })
            .eq("id", setId)
            .eq("response_id", "claiming");
          return { error: null, state: "building" };
        }
        return draft ? finishReady(draft, cost, true) : closeFailed("refused", cost);
      }

      const closure = await closureOf(spec);
      const draftOpen = draft ? (await closureOf(draft)).open : null;
      console.info("[sets] closure", { setId, attempt: attempts, open: closure.open, sides: closure.sides, draftOpen });
      const next = decideAfterValidAnswer({
        open: closure.open,
        attempts,
        maxAttempts: SET_BUILD_MAX_ATTEMPTS,
        stale,
        draftOpen,
      });
      if (next.kind === "retry-close") {
        const request = await retryRequest({ why: "close", openSides: closure.sides, previous: spec });
        // Nothing may be resent: the set in hand is still a good set.
        if (!request) return finishReady(spec, cost, true);
        const retry = await submitAstraJob(request);
        if (retry.ok) {
          const { data: resumed, error: resumeError } = await admin
            .from("location_sets")
            .update({
              spec,
              title: spec.title,
              description: spec.description,
              response_id: retry.responseId,
              attempts: attempts + 1,
              cost_usd: cost,
              updated_at: new Date().toISOString(),
            })
            .eq("id", setId)
            .eq("response_id", "claiming")
            .select("id");
          if (resumeError || !resumed?.length) {
            // Nobody could ever collect this job: stop it before it bills.
            await cancelAstraJob(retry.responseId);
            if (!resumeError) return deletedMeanwhile(cost);
            // A write that failed is not a deletion: the set in hand is
            // still a good set, so deliver it.
            console.error("pollSetBuild closing-retry write failed:", resumeError.message);
            return finishReady(spec, cost, true);
          }
          return { error: null, state: "building" };
        }
        // The closing retry could not start. The set in hand is still a
        // good set; deliver it.
        if (retry.kind === "refused") await logClosingRetryRefused(userId, ownWords);
        return finishReady(spec, cost, true);
      }
      return finishReady(next.use === "draft" && draft ? draft : spec, cost, true);
    }
    failure = "invalid";
  } else {
    failure = polled.kind;
    if (polled.kind === "refused") {
      // With a draft in hand this answer was a closing retry: its input was
      // mostly the model's own set, not the person's words.
      if (draft) await logClosingRetryRefused(userId, ownWords);
      else await logBriefRefusedByAstra(userId, ownWords);
    }
  }

  // A closing retry that came back unusable leaves the draft, which is not.
  if (draft) return finishReady(draft, cost, true);

  // One automatic retry at our cost, never after a safety stop — and never
  // without something to send (retryRequest).
  const request =
    failure !== "refused" && failure !== "cancelled" && attempts < SET_BUILD_MAX_ATTEMPTS && !stale
      ? await retryRequest({ why: "again", tooLong: failure === "incomplete" })
      : null;
  if (request) {
    const retry = await submitAstraJob(request);
    if (retry.ok) {
      const { data: resumed, error: resumeError } = await admin
        .from("location_sets")
        .update({ response_id: retry.responseId, attempts: attempts + 1, cost_usd: cost, updated_at: new Date().toISOString() })
        .eq("id", setId)
        .eq("response_id", "claiming")
        .select("id");
      if (resumeError || !resumed?.length) {
        // Nobody could ever collect this job: stop it before it bills.
        await cancelAstraJob(retry.responseId);
        if (resumeError) {
          console.error("pollSetBuild retry write failed:", resumeError.message);
          return closeFailed("save", cost);
        }
        return deletedMeanwhile(cost);
      }
      return { error: null, state: "building" };
    }
    if (retry.kind === "refused") {
      failure = "refused";
      await logBriefRefusedByAstra(userId, ownWords);
    }
  }
  return closeFailed(failure, cost);
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
  | { error: null; generationId: string; succeeded: boolean; resultUrl: string | null; score: number | null };

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
    .select("id, reference_image_urls, outfit_image_urls")
    .eq("id", characterId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!character || !Array.isArray(character.reference_image_urls) || character.reference_image_urls.length === 0) {
    return { error: SET_PICK_CHARACTER };
  }

  // The look: an earlier still the browser names by id. It must be a shot of
  // THIS set, the person's own, finished and not deleted; its picture is
  // re-signed here, never passed on as sent. Anything else and the still is
  // shot without a look, as before — a stale id (a take deleted in another
  // tab) is no reason to refuse the shot.
  let look: { url: string; sameCharacter: boolean; savedOutfit: boolean } | null = null;
  const lookId = typeof input.lookGenerationId === "string" ? input.lookGenerationId : "";
  if (UUID_RE.test(lookId)) {
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
        .select("status, result_url, character_profile_id, deleted_at")
        .eq("id", lookId)
        .eq("user_id", userId)
        .maybeSingle();
      const lookPath =
        lookTake && lookTake.status === "succeeded" && !lookTake.deleted_at
          ? lookStoragePath(lookTake.result_url, userId)
          : null;
      if (lookPath) {
        look = {
          url: mediaUrl("generated-images", lookPath),
          sameCharacter: lookTake?.character_profile_id === characterId,
          // The saved outfit rides this shot too (runGeneration's rule), and
          // then it — not the earlier still — decides the clothes.
          savedOutfit: hasSavedOutfit(character.outfit_image_urls, userId),
        };
      }
    }
  }

  if (await rateLimited(userId, "set-shot", 60 * 10, 12)) return { error: SET_SHOOT_TOO_FAST };

  const admin = createAdminClient();
  const framePath = setFramePath(userId, crypto.randomUUID());
  const { error: uploadError } = await admin.storage
    .from("chat-attachments")
    .upload(framePath, bytes, { contentType: "image/jpeg", upsert: false });
  if (uploadError) {
    console.error("shootInSet frame upload failed:", uploadError.message);
    return { error: SET_FRAME_SAVE_FAILED };
  }

  const direction = cleanText(input.direction, SET_DIRECTION_MAX_CHARS);
  // The arrangement the frame was taken from, normalised against the set: it
  // is saved below, and the prompt reads it to say which way the figure faces
  // as the camera sees it. A crafted layout changes that one clause, still
  // gated.
  const layout = normaliseSetLayout(input.layout, owned.spec);
  const fd = new FormData();
  // `lifted` only chooses whether the prompt explains a brightened sketch;
  // a false value from a crafted request changes one sentence, still gated.
  fd.set(
    "prompt",
    buildSetShotPrompt({ description: owned.spec.description, direction, lifted: input.lifted === true, layout, look }),
  );
  fd.set("content_type", "image");
  fd.set("character_id", characterId);
  // The prompt is already the one the image model should read: the drafter
  // would rewrite the composition instructions it exists to carry. Still
  // gated, in the strict lane, inside runGeneration.
  fd.set("prompt_is_final", "1");
  // The sketch rides as the one neutral reference; the look, when there is
  // one, as a "look" photo (pipeline.ts says what it is, so it is never
  // taken for the person). The look is the person's existing picture in
  // generated-images: it is not a chat attachment, so deleting this take
  // never deletes it.
  fd.set(
    "attachment_roles",
    JSON.stringify([
      { url: mediaUrl("chat-attachments", framePath), role: "reference" },
      ...(look ? [{ url: look.url, role: "look" }] : []),
    ]),
  );

  const result = await runGeneration(fd);
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
  };
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
    return { error: null };
  }
  return { error: SET_DELETE_FAILED };
}
