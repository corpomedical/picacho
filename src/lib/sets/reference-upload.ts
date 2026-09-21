// A reference photo's checks before it is stored (2026-09-21), shared by the
// set's reference photos (reference-actions.ts) and the photos on its things
// (element-actions.ts): parsed, then — after the caller's own counts — held
// to an hourly limit, re-encoded here whatever arrived (EXIF and location
// gone), and judged from its bytes by the picture gate in the strict lane,
// the way a photo set's photo is. A refusal is logged as a picture refusal,
// which never makes the person's next hour stricter. Server-only.

import { rateLimited } from "@/lib/rate-limit";
import { assertOutputAllowed, OutputPolicyRefusal } from "@/lib/generations/output-policy";
import { recentRefusalCount, recordPolicyRefusal } from "@/lib/generations/policy-log";
import { normaliseSetPhoto, parseSetPhotoDataUri, photoDataUrl } from "@/lib/sets/photo";
import { SET_REF_REFUSED, SET_REF_TOO_FAST, SET_REF_UNCHECKED } from "@/lib/sets/messages";

/** Uploads an hour: each one is a picture check. */
export const SET_REFS_PER_HOUR = 20;

export function parseReferencePhoto(dataUri: unknown): ReturnType<typeof parseSetPhotoDataUri> {
  return parseSetPhotoDataUri(dataUri);
}

/** The hourly limit, the re-encode and the picture gate, in that order: the JPEG to store, or why not. */
export async function checkReferencePhoto(userId: string, bytes: Buffer): Promise<{ error: string } | { error: null; jpeg: Buffer }> {
  if (await rateLimited(userId, "set-ref", 60 * 60, SET_REFS_PER_HOUR)) return { error: SET_REF_TOO_FAST };
  // Never the browser's bytes: re-encoded here, whatever arrived.
  const photo = await normaliseSetPhoto(bytes);
  if (!photo.ok) return { error: photo.error };
  try {
    await assertOutputAllowed({
      imageUrl: photoDataUrl(photo.jpeg),
      strictLane: true,
      promptScores: null,
      sessionPriorHits: await recentRefusalCount(userId),
    });
  } catch (err) {
    if (err instanceof OutputPolicyRefusal) {
      await recordPolicyRefusal({
        userId,
        gate: "output",
        reason: err.reason,
        strictLane: true,
        bands: err.readings,
        provider: "set-reference",
      });
      return { error: err.reason === "unavailable" ? SET_REF_UNCHECKED : SET_REF_REFUSED };
    }
    throw err;
  }
  return { error: null, jpeg: photo.jpeg };
}
