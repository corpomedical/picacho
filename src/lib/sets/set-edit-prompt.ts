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
import { SET_BRAND_RULE, SET_SPEC_JSON_SCHEMA, SET_SPEC_SCHEMA_NAME } from "./set-builder-prompt";
import { SET_BUILD_EFFORT, SET_BUILD_MAX_OUTPUT_TOKENS } from "./set-config";
import { SET_LIMITS, cleanText, type SetSpec, type Vec3 } from "./set-spec";
import { withMaterials } from "./stage-materials";

// The builder's brand rule rides the edit too (Helios Cut 4, step A8,
// 2026-09-26): the description Astra writes rides every still
// (set-shot-prompt.ts), and until now an edit could write "Ferrari" into
// it. It adds 129 characters to every edit's input: 21,536 → 21,665 at the
// longest, $0.6201875 → $0.6209 at worst (set-config.ts).
export const SET_EDITOR_INSTRUCTIONS = `You edit film sets for a pre-visualisation tool. You are given ONE existing location as JSON and ONE change request. Apply exactly the change asked and return the FULL revised location as JSON matching the schema.

Rules:
- Change only what the request asks for. Everything else — objects, lights, marks, cameras, sky, ground, fog, bounds, title, description — comes back exactly as given.
- Keep the given units: metres for sizes and positions, degrees for rotations and facing.
- New things rest on the ground (position y = half their height) unless the request says otherwise, and stay inside the set's bounds.
- When the request names something loosely ("the barriers", "the red car"), pick the objects that best match it by shape, colour, size and position.
- A change of light or time of day adjusts the lights and the sky together, so the set still reads clearly.
- Every object and the ground carry a material word; keep them, and give anything you add one.
- ${SET_BRAND_RULE}
- Update the description only if the change makes it wrong; otherwise return it unchanged.
- If nothing in the set answers the request, return the set unchanged.`;

// ---------------------------------------------------------------------------
// What the set's chat adds to a change (Helios Cut 2, step 10, 2026-09-25 —
// operator: "Run, keep going."; critic item 12, audit RC6).
//
// A change asked in the set's conversation reaches Astra as the person's
// own words, exactly as before, and may carry two more lines:
// - the MEANING, the chat reader's short English gloss of those words
//   ("a red sports car by the pit wall" for "put a red Ferrari there"). It
//   is the model's, never the person's, so the line says so, and the gate
//   judges it under the reader's name (editor-actions.ts);
// - the FRAME: where the person stands and where the camera is now, so
//   "a lamp behind her" or "flags in the background" has a place to mean.
//   Numbers only, checked against the set, and a person is never added.
// Without either, the request is byte-identical to what it was (a test pins it).
// ---------------------------------------------------------------------------

/** The reader's gloss, at most this many characters (shot-reading.ts READER_MAX.gloss). */
export const SET_EDIT_MEANING_MAX_CHARS = 200;

/** Where the figure stands and where the camera is, as the page sees it when the card is pressed. */
export type EditFrame = {
  mark: { x: number; z: number; facingDeg: number };
  camera: { position: Vec3; target: Vec3 } | null;
};
export type EditMore = { meaning?: string; frame?: EditFrame };

const r2 = (n: number) => Math.round(n * 100) / 100;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const vec3Of = (v: unknown): Vec3 | null => (Array.isArray(v) && v.length === 3 && v.every(finite) ? [r2(v[0]), r2(v[1]), r2(v[2])] : null);

/**
 * A frame the page sent, held to the set: the figure inside the set's
 * footprint (as normaliseSetLayout keeps a mark), the camera where a set's
 * camera may stand — a little outside the footprint, above the ground, no
 * higher than twice the set — and its target within the stage's reach.
 * Every number rounded to 0.01 m. A figure outside, or anything not a
 * number, is no frame at all; a camera that doesn't hold is left out alone.
 */
