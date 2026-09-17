"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";
import { assertPromptAllowed, ContentPolicyRefusal, type Scores } from "@/lib/generations/content-policy";
import { assertOutputAllowed, OutputPolicyRefusal } from "@/lib/generations/output-policy";
import { gatePrompt, recentRefusalCount, recordPolicyRefusal } from "@/lib/generations/policy-log";
import { cancelAstraJob, submitAstraJob } from "@/lib/generations/providers/astra";
import { openAiSafetyId } from "@/lib/openai/safety-id";
import { setsAccess } from "@/lib/sets/access";
import { logBriefRefusedByAstra } from "@/lib/sets/build-tick";
import { countSetBuildsThisMonth } from "@/lib/sets/data";
import { isRecceEnabled } from "@/lib/sets/enabled";
import {
  SET_BUILD_COULDNT_START,
  SET_BUILD_TOO_FAST,
  SET_CLIP_LENGTH,
  SET_CLIP_TOO_LARGE,
  SET_CLIP_UNREADABLE,
  SET_PHOTO_REFUSED,
  SET_PHOTO_SAVE_FAILED,
  SET_PHOTO_UNCHECKED,
  SET_RECCE_COULDNT_READ,
  SET_RECCE_NEEDS_DATABASE,
  SET_RECCE_REFUSED,
  SETS_NOT_OPEN,
  SETS_UNAVAILABLE,
  setMonthlyCapMessage,
} from "@/lib/sets/messages";
import { SET_PHOTO_NOTES_MAX_CHARS, SET_RESERVED_BRIEF, setPhotoPath } from "@/lib/sets/set-config";
import { cleanText } from "@/lib/sets/set-spec";
import { setAstraRequest } from "@/lib/sets/astra-request";
import { photoBuildInput } from "@/lib/sets/set-builder-prompt";
import { isMissingColumn, normaliseSetPhoto, parseSetPhotoDataUri, photoDataUrl, photoSourceColumns, removeSetPhoto } from "@/lib/sets/photo";
import {
  askRecceRead,
  parseRecceRead,
  RECCE_FRAME_COUNT,
  RECCE_FRAMES_MIN,
  recceReadInstructions,
  recceTail,
  sampleTimes,
  SET_CLIP_MAX_SECONDS,
  SET_CLIP_MIN_SECONDS,
} from "@/lib/sets/recce-read";
import { recceColumns } from "@/lib/sets/recce-store";

// The Recce, cut 1 (board K, 2026-09-17): a clip becomes a set. The clip
// itself never arrives — the browser sampled its frames (recce-client.ts)
// and this action holds the photo build's own order around them:
//
//   parse the frames → burst brake → RE-ENCODE every frame (sharp; raw
//   client bytes are never passed on) → the READ (the words reader, a
//   reading in the picture check's own class — fields, or nothing) → gate
//   the read's tail AS MODEL TEXT (provider "astra", the editor-edit rule)
//   → the read picks the place frame → reserve the slot (a database
//   without the recce column stops here, before anything is spent) → gate
//   the notes → gate the PICTURE (the place frame, strict lane, exactly a
//   photo build's photo) → store it as the set's photograph → send the
//   photo build with the tail appended, the way a retry's feedback rides.
//
// FROM THE RESERVE ON, A RECCE IS A PHOTO BUILD: it writes the photo
// columns, so the retry, the finisher, the source photograph riding every
// shot, Match and the delete all treat it as one, unchanged. The retry
// resends photo and notes without the tail — the marks it may lose ride
// the previous spec the close retry already carries.
//
// THE PERSON IN THE CLIP is never described to Astra (recce-read.ts holds
// that line), and the read's fields are stored for cut 2 in the column
// only recce-store.ts names.

const RESERVED = SET_RESERVED_BRIEF;

/**
 * Reserve, then count — a private mirror of actions.ts's reserveBuildRow
 * (not importable: exporting it would make it a callable action). The two
 * must move together; recce-actions.test.ts pins the shared lines.
 */
