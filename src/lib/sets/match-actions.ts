"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";
import { assertOutputAllowed, OutputPolicyRefusal } from "@/lib/generations/output-policy";
import { recentRefusalCount, recordPolicyRefusal } from "@/lib/generations/policy-log";
import { cancelAstraJob, pollAstraJob, submitAstraJob, type AstraPollResult } from "@/lib/generations/providers/astra";
import { openAiSafetyId } from "@/lib/openai/safety-id";
import { setsAccess, UUID_RE } from "@/lib/sets/access";
import { isPhotoSetsEnabled } from "@/lib/sets/enabled";
import { matchShotRequest, parseMatchShotText, pollUntilDeadline, type ShotMatch } from "@/lib/sets/match-shot";
import { normaliseSetPhoto, parseSetPhotoDataUri, photoDataUrl } from "@/lib/sets/photo";
import {
  SET_MATCH_DEADLINE_MS,
  SET_MATCH_INPUT_TOKENS,
  SET_MATCH_MIN_READ_MS,
  SET_MATCH_PER_HOUR,
  SET_MATCH_POLL_MS,
} from "@/lib/sets/set-config";
import { normaliseSetSpec } from "@/lib/sets/set-spec";
import {
  SETS_NOT_OPEN,
  SETS_UNAVAILABLE,
  SET_BUILD_COULDNT_START,
  SET_MATCH_COULDNT_READ,
  SET_MATCH_REFUSED,
  SET_MATCH_TIMED_OUT,
  SET_MATCH_TOO_FAST,
  SET_MATCH_UNCHECKED,
  SET_NOT_FOUND,
  SET_NOT_READY,
  matchFailureMessage,
} from "@/lib/sets/messages";

// Match this shot (docs 3.2, 2026-09-11; admins only, behind astra_photo_sets).
// Its own "use server" file: every export here is a client-callable action,
// and there is exactly one.
//
// The person picks a reference still; this reads its CAMERA and hands back
// numbers (match-shot.ts ShotMatch), which the page turns into a stage
// camera. NOTHING IS STORED: no row is written and nothing is uploaded — the
// picture's bytes live only in this request, go to the picture check's
// readers and to Astra (inline, store: false), and are never logged. A shot
// taken afterwards is an ordinary shot: the stage frame and, optionally, the
// look; never the reference.
//
// The order is the point:
//   access (admin, both switches) → the set is the person's own and ready →
//   read and re-encode the picture (no EXIF) → the burst brake → the picture
//   check, exactly as a photo build's (a refusal: nothing sent to Astra) →
//   one Astra call, waited for here → the numbers, parsed and bounded.
//
// The wait happens inside this action, under the set page's 300 s budget
// (app/app/sets/[id]/page.tsx): the clock starts with the action, so a slow
// picture check leaves less time for Astra, and a read still running at the
// deadline is cancelled (set-config.ts has the timing and the money).
//
// What a failure SAYS depends on whose it was (matchFailureMessage): only an
// answer that came back unusable asks for another picture; a start or poll
// failure — ours or OpenAI's — says try again, so nobody spends their next
// turns swapping pictures an outage had nothing to do with.

/** The same checks readyOwnedSpec makes in actions.ts: the person's own set, not deleted, ready, drawable. */
async function readyOwnedSet(setId: string, userId: string): Promise<string | null> {
  if (typeof setId !== "string" || !UUID_RE.test(setId)) return SET_NOT_FOUND;
  const { data: row } = await createAdminClient()
    .from("location_sets")
    .select("status, spec")
    .eq("id", setId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!row) return SET_NOT_FOUND;
  if (row.status !== "ready") return SET_NOT_READY;
  if (!normaliseSetSpec(row.spec).ok) return SET_NOT_FOUND;
  return null;
}

/**
 * OpenAI refused to read the picture: the person's own input, as with a
 * refused photo build — logged against them, counted as session context,
 * with no text (there is none).
 */
async function logReadRefused(userId: string) {
  await recordPolicyRefusal({ userId, gate: "prompt", reason: "astra_refused", prompt: null });
}

/** What a read that came back cost, and a flag on one past its input budget. Never the picture or the numbers. */
function logUsage(setId: string, polled: Exclude<AstraPollResult, { state: "working" }>) {
  console.info("[sets] match usage", { setId, usage: polled.usage, costUsd: polled.costUsd });
  const inputTokens = polled.usage?.input_tokens ?? 0;
  if (typeof inputTokens === "number" && inputTokens > SET_MATCH_INPUT_TOKENS) {
    console.warn("[sets] match input past its budget", { setId, inputTokens, bound: SET_MATCH_INPUT_TOKENS });
  }
}

