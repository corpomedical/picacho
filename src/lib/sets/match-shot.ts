// Match this shot (docs 3.2, 2026-09-11): a reference picture's CAMERA, read
// by one model call, and where the stage camera stands to match it.
//
// Pure and relative-import only: vitest and the eval runner import it as it
// is, and eval part E will send these exact instructions and this schema to
// Astra and to a cheaper model alike — so nothing in them names a provider.
//
// THE ANSWER HAS NO WORDS IN IT. Every field is a number, a boolean or one of
// a fixed list, so an answer structurally cannot carry a description of
// anyone in the picture; the instructions also say never to identify or
// describe a person. Only these numbers leave the server — the picture is
// never stored, never logged and never sent to the image model (a shot
// carries the stage frame and, optionally, the look; match-actions.ts).
//
// Both the instructions and the input line are STABLE BYTES: with the schema
// they are the request's cacheable prefix, and the picture is the only thing
// that differs between matches.

import type * as ThreeNS from "three";
import type { AstraInput, AstraJobRequest } from "../generations/providers/astra";
import { lensForFov } from "./build-scene";
import { SET_MATCH_EFFORT, SET_MATCH_MAX_OUTPUT_TOKENS, SET_MAX_TILT_DOWN_DEG, SET_MAX_TILT_UP_DEG } from "./set-config";
import { SET_LIMITS, type SetSpec, type Vec3 } from "./set-spec";

export const MATCH_SHOT_INSTRUCTIONS = `You read the camera of one picture, a film frame or a photograph, and answer with numbers as JSON matching the schema.

Read only the camera: where it stands, how it is tilted and what lens it has. Never identify, name or describe any person or anyone's appearance. The answer holds numbers and fixed choices only.

Units are metres and degrees.
- camera_height_m: the height of the lens above the floor or ground directly below the camera.
- pitch_deg: the tilt of the optical axis, the line through the centre of the picture. Positive is tilted up, negative tilted down, 0 is level.
- vertical_fov_deg: the field of view across the picture's HEIGHT, from its top edge to its bottom edge, as the picture is given. If the picture is a crop, the field of view of the crop, not of the original frame.
- The subject is the main subject the shot is framed on: a person or an object.
- subject_found: false when there is no clear subject (a landscape, an empty room); then subject_distance_m, subject_x and framing are null.
- subject_distance_m: the horizontal distance along the ground from the lens to the subject.
- subject_x: the subject's horizontal centre in the picture, 0 at the left edge, 1 at the right edge.
- framing: how tightly the shot frames the subject, from extreme_wide (small in a wide view) through full (a person head to toe), medium (from the waist up) and close_up (head and shoulders) to extreme_close_up (a detail).
- confidence: how sure you are of these numbers.

Estimate from what the picture shows:
- The horizon lies at the camera's own height. A level camera puts it through the centre of the frame; tilted down, it sits above the centre; tilted up, below.
- Vertical lines converge downward when the camera tilts down, upward when it tilts up, and stay parallel when it is level.
- Things of known size, and their perspective: a door is about 2 m tall, a table top about 0.75 m from the floor, a standing adult about 1.7 m.
- The lens: a wide lens stretches depth and bends straight lines near the edges; a long lens flattens depth and brings the background close.
Give your best estimate for every number, with a lower confidence when the cues are weak.`;

/** The one line sent with the picture. */
export const MATCH_SHOT_INPUT_TEXT = "Read the camera of this picture.";

export const SHOT_FRAMINGS = [
  "extreme_wide",
  "wide",
  "full",
  "medium_full",
  "medium",
  "medium_close",
  "close_up",
  "extreme_close_up",
] as const;
export type ShotFraming = (typeof SHOT_FRAMINGS)[number];

export const SHOT_CONFIDENCES = ["low", "medium", "high"] as const;
export type ShotConfidence = (typeof SHOT_CONFIDENCES)[number];

export const MATCH_SHOT_SCHEMA_NAME = "picacho_shot_camera";

/**
 * The strict JSON schema for the Responses API's text.format: every property
 * required, no other properties, and no free-text field anywhere — numbers,
 * a boolean and enums. A nullable number is a type pair; the nullable enum
 * follows SET_SPEC_JSON_SCHEMA's anyOf (set-builder-prompt.ts), the form a
 * live strict build has accepted. The field definitions live in the
 * instructions, once; the bounds are enforced by parseMatchShotText.
 */
