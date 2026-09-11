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
  /** The subject was nearer than a camera may stand (0.6 m): the figure comes out smaller in frame. */
  distanceClampedNear?: boolean;
  /** The subject was farther than a saved layout keeps a camera: the figure comes out larger in frame. */
  distanceClampedFar?: boolean;
  /** Lower than a saved camera may stand (0.2 m). */
  heightClampedLow?: boolean;
  /** Higher than a saved camera may stand (twice the set's height). */
  heightClampedHigh?: boolean;
  /** Tilted past what the stage camera can (SET_MAX_TILT_UP_DEG / SET_MAX_TILT_DOWN_DEG). */
  pitchClamped?: boolean;
  /** The subject sat too near the square's edge; the figure is kept inside the still. */
  subjectPulledIn?: boolean;
};

const DEG = Math.PI / 180;
/** Under this, the camera stands on the mark and says nothing about which side to shoot from. */
const SAME_SPOT_M = 0.2;
const MIN_DISTANCE_M = 0.6;
const MIN_HEIGHT_M = 0.2;
const MIN_TARGET_M = 0.5;
/** How far short of something built a pulled-in camera stops (frameFigure's room, set-view.tsx). */
const WALL_ROOM_M = 0.3;
/** Room enough on a side to stay on it, when the matched camera stands farther out (frameFigure's rule). */
const GOOD_ROOM_M = 1.2;
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
 *   set's height. A read distance or height held to those limits is noted,
 *   like every other limit. The page then moves the camera if something
 *   built stands between it and the figure (placeMatchedCamera).
 *
 *   Aim. The tilt as read, held to the stage's −80°…+20°. The mark goes where
 *   the subject sat: its x in the reference maps into the square (a
 *   landscape reference is wider than the square by its aspect), kept 15%
 *   inside either edge so the figure stays in the still, and the optical axis
 *   turns away from the mark until the mark's vertical line, at the height
 *   where the axis passes it — the screen's horizontal centre line — lands
 *   there. With a tilt, that turn is wider than at level: tan θ = (2x − 1) ·
 *   s · tan(fov/2) / cos(tilt), where s is the still's half-width against
 *   the lens's: 1 on a landscape canvas, the canvas's width ÷ height on a
 *   portrait one (a phone held upright), whose centre square spans only the
 *   canvas's width. Without a subject, the axis passes through the mark.
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
    /**
     * Width ÷ height of the stage canvas the still is cut from (its centre
     * square). A portrait canvas's still is narrower than the lens, so the
     * figure is placed for the still this canvas takes.
     */
    canvasAspect: number;
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
  // The still's half-width against the lens's (set-view.tsx fit, cropSquare):
  // the centre square spans the vertical field of view on a landscape canvas,
  // and only the canvas's width on a portrait one.
  const rawCanvas = finite(input.canvasAspect, 1);
  const stillShare = rawCanvas > 0 ? Math.min(1, Math.max(0.2, rawCanvas)) : 1;

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
  const farthest = Math.max(MIN_DISTANCE_M, reach);
  const distance = Math.min(Math.max(wanted, MIN_DISTANCE_M), farthest);
  // Only a distance the picture gave is worth a word: without a subject the
  // camera keeps its own, and nobody asked for another.
  if (fromReference !== null && wanted < MIN_DISTANCE_M) notes.distanceClampedNear = true;
  if (fromReference !== null && wanted > farthest) notes.distanceClampedFar = true;
  const readHeight = finite(match.cameraHeightM, 1.6);
  const height = Math.min(setHeight * 2, Math.max(MIN_HEIGHT_M, readHeight));
  if (readHeight < MIN_HEIGHT_M) notes.heightClampedLow = true;
  if (readHeight > setHeight * 2) notes.heightClampedHigh = true;
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
  const turn = Math.atan(((2 * xInSquare - 1) * stillShare * Math.tan((fovDeg * DEG) / 2)) / Math.cos(pitch));
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
 * Where the camera looks once the page has placed it — moved toward the
 * figure, or to another side of it, when something built stood in the way.
 * Along the direction of `pose` (the solved one, or the solved one turned
 * with the camera), with the target taken again from where the camera now
 * stands. Every place the page puts the camera is on the vertical plane
 * through the mark at that pose's bearing, and the turn that puts the mark
 * where the subject sat depends on neither distance nor height: the same
 * direction keeps the framing exactly. Aiming at the solved target point
 * instead would lose the figure: that point sits beside the mark at the far
 * camera's depth, and from a camera pulled from 12 m to 2 m it can be 38°
 * off the mark, outside a 20° lens. Within `maxDistance`, the orbit's reach,
 * so the controls never move the camera to fit.
 */
