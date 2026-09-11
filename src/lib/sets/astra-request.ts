// The Astra request for a Set build, of either kind (2026-09-11). Pure and
// relative-import only, so the test can hold both kinds to the one prefix —
// and hold every request the build sends, first attempt and retry, to the
// right input and the right caps (the server action only picks which).
//
// Both kinds send the SAME instructions and schema — the request's cacheable
// prefix (set-builder-prompt.ts) — so a photo build reads from the cache a
// text build wrote, and the other way round. What differs is the input (a
// brief, or the photo rules and the photo) and the caps: a photo build writes
// more (up to 12,834 output tokens measured, past the text cap of 10,000),
// so it has its own cap and effort knob (set-config.ts shows the arithmetic).

import type { AstraInput, AstraJobRequest } from "../generations/providers/astra";
import { closeRetryFeedback, closeRetryInput, RETRY_SMALLER, RETRY_SMALLER_PHOTO } from "./build-retry";
import {
  SET_BUILDER_INSTRUCTIONS,
  SET_SPEC_JSON_SCHEMA,
  SET_SPEC_SCHEMA_NAME,
  photoBuildInput,
  setBuildInput,
} from "./set-builder-prompt";
import {
  SET_BUILD_EFFORT,
  SET_BUILD_MAX_OUTPUT_TOKENS,
  SET_PHOTO_BUILD_EFFORT,
  SET_PHOTO_BUILD_MAX_OUTPUT_TOKENS,
  SET_RESERVED_BRIEF,
} from "./set-config";
import type { SetSpec } from "./set-spec";
import type { SetKind } from "./types";

export function setAstraRequest(input: AstraInput, safetyIdentifier: string | undefined, kind: SetKind): AstraJobRequest {
  const photo = kind === "photo";
  return {
    instructions: SET_BUILDER_INSTRUCTIONS,
    input,
    schemaName: SET_SPEC_SCHEMA_NAME,
    schema: SET_SPEC_JSON_SCHEMA as unknown as Record<string, unknown>,
    maxOutputTokens: photo ? SET_PHOTO_BUILD_MAX_OUTPUT_TOKENS : SET_BUILD_MAX_OUTPUT_TOKENS,
    effort: photo ? SET_PHOTO_BUILD_EFFORT : SET_BUILD_EFFORT,
    safetyIdentifier,
  };
}

/**
 * A photo build's first attempt: the photo whose bytes passed the picture
 * check (inline, never a link), the notes, and the PHOTO caps — the one
 * research probe wrote 12,834 output tokens, and the test builds up to 12,455,
 * past the text cap.
 */
export function photoBuildRequest(photoDataUrl: string, notes: string, safetyIdentifier: string | undefined): AstraJobRequest {
  return setAstraRequest(photoBuildInput(photoDataUrl, notes), safetyIdentifier, "photo");
}

/** Why the one automatic retry is spent (build-retry.ts). */
export type SetRetry =
  | { why: "close"; openSides: string[]; previous: SetSpec }
  | { why: "again"; tooLong: boolean };

/**
 * What a build is retried from. A text build: its brief column. A photo
 * build: the photographer's notes ("" when none) and the stored photo as a
 * data URL — null when it may not be resent (photo.ts photoForRetry: the
 * photo switch is off, or the stored bytes no longer hash to what passed
 * the check, or cannot be read).
 */
export type SetRetrySource = { kind: "text"; brief: string } | { kind: "photo"; notes: string; photo: string | null };

/**
 * The one automatic retry's request, for either kind, or null: nothing may
 * be sent, and the set in hand — or the failure — stands.
 *
 *   text:  the brief again (never the reserved placeholder), then the
 *          feedback, at the text caps — byte for byte what it was before
 *          photos existed.
 *   photo: the STORED photo again, then the notes, then the feedback, at the
 *          photo caps. Without a photo there is no retry: the notes alone
 *          are never sent as if they were a brief.
 */
export function retryBuildRequest(
  source: SetRetrySource,
  retry: SetRetry,
  safetyIdentifier: string | undefined,
): AstraJobRequest | null {
  if (source.kind === "text") {
    if (source.brief === SET_RESERVED_BRIEF) return null;
    const input =
      retry.why === "close"
        ? closeRetryInput(source.brief, retry.openSides, retry.previous)
        : setBuildInput(source.brief) + (retry.tooLong ? RETRY_SMALLER : "");
    return setAstraRequest(input, safetyIdentifier, "text");
  }
  if (!source.photo) return null;
  const tail =
    retry.why === "close"
      ? closeRetryFeedback(retry.openSides, retry.previous)
      : retry.tooLong
        ? RETRY_SMALLER_PHOTO
        : "";
  return setAstraRequest(photoBuildInput(source.photo, source.notes, tail), safetyIdentifier, "photo");
}