export const MATCH_SHOT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "subject_found",
    "camera_height_m",
    "pitch_deg",
    "vertical_fov_deg",
    "subject_distance_m",
    "subject_x",
    "framing",
    "confidence",
  ],
  properties: {
    subject_found: { type: "boolean" },
    camera_height_m: { type: "number" },
    pitch_deg: { type: "number" },
    vertical_fov_deg: { type: "number" },
    subject_distance_m: { type: ["number", "null"] },
    subject_x: { type: ["number", "null"] },
    framing: { anyOf: [{ type: "string", enum: [...SHOT_FRAMINGS] }, { type: "null" }] },
    confidence: { type: "string", enum: [...SHOT_CONFIDENCES] },
  },
} as const;

/** One user message: the line, then the picture's bytes (providers/astra.ts sends it inline, at detail high). */
export function matchShotInput(photoDataUrl: string): AstraInput {
  return [
    {
      role: "user",
      content: [
        { type: "input_text", text: MATCH_SHOT_INPUT_TEXT },
        { type: "input_image", image_url: photoDataUrl, detail: "high" },
      ],
    },
  ];
}

/** The whole request, at the match's own effort and cap (set-config.ts shows the arithmetic). */
export function matchShotRequest(photoDataUrl: string, safetyIdentifier: string | undefined): AstraJobRequest {
  return {
    instructions: MATCH_SHOT_INSTRUCTIONS,
    input: matchShotInput(photoDataUrl),
    schemaName: MATCH_SHOT_SCHEMA_NAME,
    schema: MATCH_SHOT_JSON_SCHEMA as unknown as Record<string, unknown>,
    maxOutputTokens: SET_MATCH_MAX_OUTPUT_TOKENS,
    effort: SET_MATCH_EFFORT,
    safetyIdentifier,
  };
}

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

/** A reference picture's camera, inside the bounds below. */
export type ShotMatch = {
  subjectFound: boolean;
  /** Lens height above the floor or ground under the camera, metres. */
  cameraHeightM: number;
  /** Tilt of the optical axis: + up, − down, 0 level. */
  pitchDeg: number;
  /** Across the picture's height, as the picture was sent. */
  verticalFovDeg: number;
  /** Horizontal, along the ground, lens to subject; null without a subject. */
  subjectDistanceM: number | null;
  /** The subject's horizontal centre in the picture, 0 left edge to 1 right edge; null without a subject. */
  subjectX: number | null;
  framing: ShotFraming | null;
  confidence: ShotConfidence;
};

export const MATCH_BOUNDS = {
  heightM: [0.05, 30],
  pitchDeg: [-89, 89],
  verticalFovDeg: [3, 150],
  distanceM: [0.2, 200],
  subjectX: [0, 1],
} as const;

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));