export function aimFrom(position: Vec3, pose: CameraPose, mark: { x: number; z: number }, maxDistance: number): Vec3 {
  const d: Vec3 = [pose.target[0] - pose.position[0], pose.target[1] - pose.position[1], pose.target[2] - pose.position[2]];
  const length = Math.hypot(...d);
  const axis: Vec3 = length > 1e-9 ? [d[0] / length, d[1] / length, d[2] / length] : [0, 0, -1];
  return targetAlong(position, axis, mark, maxDistance * 0.99);
}

/**
 * How the page had to move a solved camera for the figure to be seen in the
 * set as built: not at all; toward the figure, on the same side; to another
 * side of it; or nowhere, because something built stands close around the
 * figure on every side (the camera then stays as solved, and the page says
 * the figure may be hidden).
 */
export type CameraMove = "none" | "in" | "around" | "blocked";

/** The pose turned about the mark's vertical line by `turn` radians (a bearing of 0 is +Z, 90° is +X). */
function turnAbout(pose: CameraPose, mark: { x: number; z: number }, turn: number): CameraPose {
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const spin = (p: Vec3): Vec3 => {
    const dx = p[0] - mark.x;
    const dz = p[2] - mark.z;
    return [mark.x + dx * c + dz * s, p[1], mark.z + dz * c - dx * s];
  };
  return { position: spin(pose.position), target: spin(pose.target), fovDeg: pose.fovDeg };
}

/**
 * Where the stage camera stands for a solved pose, in the set as built, so
 * that nothing built hides the figure. A side is judged along the line from
 * the figure's eye (the mark, at eye height) to the camera: the camera stands
 * 0.3 m short of the first thing built on that line — a wall, a ceiling, the
 * car it would stand inside — and a side where that leaves less than 0.6 m is
 * not used at all: the camera is never put beyond what is in the way.
 *
 * The person's own side, the solved one, is kept when the camera can stand at
 * least 1.2 m out there (or as far out as it was matched, if that is
 * nearer). Otherwise, frameFigure's order (set-view.tsx): the way the figure
 * faces, then the eight compass points, the first with that much room; and
 * failing every one, whichever usable side has the most room. Another side
 * is the solved camera turned about the mark, held within where a saved
 * layout keeps a camera: its height, tilt and lens, and the turn that puts
 * the mark where the subject sat, do not depend on the bearing, so the
 * framing holds. With no usable side the camera stays as solved.
 *
 * Aimed by aimFrom. The interpreter's own floor and sky dome never count as
 * built. three.js is passed in, as build-scene.ts does, so the test runs this
 * on three's core.
 */
export function placeMatchedCamera(
  THREE: typeof ThreeNS,
  set: ThreeNS.Object3D,
  pose: CameraPose,
  stage: {
    mark: { x: number; z: number; facingDeg: number };
    /** The figure's eye height: every line of sight starts there. */
    eyeY: number;
    bounds: SetSpec["bounds"];
    /** The orbit's reach, which no target may pass. */
    maxDistance: number;
  },
): { position: Vec3; target: Vec3; moved: CameraMove } {
  const mark = { x: stage.mark.x, z: stage.mark.z };
  const eye = new THREE.Vector3(mark.x, stage.eyeY, mark.z);
  const limit = [stage.bounds.x / 2 + CAMERA_REACH_M, stage.bounds.z / 2 + CAMERA_REACH_M];
  const raycaster = new THREE.Raycaster();
  set.updateMatrixWorld(true);

  // One side: the solved pose turned about the mark (not at all for the
  // person's own), and how far out along the eye's line the camera can stand.
  const side = (turn: number) => {
    const turned = turn === 0 ? pose : turnAbout(pose, mark, turn);
    let at: Vec3 = [turned.position[0], turned.position[1], turned.position[2]];
    const flat = Math.hypot(at[0] - mark.x, at[2] - mark.z);
    if (turn !== 0 && flat > 1e-9) {
      const ux = (at[0] - mark.x) / flat;
      const uz = (at[2] - mark.z) / flat;
      const most = Math.max(MIN_DISTANCE_M, reachAlong([mark.x, mark.z], [ux, uz], limit));
      if (flat > most) at = [mark.x + ux * most, at[1], mark.z + uz * most];
    }
    const dir = new THREE.Vector3(...at).sub(eye);
    const full = dir.length();
    if (full < 1e-6) return { turned, at, dir, full, out: full, usable: true };
    dir.divideScalar(full);
    raycaster.set(eye, dir);
    raycaster.far = full;
    const hit = raycaster.intersectObject(set, true).find((h) => h.object.name !== "sky" && h.object.name !== "ground");
    const out = hit ? Math.min(full, hit.distance - WALL_ROOM_M) : full;
    return { turned, at, dir, full, out, usable: !hit || out >= MIN_DISTANCE_M };
  };
  type Side = ReturnType<typeof side>;
  const roomy = (s: Side) => s.usable && s.out >= Math.min(s.full, GOOD_ROOM_M) - 1e-9;

  const own = side(0);
  let chosen: Side | null = roomy(own) ? own : null;
  if (!chosen) {
    let best: Side | null = own.usable ? own : null;
    const solvedBearing = Math.atan2(pose.position[0] - mark.x, pose.position[2] - mark.z);
    const facing = finite(stage.mark.facingDeg, 0) * DEG;
    for (const bearing of [facing, ...Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4)]) {
      const turn = Math.atan2(Math.sin(bearing - solvedBearing), Math.cos(bearing - solvedBearing));
      if (Math.abs(turn) < 1e-6) continue;
      const s = side(turn);
      if (roomy(s)) {
        chosen = s;
        break;
      }
      if (s.usable && (!best || s.out > best.out)) best = s;
    }
    chosen = chosen ?? best;
  }
  if (!chosen) {
    const position: Vec3 = [pose.position[0], pose.position[1], pose.position[2]];
    return { position, target: aimFrom(position, pose, mark, stage.maxDistance), moved: "blocked" };
  }
  const pulled = chosen.out < chosen.full;
  const position: Vec3 = pulled
    ? [eye.x + chosen.dir.x * chosen.out, eye.y + chosen.dir.y * chosen.out, eye.z + chosen.dir.z * chosen.out]
    : chosen.at;
  const moved: CameraMove = chosen !== own ? "around" : pulled ? "in" : "none";
  return { position, target: aimFrom(position, chosen.turned, mark, stage.maxDistance), moved };
}