export function editFrameOf(v: unknown, spec: Pick<SetSpec, "bounds">): EditFrame | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const f = v as Record<string, unknown>;
  const m = f.mark && typeof f.mark === "object" && !Array.isArray(f.mark) ? (f.mark as Record<string, unknown>) : null;
  if (!m || !finite(m.x) || !finite(m.z) || !finite(m.facingDeg)) return null;
  const halfX = spec.bounds.x / 2;
  const halfZ = spec.bounds.z / 2;
  if (Math.abs(m.x) > halfX + 1e-6 || Math.abs(m.z) > halfZ + 1e-6) return null;
  const mark = { x: r2(m.x), z: r2(m.z), facingDeg: r2(((m.facingDeg % 360) + 360) % 360) };
  const c = f.camera && typeof f.camera === "object" && !Array.isArray(f.camera) ? (f.camera as Record<string, unknown>) : null;
  const position = c ? vec3Of(c.position) : null;
  const target = c ? vec3Of(c.target) : null;
  const cameraHolds =
    position !== null &&
    target !== null &&
    Math.abs(position[0]) <= halfX + 10 &&
    Math.abs(position[2]) <= halfZ + 10 &&
    position[1] >= 0 &&
    position[1] <= spec.bounds.height * 2 &&
    target.every((t) => Math.abs(t) <= SET_LIMITS.maxCoordinate) &&
    Math.hypot(target[0] - position[0], target[1] - position[1], target[2] - position[2]) >= 0.1;
  return { mark, camera: cameraHolds && position && target ? { position, target } : null };
}

/** The reader's gloss as it may ride: cleaned, capped, or nothing. */
export function editMeaningOf(v: unknown): string {
  return typeof v === "string" ? cleanText(v, SET_EDIT_MEANING_MAX_CHARS) : "";
}

const xyz = (p: Vec3) => `(${p[0]}, ${p[1]}, ${p[2]})`;

/** The frame, in words Astra reads: metres on the set's own axes, the facing in degrees (0° faces +Z, 90° faces +X). */
export function editFrameLine(frame: EditFrame): string {
  const where = `Where the person stands now (never add a person): x ${frame.mark.x}, z ${frame.mark.z}, facing ${frame.mark.facingDeg}°.`;
  return frame.camera ? `${where} The camera now: ${xyz(frame.camera.position)} → ${xyz(frame.camera.target)}.` : where;
}

/**
 * The one user message: the working spec as data, then the request. A set
 * from before the material words is handed with the words the stage has
 * been drawing it with (withMaterials), so the model keeps them rather than
 * guessing new ones. With `more`, the chat's two extra lines follow the
 * request, the meaning first; without, nothing else changes.
 */
export function setEditInput(current: SetSpec, request: string, more?: EditMore): string {
  // A bare object (prices.test.ts measures the framing with one) goes as it is.
  const sent = Array.isArray(current.objects) && current.ground ? withMaterials(current) : current;
  const base = `The current set:\n${JSON.stringify(sent)}\n\nThe change request:\n${request}`;
  const extra = [
    more?.meaning ? `What they mean, as read by the page (not their words): ${more.meaning}` : "",
    more?.frame ? editFrameLine(more.frame) : "",
  ].filter(Boolean);
  return extra.length > 0 ? `${base}\n\n${extra.join("\n")}` : base;
}

export function setEditRequest(current: SetSpec, request: string, safetyIdentifier: string | undefined, more?: EditMore): AstraJobRequest {
  return {
    instructions: SET_EDITOR_INSTRUCTIONS,
    input: setEditInput(current, request, more),
    schemaName: SET_SPEC_SCHEMA_NAME,
    schema: SET_SPEC_JSON_SCHEMA as unknown as Record<string, unknown>,
    maxOutputTokens: SET_BUILD_MAX_OUTPUT_TOKENS,
    effort: SET_BUILD_EFFORT,
    safetyIdentifier,
  };
}
