// The Astra request for a Set build, of either kind (2026-09-11). Pure and
// relative-import only, so the test can hold both kinds to the one prefix.
//
// Both kinds send the SAME instructions and schema — the request's cacheable
// prefix (set-builder-prompt.ts) — so a photo build reads from the cache a
// text build wrote, and the other way round. What differs is the input (a
// brief, or the photo rules and the photo) and the caps: a photo build writes
// more (one measured at 12,834 output tokens, past the text cap of 10,000),
// so it has its own cap and effort knob (set-config.ts shows the arithmetic).

import type { AstraInput, AstraJobRequest } from "../generations/providers/astra";
import { SET_BUILDER_INSTRUCTIONS, SET_SPEC_JSON_SCHEMA, SET_SPEC_SCHEMA_NAME } from "./set-builder-prompt";
import {
  SET_BUILD_EFFORT,
  SET_BUILD_MAX_OUTPUT_TOKENS,
  SET_PHOTO_BUILD_EFFORT,
  SET_PHOTO_BUILD_MAX_OUTPUT_TOKENS,
} from "./set-config";
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
