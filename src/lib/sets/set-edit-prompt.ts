// The Astra request for a Set edit (the Set Editor, 2026-09-14). Pure and
// relative-import only, so the test can hold every edit request to the right
// input and the right caps — the server action only sends it.
//
// An edit is a build with the answer's shape already known: the SAME strict
// schema as the first build, the SAME caps (an edit writes a whole revised
// set, exactly as a build does), its own instructions. The model is handed
// the CURRENT working spec as data and one change request, and must return
// the FULL revised JSON — never a diff, never prose — so the answer goes
// through parseSetSpecText and normaliseSetSpec like every other spec.

import type { AstraJobRequest } from "../generations/providers/astra";
import { SET_SPEC_JSON_SCHEMA, SET_SPEC_SCHEMA_NAME } from "./set-builder-prompt";
import { SET_BUILD_EFFORT, SET_BUILD_MAX_OUTPUT_TOKENS } from "./set-config";
import type { SetSpec } from "./set-spec";

export const SET_EDITOR_INSTRUCTIONS = `You edit film sets for a pre-visualisation tool. You are given ONE existing location as JSON and ONE change request. Apply exactly the change asked and return the FULL revised location as JSON matching the schema.

Rules:
- Change only what the request asks for. Everything else — objects, lights, marks, cameras, sky, ground, fog, bounds, title, description — comes back exactly as given.
- Keep the given units: metres for sizes and positions, degrees for rotations and facing.
- New things rest on the ground (position y = half their height) unless the request says otherwise, and stay inside the set's bounds.
- When the request names something loosely ("the barriers", "the red car"), pick the objects that best match it by shape, colour, size and position.
- A change of light or time of day adjusts the lights and the sky together, so the set still reads clearly.
- Update the description only if the change makes it wrong; otherwise return it unchanged.
- If nothing in the set answers the request, return the set unchanged.`;

/** The one user message: the working spec as data, then the request. */
export function setEditInput(current: SetSpec, request: string): string {
  return `The current set:\n${JSON.stringify(current)}\n\nThe change request:\n${request}`;
}

export function setEditRequest(current: SetSpec, request: string, safetyIdentifier: string | undefined): AstraJobRequest {
  return {
    instructions: SET_EDITOR_INSTRUCTIONS,
    input: setEditInput(current, request),
    schemaName: SET_SPEC_SCHEMA_NAME,
    schema: SET_SPEC_JSON_SCHEMA as unknown as Record<string, unknown>,
    maxOutputTokens: SET_BUILD_MAX_OUTPUT_TOKENS,
    effort: SET_BUILD_EFFORT,
    safetyIdentifier,
  };
}