/** A number the answer must carry: finite, or the answer is refused. */
function required(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** A number the answer may leave out (null); anything else that is not a finite number refuses the answer. */
function optional(v: unknown): number | null | undefined {
  if (v === null) return null;
  return required(v);
}

/**
 * The model's text → the camera, or not ok. JSON.parse never throws out of
 * here, a number that is not finite (1e999 parses to Infinity) or of the
 * wrong type refuses the whole answer, every number is held to MATCH_BOUNDS,
 * the subject's fields are null whenever no subject was found, and an
 * unknown framing reads as none, an unknown confidence as low. Tolerates a
 * stray code fence, as parseSetSpecText does.
 */
export function parseMatchShotText(text: string): { ok: true; match: ShotMatch } | { ok: false } {
  const body = (typeof text === "string" ? text : "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return { ok: false };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false };
  const r = raw as Record<string, unknown>;
  if (typeof r.subject_found !== "boolean") return { ok: false };
  const height = required(r.camera_height_m);
  const pitch = required(r.pitch_deg);
  const fov = required(r.vertical_fov_deg);
  if (height === undefined || pitch === undefined || fov === undefined) return { ok: false };

  let subjectDistanceM: number | null = null;
  let subjectX: number | null = null;
  let framing: ShotFraming | null = null;
  if (r.subject_found) {
    const distance = optional(r.subject_distance_m);
    const x = optional(r.subject_x);
    if (distance === undefined || x === undefined) return { ok: false };
    subjectDistanceM = distance === null ? null : clamp(distance, MATCH_BOUNDS.distanceM);
    subjectX = x === null ? null : clamp(x, MATCH_BOUNDS.subjectX);
    framing = (SHOT_FRAMINGS as readonly unknown[]).includes(r.framing) ? (r.framing as ShotFraming) : null;
  }
  const confidence = (SHOT_CONFIDENCES as readonly unknown[]).includes(r.confidence)
    ? (r.confidence as ShotConfidence)
    : "low";

  return {
    ok: true,
    match: {
      subjectFound: r.subject_found,
      cameraHeightM: clamp(height, MATCH_BOUNDS.heightM),
      pitchDeg: clamp(pitch, MATCH_BOUNDS.pitchDeg),
      verticalFovDeg: clamp(fov, MATCH_BOUNDS.verticalFovDeg),
      subjectDistanceM,
      subjectX,
      framing,
      confidence,
    },
  };
}

// ---------------------------------------------------------------------------
// Where the stage camera stands
// ---------------------------------------------------------------------------

export type CameraPose = { position: Vec3; target: Vec3; fovDeg: number };

/** What the solve had to give up to fit the stage; the page says each one. */
export type MatchNotes = {
  /** Wider than the stage's widest lens (90°): the widest is used. */
  fovClampedWide?: boolean;
  /** Longer than the longest lens the stage keeps (20°): that is used, and the camera moves in. */
  fovClampedNarrow?: boolean;
  /** The factor the distance was multiplied by to keep the subject's size in frame. */
  distanceScaled?: number;
  /** Tilted past what the stage camera can (SET_MAX_TILT_UP_DEG / SET_MAX_TILT_DOWN_DEG). */
  pitchClamped?: boolean;
  /** The subject sat too near the square's edge; the figure is kept inside the still. */
  subjectPulledIn?: boolean;
};

const DEG = Math.PI / 180;
/** Under this, the camera stands on the mark and says nothing about which side to shoot from. */
const SAME_SPOT_M = 0.2;
const MIN_DISTANCE_M = 0.6;
const MIN_TARGET_M = 0.5;
/** How far short of something built a pulled-in camera stops (frameFigure's room, set-view.tsx). */
const WALL_ROOM_M = 0.3;
/** How near the still's edge the figure may be placed, as a share of its width. */
const EDGE_ROOM = 0.15;
/** normaliseSetLayout's reach past the footprint for a camera. */
const CAMERA_REACH_M = 10;

/**
 * How far one can go from `origin` along `dir` and stay within ±limit on
 * each axis. The origin is inside the box; zero if it is not.
 */
function reachAlong(origin: number[], dir: number[], limit: number[]): number {
  let t = Infinity;
  for (let i = 0; i < origin.length; i++) {
    if (dir[i] > 1e-9) t = Math.min(t, (limit[i] - origin[i]) / dir[i]);
    else if (dir[i] < -1e-9) t = Math.min(t, (-limit[i] - origin[i]) / dir[i]);
  }
  return Math.max(0, t);
}

const finite = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/**
 * The stage camera that matches a reference picture, placed relative to the
 * stand-in's mark. Pure; every input is read defensively, so no NaN comes out.
 *
 *   Lens. The still is the CENTRE SQUARE of the stage canvas (set-view.tsx
 *   cropSquare), which on a landscape canvas spans the camera's vertical
 *   field of view. So the square takes the reference's field of view across
 *   its SHORTER side: a landscape reference's vertical, a portrait one's
 *   horizontal — 2·atan(aspect·tan(vfov/2)). Held to the field of view a
 *   saved camera keeps (SET_LIMITS 20–90°, normaliseSetLayout): a longer lens
 *   uses 20° and moves the camera in by tan(ref/2)/tan(10°), so the subject
 *   keeps its size in frame; a wider one uses 90°.
 *
 *   Where. On the side the person is already shooting from — the bearing from
 *   the mark to the current camera, or the way the figure faces when the
 *   camera stands on the mark (placeStandIn: 0° faces +Z, 90° faces +X) — at
 *   the reference's distance to its subject (without one, where the camera is
 *   now), at least 0.6 m, and never past where normaliseSetLayout keeps a
 *   camera. Height as read, within normaliseSetLayout's 0.2 m to twice the
 *   set's height. The page then pulls the camera in if something built
 *   stands between it and the figure.
 *
 *   Aim. The tilt as read, held to the stage's −80°…+20°. The mark goes where
 *   the subject sat: its x in the reference maps into the square (a
 *   landscape reference is wider than the square by its aspect), kept 15%
 *   inside either edge so the figure stays in the still, and the optical axis
 *   turns away from the mark until the mark's vertical line, at the height
 *   where the axis passes it — the screen's horizontal centre line — lands
 *   there. With a tilt, that turn is wider than at level: tan θ = (2x − 1) ·
 *   tan(fov/2) / cos(tilt). Without a subject, the axis passes through the
 *   mark.
 *
 *   Target. Where the axis passes the mark's vertical line, or meets the
 *   ground first, at least 0.5 m out — and inside the coordinates a saved
 *   layout keeps, so a reload aims the same way.
 */
export function solveMatchPose(
  match: ShotMatch,
  input: {
    mark: { x: number; z: number; facingDeg: number };
    current: CameraPose;
    /** Width ÷ height of the picture that was matched, as prepared. */
    referenceAspect: number;
    bounds: SetSpec["bounds"];
  },
): { pose: CameraPose; notes: MatchNotes } {
  const notes: MatchNotes = {};
  const halfX = Math.max(0, finite(input.bounds.x, 0) / 2);
  const halfZ = Math.max(0, finite(input.bounds.z, 0) / 2);
  const setHeight = Math.max(0.1, finite(input.bounds.height, SET_LIMITS.minHeight));
  const mark = {
    x: Math.min(halfX, Math.max(-halfX, finite(input.mark.x, 0))),
    z: Math.min(halfZ, Math.max(-halfZ, finite(input.mark.z, 0))),
  };
  const rawAspect = finite(input.referenceAspect, 1);
  const aspect = rawAspect > 0 ? Math.min(5, Math.max(0.2, rawAspect)) : 1;

  // --- lens ---
  const vfov = Math.min(MATCH_BOUNDS.verticalFovDeg[1], Math.max(MATCH_BOUNDS.verticalFovDeg[0], finite(match.verticalFovDeg, 40)));
  const shortSide = aspect >= 1 ? vfov : (2 * Math.atan(aspect * Math.tan((vfov * DEG) / 2))) / DEG;
  let fovDeg = shortSide;
  let distanceScale = 1;
  if (shortSide < SET_LIMITS.minFovDeg) {
    fovDeg = SET_LIMITS.minFovDeg;
    distanceScale = Math.tan((shortSide * DEG) / 2) / Math.tan((SET_LIMITS.minFovDeg * DEG) / 2);
    notes.fovClampedNarrow = true;
    notes.distanceScaled = distanceScale;
  } else if (shortSide > SET_LIMITS.maxFovDeg) {
    fovDeg = SET_LIMITS.maxFovDeg;
    notes.fovClampedWide = true;
  }

  // --- where: the bearing from the mark, the distance, the height ---
  const cx = finite(input.current?.position?.[0], mark.x) - mark.x;
  const cz = finite(input.current?.position?.[2], mark.z) - mark.z;
  const currentDistance = Math.hypot(cx, cz);
  let ux: number;
  let uz: number;
  if (currentDistance >= SAME_SPOT_M) {
    ux = cx / currentDistance;
    uz = cz / currentDistance;
  } else {
    const facing = finite(input.mark.facingDeg, 0) * DEG;
    ux = Math.sin(facing);
    uz = Math.cos(facing);
  }
  const fromReference = match.subjectFound && match.subjectDistanceM !== null ? finite(match.subjectDistanceM, currentDistance) : null;
  const wanted = (fromReference ?? currentDistance) * distanceScale;
  const reach = reachAlong([mark.x, mark.z], [ux, uz], [halfX + CAMERA_REACH_M, halfZ + CAMERA_REACH_M]);
  const distance = Math.min(Math.max(wanted, MIN_DISTANCE_M), Math.max(MIN_DISTANCE_M, reach));
  const height = Math.min(setHeight * 2, Math.max(0.2, finite(match.cameraHeightM, 1.6)));
  const position: Vec3 = [mark.x + ux * distance, height, mark.z + uz * distance];

  // --- aim ---
  const readPitch = finite(match.pitchDeg, 0);
  const pitchDeg = Math.min(SET_MAX_TILT_UP_DEG, Math.max(-SET_MAX_TILT_DOWN_DEG, readPitch));
  if (pitchDeg !== readPitch) notes.pitchClamped = true;
  let xInSquare = 0.5;
  if (match.subjectFound && match.subjectX !== null) {
    const x = finite(match.subjectX, 0.5);
    const mapped = aspect >= 1 ? 0.5 + (x - 0.5) * aspect : x;
    xInSquare = Math.min(1 - EDGE_ROOM, Math.max(EDGE_ROOM, mapped));
    if (mapped < EDGE_ROOM || mapped > 1 - EDGE_ROOM) notes.subjectPulledIn = true;
  }
  const pitch = pitchDeg * DEG;
  const turn = Math.atan(((2 * xInSquare - 1) * Math.tan((fovDeg * DEG) / 2)) / Math.cos(pitch));
  // From the camera toward the mark, then turned: a positive turn puts the
  // mark to the right of centre (in three.js, a camera on heading h, looking
  // along (sin h, ·, cos h), has its right-hand side along (−cos h, 0, sin h)).
  const heading = Math.atan2(-ux, -uz) + turn;
  const axis: Vec3 = [Math.cos(pitch) * Math.sin(heading), Math.sin(pitch), Math.cos(pitch) * Math.cos(heading)];

  return { pose: { position, target: targetAlong(position, axis, mark, Infinity), fovDeg }, notes };
}

/**
 * The target for a camera at `position` looking along the unit `axis`: where
 * the axis passes the mark's vertical line — at the mark's depth — or meets
 * the ground first; at least 0.5 m out, inside the coordinates a saved layout
 * keeps (so a reload aims the same way), and within `maxDistance`.
 */
function targetAlong(position: Vec3, axis: Vec3, mark: { x: number; z: number }, maxDistance: number): Vec3 {
  const flat = axis[0] * axis[0] + axis[2] * axis[2];
  let along = flat > 1e-9 ? ((mark.x - position[0]) * axis[0] + (mark.z - position[2]) * axis[2]) / flat : MIN_TARGET_M;
  if (axis[1] < 0) along = Math.min(along, position[1] / -axis[1]);
  const C = SET_LIMITS.maxCoordinate;
  const most = Math.min(reachAlong(position, axis, [C, C, C]), maxDistance);
  along = Math.min(Math.max(along, MIN_TARGET_M), Math.max(MIN_TARGET_M, most));
  return [position[0] + axis[0] * along, position[1] + axis[1] * along, position[2] + axis[2] * along];
}

/**
 * Where the camera looks once the page has placed it — pulled toward the
 * figure when something built stood in the way. Along the SOLVED direction,
 * with the target taken again from where the camera now stands. The pull
 * keeps the camera on the line through the mark, so the bearing is the same,
 * and the turn that puts the mark where the subject sat does not depend on
 * distance: the same direction keeps the framing exactly. Aiming at the
 * solved target point instead would lose the figure: that point sits beside
 * the mark at the far camera's depth, and from a camera pulled from 12 m to
 * 2 m it can be 38° off the mark, outside a 20° lens. Within `maxDistance`,
 * the orbit's reach, so the controls never move the camera to fit.
 */
export function aimFrom(position: Vec3, pose: CameraPose, mark: { x: number; z: number }, maxDistance: number): Vec3 {
  const d: Vec3 = [pose.target[0] - pose.position[0], pose.target[1] - pose.position[1], pose.target[2] - pose.position[2]];
  const length = Math.hypot(...d);
  const axis: Vec3 = length > 1e-9 ? [d[0] / length, d[1] / length, d[2] / length] : [0, 0, -1];
  return targetAlong(position, axis, mark, maxDistance * 0.99);
}

/**
 * Where the stage camera stands for a solved pose, in the set as built. On
 * the line from the figure's eye (the mark, at eye height) to the solved
 * camera, 0.3 m short of the first thing built in between (and at least
 * 0.6 m out) — a wall, a ceiling, the car the camera would stand inside — so
 * the figure is never hidden behind the set; then aimed by aimFrom. The
 * interpreter's own floor and sky dome never count as built. three.js is
 * passed in, as build-scene.ts does, so the test runs this on three's core.
 */
export function placeMatchedCamera(
  THREE: typeof ThreeNS,
  set: ThreeNS.Object3D,
  eye: Vec3,
  pose: CameraPose,
  maxDistance: number,
): { position: Vec3; target: Vec3; pulledIn: boolean } {
  const from = new THREE.Vector3(...eye);
  const dir = new THREE.Vector3(...pose.position).sub(from);
  const reach = dir.length();
  let position: Vec3 = [pose.position[0], pose.position[1], pose.position[2]];
  let pulledIn = false;
  if (reach > 1e-6) {
    dir.divideScalar(reach);
    set.updateMatrixWorld(true);
    const hit = new THREE.Raycaster(from, dir, 0, reach)
      .intersectObject(set, true)
      .find((h) => h.object.name !== "sky" && h.object.name !== "ground");
    const room = hit ? Math.max(MIN_DISTANCE_M, hit.distance - WALL_ROOM_M) : reach;
    if (room < reach) {
      position = [from.x + dir.x * room, from.y + dir.y * room, from.z + dir.z * room];
      pulledIn = true;
    }
  }
  return { position, target: aimFrom(position, pose, { x: eye[0], z: eye[2] }, maxDistance), pulledIn };
}

export type MatchClamp = "wide" | "narrow" | "tiltUp" | "tiltDown" | "subject";

/**
 * What the page's line says about a match: the camera's lens to the nearest
 * millimetre (lensForFov: a 24 mm frame height, the "35 mm" photographers
 * mean — the lens chips round it further, and do not reach 12 or 68 mm,
 * where the stage's 90° and 20° fall), its height to 0.1 m and its tilt in
 * whole degrees (+ up, − down), all from the pose the camera actually took,
 * and which limits of the stage applied.
 */
export function matchSummary(
  match: ShotMatch,
  pose: CameraPose,
  notes: MatchNotes,
): { lensMm: number; heightM: number; tiltDeg: number; clamps: MatchClamp[] } {
  const dx = pose.target[0] - pose.position[0];
  const dy = pose.target[1] - pose.position[1];
  const dz = pose.target[2] - pose.position[2];
  const tilt = Math.atan2(dy, Math.hypot(dx, dz)) / DEG;
  const clamps: MatchClamp[] = [];
  if (notes.fovClampedWide) clamps.push("wide");
  if (notes.fovClampedNarrow) clamps.push("narrow");
  if (notes.pitchClamped) clamps.push(match.pitchDeg > 0 ? "tiltUp" : "tiltDown");
  if (notes.subjectPulledIn) clamps.push("subject");
  return {
    lensMm: Math.round(lensForFov(pose.fovDeg)),
    heightM: Math.round(pose.position[1] * 10) / 10,
    tiltDeg: Math.round(tilt) || 0,
    clamps,
  };
}

// ---------------------------------------------------------------------------
// Waiting for the answer
// ---------------------------------------------------------------------------

/**
 * Poll a background answer every `intervalMs` until it is no longer working,
 * or until no poll may start: one more pause would pass `deadlineAt`. Null
 * when the deadline came first. The clock and the pause are handed in
 * (match-actions.ts passes Date.now and a timer), so the test runs on a fake
 * one.
 */
export async function pollUntilDeadline<T>(
  poll: () => Promise<T>,
  working: (answer: T) => boolean,
  clock: { now: () => number; pause: (ms: number) => Promise<void>; deadlineAt: number; intervalMs: number },
): Promise<T | null> {
  while (clock.now() + clock.intervalMs < clock.deadlineAt) {
    await clock.pause(clock.intervalMs);
    const answer = await poll();
    if (!working(answer)) return answer;
  }
  return null;
}