export type MatchClamp = "wide" | "narrow" | "near" | "far" | "low" | "high" | "tiltUp" | "tiltDown" | "subject";

/** How close the camera must still be to where it was solved to stand at the same limit: half the 0.1 m the line gives. */
const SAME_PLACE_M = 0.05;

/**
 * What the page's line says about a match: the camera's lens to the nearest
 * millimetre (lensForFov: a 24 mm frame height, the "35 mm" photographers
 * mean — the lens chips round it further, and do not reach 12 or 68 mm,
 * where the stage's 90° and 20° fall), its height to 0.1 m and its tilt in
 * whole degrees (+ up, − down), all from the pose the camera actually took
 * (`taken`), and which limits of the stage applied (`solved`, what
 * solveMatchPose answered).
 *
 * A limit on where the camera stands — as near, far, low or high as the
 * stage allows — is said only while the camera still stands there. The page
 * moves a camera that something built would hide (placeMatchedCamera): pulled
 * in along the line from the figure's eye, which brings it nearer and toward
 * eye height, or turned to another side. The move is then said instead;
 * "as low as the stage allows" under a line that gives 0.8 m would be false.
 * A turn without a pull-in keeps the height, so a height limit is still said
 * then; a distance limit only where the camera was solved, since a far one
 * is the set's reach on that side alone. The lens, the tilt and where the
 * figure sits survive every move (aimFrom), so their limits are always said.
 */
export function matchSummary(
  match: ShotMatch,
  solved: { pose: CameraPose; notes: MatchNotes },
  taken: CameraPose,
): { lensMm: number; heightM: number; tiltDeg: number; clamps: MatchClamp[] } {
  const { notes } = solved;
  const dx = taken.target[0] - taken.position[0];
  const dy = taken.target[1] - taken.position[1];
  const dz = taken.target[2] - taken.position[2];
  const tilt = Math.atan2(dy, Math.hypot(dx, dz)) / DEG;
  const was = solved.pose.position;
  const sameHeight = Math.abs(taken.position[1] - was[1]) <= SAME_PLACE_M;
  const samePlace = Math.hypot(taken.position[0] - was[0], taken.position[2] - was[2]) <= SAME_PLACE_M;
  const clamps: MatchClamp[] = [];
  if (notes.fovClampedWide) clamps.push("wide");
  if (notes.fovClampedNarrow) clamps.push("narrow");
  if (notes.distanceClampedNear && samePlace) clamps.push("near");
  if (notes.distanceClampedFar && samePlace) clamps.push("far");
  if (notes.heightClampedLow && sameHeight) clamps.push("low");
  if (notes.heightClampedHigh && sameHeight) clamps.push("high");
  if (notes.pitchClamped) clamps.push(match.pitchDeg > 0 ? "tiltUp" : "tiltDown");
  if (notes.subjectPulledIn) clamps.push("subject");
  return {
    lensMm: Math.round(lensForFov(taken.fovDeg)),
    heightM: Math.round(taken.position[1] * 10) / 10,
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