async function reserveRecceRow(
  access: { userId: string; periodStart: string | null; monthlyLimit: number },
  admin: ReturnType<typeof createAdminClient>,
  extra: Record<string, unknown>,
): Promise<{ ok: false; error: string; missingColumn: boolean } | { ok: true; setId: string; release: () => Promise<void> }> {
  const { data: row, error: insertError } = await admin
    .from("location_sets")
    .insert({ ...extra, user_id: access.userId, brief: RESERVED, status: "building", attempts: 0 })
    .select("id, created_at")
    .single();
  if (insertError || !row) {
    console.error("submitSetRecceBuild reserve failed:", insertError?.message);
    return { ok: false, error: SET_BUILD_COULDNT_START, missingColumn: isMissingColumn(insertError) };
  }
  const setId = row.id as string;
  const release = async () => {
    await admin.from("location_sets").delete().eq("id", setId);
  };
  if (access.monthlyLimit >= 0) {
    const upToMine = await countSetBuildsThisMonth(access.userId, access.periodStart, row.created_at as string);
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

/** Every frame's sharp pass: upright, metadata gone, bounded — never the browser's bytes. */
async function reencodeFrames(frames: Buffer[]): Promise<Buffer[] | null> {
  let sharp: (typeof import("sharp"))["default"];
  try {
    ({ default: sharp } = await import("sharp"));
  } catch {
    console.error("[sets] sharp unavailable; recce builds refused");
    return null;
  }
  try {
    return await Promise.all(
      frames.map((bytes) =>
        sharp(bytes, { limitInputPixels: 25_000_000, failOn: "error" }).rotate().jpeg({ quality: 82 }).toBuffer(),
      ),
    );
  } catch {
    return null;
  }
}

/**
 * A set from a clip. Admins only, behind astra_recce (with both flags under
 * it). The page this runs under declares the 300 s budget the photo build
 * already needs (app/app/sets/page.tsx); the read adds ~5–15 s to it.
 */
export async function submitSetRecceBuild(input: {
  /** The sampled JPEG data URIs joined by newlines: one string on the wire, like a photo build's photo — the action codec refuses a large array. */
  frames: string;
  seconds: number;
  notes: string;
}): Promise<{ error: string } | { error: null; id: string }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const { userId } = access;
  // Checked here on its own, like photo sets: widening either never widens recces.
  if (!access.isAdmin) return { error: SETS_NOT_OPEN };
  if (!(await isRecceEnabled(access.supabase))) return { error: SETS_UNAVAILABLE };

  const seconds = typeof input?.seconds === "number" && Number.isFinite(input.seconds) ? Math.round(input.seconds * 10) / 10 : NaN;
  if (!(seconds >= SET_CLIP_MIN_SECONDS && seconds <= SET_CLIP_MAX_SECONDS)) return { error: SET_CLIP_LENGTH };

  const rawFrames = typeof input?.frames === "string" ? input.frames.split("\n").filter((f) => f.length > 0) : [];
  if (rawFrames.length < RECCE_FRAMES_MIN || rawFrames.length > RECCE_FRAME_COUNT) return { error: SET_CLIP_UNREADABLE };
  const frameBytes: Buffer[] = [];
  let total = 0;
  for (const f of rawFrames) {
    const parsed = parseSetPhotoDataUri(f);
    if (!parsed.ok) return { error: SET_CLIP_UNREADABLE };
    total += parsed.bytes.byteLength;
    if (total > 3_400_000) return { error: SET_CLIP_TOO_LARGE };
    frameBytes.push(parsed.bytes);
  }

  let notes = cleanText(typeof input?.notes === "string" ? input.notes : "", SET_PHOTO_NOTES_MAX_CHARS);
  if (notes === RESERVED) notes = "";

  // The same burst brake and, below, the same monthly slot as any build.
  if (await rateLimited(userId, "set-build", 60 * 60, access.isAdmin ? 12 : 4)) {
    return { error: SET_BUILD_TOO_FAST };
  }

  const reencoded = await reencodeFrames(frameBytes);
  if (reencoded === null) return { error: SET_BUILD_COULDNT_START };

  // The reading: fields or nothing. The times are recomputed here — what is
  // trusted from the browser is pictures and a length.
  const times = sampleTimes(seconds, reencoded.length);
  const answer = await askRecceRead(
    recceReadInstructions(times, seconds),
    reencoded.map((b) => photoDataUrl(b)),
    times,
  );
  const read = answer === null ? null : parseRecceRead(answer, reencoded.length, seconds);
  if (read === null) return { error: SET_RECCE_COULDNT_READ };

  // The tail is the read's words about the person's footage — model text,
  // judged before anything is sent and logged under the provider when
  // refused, exactly as an editor edit's answer is (editor-actions.ts).
  const tail = recceTail(read, seconds);
  try {
    await assertPromptAllowed({ prompt: tail, hasRealPersonReference: true });
  } catch (err) {
    if (!(err instanceof ContentPolicyRefusal)) throw err;
    await recordPolicyRefusal({ userId, gate: "prompt", reason: err.reason, strictLane: true, prompt: tail, provider: "astra" });
    return { error: SET_RECCE_REFUSED };
  }

  // The read picks the frame the build stands on; photoFit judges it as it
  // judges any photograph (its refusals are the photo sentences).
  const photo = await normaliseSetPhoto(frameBytes[read.placeFrame]);
  if (!photo.ok) return { error: photo.error };

  const admin = createAdminClient();
  const setId = crypto.randomUUID();
  const reserved = await reserveRecceRow(access, admin, {
    id: setId,
    ...photoSourceColumns(userId, setId, photo.sha256),
    ...recceColumns(read, seconds, times),
  });
  if (!reserved.ok) return { error: reserved.missingColumn ? SET_RECCE_NEEDS_DATABASE : reserved.error };
  const { release } = reserved;

  // The notes sit beside real footage of a real place: the photo build's lane.
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

  // The picture itself — the one frame that goes to Astra — judged from its
  // bytes before it is stored or sent, the strict lane, as for a photo.
  const dataUrl = photoDataUrl(photo.jpeg);
  try {
    await assertOutputAllowed({ imageUrl: dataUrl, strictLane: true, promptScores: scores ?? null, sessionPriorHits: priorHits });
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
      return { error: err.reason === "unavailable" ? SET_PHOTO_UNCHECKED : SET_RECCE_REFUSED };
    }
    throw err;
  }

  // Still there after the checks (a delete in the meantime wins), and the
  // notes written — checked, because a retry reads them back.
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

  const { error: uploadError } = await admin.storage
    .from("generated-images")
    .upload(setPhotoPath(userId, setId), photo.jpeg, { contentType: "image/jpeg", upsert: false });
  if (uploadError) {
    console.error("submitSetRecceBuild photo upload failed:", uploadError.message);
    await removeSetPhoto(admin, userId, setId);
    await release();
    return { error: SET_PHOTO_SAVE_FAILED };
  }

  // The photo build with the tail appended — the same input shape a photo
  // retry already sends, at the photo caps.
  const submitted = await submitAstraJob(setAstraRequest(photoBuildInput(dataUrl, notes, tail), openAiSafetyId(userId), "photo"));
  if (!submitted.ok) {
    console.error("submitSetRecceBuild astra submit failed:", submitted.kind, submitted.detail);
    await admin
      .from("location_sets")
      .update({ status: "failed", failure: submitted.kind === "refused" ? "refused" : "start", updated_at: new Date().toISOString() })
      .eq("id", setId);
    await removeSetPhoto(admin, userId, setId);
    if (submitted.kind === "refused") {
      await logBriefRefusedByAstra(userId, notes || null);
      return { error: SET_PHOTO_REFUSED };
    }
    return { error: SET_BUILD_COULDNT_START };
  }
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