export async function matchSetShot(
  setId: string,
  input: { photoDataUri: string },
): Promise<{ error: string } | { error: null; match: ShotMatch }> {
  const startedAt = Date.now();
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const { userId } = access;
  // Checked here on its own, like a photo build: widening text sets to
  // plans must never widen this with them.
  if (!access.isAdmin) return { error: SETS_NOT_OPEN };
  if (!(await isPhotoSetsEnabled(access.supabase))) return { error: SETS_UNAVAILABLE };

  const notOwned = await readyOwnedSet(setId, userId);
  if (notOwned) return { error: notOwned };

  // The same limits as a set's photo, and never the browser's bytes:
  // re-encoded here, whatever arrived.
  const parsed = parseSetPhotoDataUri(input?.photoDataUri);
  if (!parsed.ok) return { error: parsed.error };
  const photo = await normaliseSetPhoto(parsed.bytes);
  // The picture's own problems are the photo sentences; the one failure that
  // is ours (no image library on the server) speaks of a set being started,
  // which a match is not.
  if (!photo.ok) return { error: photo.error === SET_BUILD_COULDNT_START ? SET_MATCH_COULDNT_READ : photo.error };

  // Fails closed like every limiter. A picture that could not be used above
  // never reached anything that costs money, so it takes no turn.
  if (await rateLimited(userId, "set-match", 60 * 60, SET_MATCH_PER_HOUR)) return { error: SET_MATCH_TOO_FAST };

  // The picture check, exactly as a photo build runs it: from the bytes, in
  // the strict lane (a real place can hold real people), before Astra sees
  // anything. A refusal is logged as a picture refusal, which never makes the
  // person's next hour stricter (policy-log.ts counts only the prompt gate).
  const dataUrl = photoDataUrl(photo.jpeg);
  const priorHits = await recentRefusalCount(userId);
  try {
    await assertOutputAllowed({ imageUrl: dataUrl, strictLane: true, promptScores: null, sessionPriorHits: priorHits });
  } catch (err) {
    if (err instanceof OutputPolicyRefusal) {
      await recordPolicyRefusal({
        userId,
        gate: "output",
        reason: err.reason,
        strictLane: true,
        bands: err.readings,
        provider: "set-match",
      });
      return { error: err.reason === "unavailable" ? SET_MATCH_UNCHECKED : SET_MATCH_REFUSED };
    }
    throw err;
  }

  // A check that ran long leaves too little of the budget for a read to come
  // back in: nothing is sent that nobody could collect.
  if (Date.now() - startedAt > SET_MATCH_DEADLINE_MS - SET_MATCH_MIN_READ_MS) return { error: SET_MATCH_TIMED_OUT };

  // The bytes in hand, the same ones the check passed.
  const submitted = await submitAstraJob(matchShotRequest(dataUrl, openAiSafetyId(userId)));
  if (!submitted.ok) {
    console.error("matchSetShot astra submit failed:", submitted.kind, submitted.detail);
    if (submitted.kind === "refused") await logReadRefused(userId);
    return { error: matchFailureMessage(submitted.kind) };
  }

  const polled = await pollUntilDeadline(
    () => pollAstraJob(submitted.responseId),
    (answer) => answer.state === "working",
    {
      now: () => Date.now(),
      pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      deadlineAt: startedAt + SET_MATCH_DEADLINE_MS,
      intervalMs: SET_MATCH_POLL_MS,
    },
  );
  if (!polled || polled.state === "working") {
    // Nobody will collect it now: stop it before it bills any further.
    await cancelAstraJob(submitted.responseId);
    console.warn("[sets] match timed out", { setId, seconds: Math.round((Date.now() - startedAt) / 1000) });
    return { error: SET_MATCH_TIMED_OUT };
  }
  logUsage(setId, polled);
  if (polled.state === "failed") {
    console.error("matchSetShot astra read failed:", polled.kind, polled.detail);
    if (polled.kind === "refused") await logReadRefused(userId);
    return { error: matchFailureMessage(polled.kind) };
  }

  const read = parseMatchShotText(polled.text);
  if (!read.ok) return { error: matchFailureMessage("invalid") };
  return { error: null, match: read.match };
}
