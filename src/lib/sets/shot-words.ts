// Astra chat (2026-09-14): a person's words about a shot, read into a frame.
//
// WHAT. On a set's page the person says what they want — "Eva by the car,
// from behind, 50 mm" — and the page turns that into what the stage already
// understands: a camera or a side of the figure to stand on, a lens, a mark,
// which way the figure faces, and the words that say what happens (the
// direction the shot prompt has always carried). A small model reads the
// words into exactly those fields as JSON, with no free text but the
// direction, which stays the person's own words. Nothing here moves the
// camera: the fields go through solveMatchPose and the stage's matchTo, the
// way a matched shot does (match-shot.ts).
//
// FAIL OPEN. No key, a refusal, a timeout, an answer that is not the shape:
// null, and the page takes the whole message as what happens and says so.
//
// THE MONEY. One reading a message: a few hundred tokens in, under a hundred
// out, on the same small model the look's people reader uses (look-people.ts)
// — well under a cent. The only rate in code is identity-check/route.ts's
// THE MONEY ($0.75 per 1M input tokens, $4.50 per 1M output, read
// 2026-09-22); the model's page (developers.openai.com/api/docs/models/
// gpt-5.4-mini) has the rest, cached input included — re-read it before
// quoting a cost. This model can spend output tokens on hidden reasoning
// before it writes (describe-image.ts: a tight cap came back EMPTY,
// operator report 2026-08-25), so what a reading really costs is MEASURED,
// not argued: every reading logs its token counts, and never its words
// (readerUsageOf; Helios Cut 2, step 0, 2026-09-25).
//
// Relative imports only: tested with a fake fetch.

import { fovForLens, LENSES_MM } from "./build-scene";
import type { CameraPose, ShotMatch } from "./match-shot";
import { SET_BRIEF_MAX_CHARS, SET_DIRECTION_MAX_CHARS, SET_MAX_TILT_DOWN_DEG, SET_MAX_TILT_UP_DEG } from "./set-config";
import { cleanText, type SetSpec } from "./set-spec";

/** The model that reads the words: the look's people reader (look-people.ts LOOK_PEOPLE_MODEL). */
export const SHOT_WORDS_MODEL = "gpt-5.4-mini";
/** The answer, headers to body, past this and the page reads the words itself. */
export const SHOT_WORDS_TIMEOUT_MS = 20_000;
/** A message longer than this is cut before it is read. */
export const SHOT_WORDS_MAX_CHARS = 600;
/** Readings a person may ask for in ten minutes (words-actions.ts). */
export const SHOT_WORDS_PER_10_MIN = 40;
const SEED = 7;

export const SHOT_INTENTS = ["frame", "shoot", "talk", "edit"] as const;
export type ShotIntent = (typeof SHOT_INTENTS)[number];
/** Where the camera stands relative to the figure, by the figure's own front. */
export const CAMERA_SIDES = ["front", "front_left", "front_right", "left", "right", "back_left", "back_right", "back"] as const;
export type CameraSide = (typeof CAMERA_SIDES)[number];
export const SHOT_SIZES = ["close_up", "medium", "full", "wide"] as const;
export type ShotSize = (typeof SHOT_SIZES)[number];
export const CAMERA_HEIGHTS = ["low", "eye", "high"] as const;
export type CameraHeight = (typeof CAMERA_HEIGHTS)[number];
/** Where the figure faces, by the camera. */
export const FIGURE_FACINGS = ["camera", "away", "left", "right"] as const;
export type FigureFacing = (typeof FIGURE_FACINGS)[number];
export type LensMm = (typeof LENSES_MM)[number];

export type ShotWords = {
  intent: ShotIntent;
  /** What happens in the picture, in the person's words: the shot prompt's direction. "" when they said nothing about it. */
  direction: string;
  /** The place to build, without anyone in it — only read on the Sets home (askPlace); null elsewhere or when no place was described. */
  place: string | null;
  cameraId: string | null;
  side: CameraSide | null;
  size: ShotSize | null;
  height: CameraHeight | null;
  /** + up, − down, within the stage's tilt (set-config.ts). */
  tiltDeg: number | null;
  lensMm: LensMm | null;
  markId: string | null;
  facing: FigureFacing | null;
};

/** Lens to figure along the ground, metres, for each size of shot IN THE WHOLE RENDER — the band's share divides it (wordsToMatch). */
export const SIZE_DISTANCE_M: Record<ShotSize, number> = { close_up: 1.4, medium: 2.4, full: 3.6, wide: 6.5 };
/** Lens height for each height word: a low camera, eye level (set-view.tsx FRAME_EYE_Y), a high one. */
export const HEIGHT_M: Record<CameraHeight, number> = { low: 0.7, eye: 1.45, high: 2.6 };
/** The tilt a height word implies when none is said: a low camera looks up a little, a high one down. */
export const HEIGHT_TILT_DEG: Record<CameraHeight, number> = { low: 4, eye: 0, high: -14 };
/** Under this, the camera stands on the mark and says nothing about which side it is on (match-shot.ts SAME_SPOT_M). */
const SAME_SPOT_M = 0.2;
const MIN_DISTANCE_M = 0.6;
const DEG = Math.PI / 180;

const SHAPE =
  '{"intent":"frame","direction":"","camera_id":null,"side":null,"size":null,"height":null,"tilt_deg":null,"lens_mm":null,"mark_id":null,"facing":null';

/**
 * What the reader is told: the stage's cameras and marks by id and name,
 * the lenses, the characters it may meet by name, and the shape to answer
 * in. English for the model; nothing here is shown to anyone.
 */
export function shotWordsInstructions(stage: { spec: SetSpec | null; characters: readonly string[]; askPlace: boolean }): string {
  const named = (xs: readonly { id: string; label: string }[]) => xs.map((x) => `${x.id}: ${x.label || x.id}`).join("; ");
  const lines = [
    "You read what a person wants in one photograph, to be taken on a small 3D stage, and answer with JSON only: one object, no other text.",
  ];
  if (stage.spec) {
    lines.push(
      `The stage has these cameras (id: name): ${named(stage.spec.cameras)}. Marks where the person can stand (id: name): ${named(stage.spec.marks)}.`,
    );
  }
  lines.push(`Lenses: ${LENSES_MM.join(", ")} mm.`);
  if (stage.characters.length > 0) lines.push(`Characters they may name: ${stage.characters.join(", ")}.`);
  lines.push(`Answer exactly this shape: ${SHAPE}${stage.askPlace ? ',"place":null' : ""}}`);
  // "edit" hands the words to Astra — one of the month's paid changes, on a
  // press of its card (set-view.tsx). The time of day, the light and the
  // look are not Astra's: "now golden hour" used to be read as an edit and
  // sent to a rewrite of the whole set (Helios Cut 2, step 1, 2026-09-25).
  lines.push(
    '- intent: "shoot" when they ask to take the picture now (shoot, go, take it, do it, one more); "frame" when they set up the shot: who, what happens, where the camera stands; "edit" when they ask to change the PLACE ITSELF — recolour, add, remove or move what is built (make the walls red, add a row of flags, remove the car) — never for the camera or the person, never the time of day, the light or the look; "talk" when the words are about none of these.',
    "- direction: what happens in the picture — the pose, the action, the expression, the mood — in their own words, without the camera settings and without the place. Empty when they said nothing about it.",
    "- camera_id: one of the camera ids, only when they name that camera. side: where the camera stands relative to THE PERSON: front, back, left, right, or front_left, front_right, back_left, back_right (from behind: back; over the shoulder: back_left; profile: left). Only the person has sides here: when they name the side of something else — the front of the car, behind the building, the back of the room — leave side null and put their words in direction, since the camera cannot be placed by that thing. size: close_up, medium, full (the whole person), wide (the person small in the place). height: low, eye, high. tilt_deg: degrees the camera tilts, + up and − down, only when they say so. lens_mm: one of the lenses, when they name one. mark_id: one of the mark ids, when they name a mark or the spot it names. facing: where the person faces: camera, away, left, right.",
  );
  if (stage.askPlace) {
    lines.push("- place: the place to build, in their words, with every person and every camera setting left out; null when the words describe no place.");
  }
  lines.push("- Never invent: null for anything they did not say. Never describe the person.");
  return lines.join("\n");
}

const oneOf = <T extends string | number>(v: unknown, list: readonly T[]): T | null =>
  (list as readonly unknown[]).includes(v) ? (v as T) : null;

/**
 * The model's text → the fields, held to the stage: only its camera and
 * mark ids, only the listed lenses, the tilt within the stage's, the
 * direction cleaned as the shot action cleans it. Null when the text is not
 * an object of the shape at all. Exported for the tests.
 */
export function parseShotWords(text: string, stage: { spec: SetSpec | null; askPlace: boolean }): ShotWords | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const r = parsed as Record<string, unknown>;
  const tilt = typeof r.tilt_deg === "number" && Number.isFinite(r.tilt_deg) ? r.tilt_deg : null;
  const place = stage.askPlace && typeof r.place === "string" ? cleanText(r.place, SET_BRIEF_MAX_CHARS) : "";
  return {
    intent: oneOf(r.intent, SHOT_INTENTS) ?? "frame",
    direction: typeof r.direction === "string" ? cleanText(r.direction, SET_DIRECTION_MAX_CHARS) : "",
    place: place.length > 0 ? place : null,
    cameraId: typeof r.camera_id === "string" && stage.spec?.cameras.some((c) => c.id === r.camera_id) ? r.camera_id : null,
    side: oneOf(r.side, CAMERA_SIDES),
    size: oneOf(r.size, SHOT_SIZES),
    height: oneOf(r.height, CAMERA_HEIGHTS),
    tiltDeg: tilt === null ? null : Math.round(Math.min(SET_MAX_TILT_UP_DEG, Math.max(-SET_MAX_TILT_DOWN_DEG, tilt))),
    lensMm: oneOf(r.lens_mm, LENSES_MM),
    markId: typeof r.mark_id === "string" && stage.spec?.marks.some((m) => m.id === r.mark_id) ? r.mark_id : null,
    facing: oneOf(r.facing, FIGURE_FACINGS),
  };
}

/** Whether the words move the camera at all: a named camera, or a side, size, height, tilt or lens. */
export function hasCameraWords(w: Pick<ShotWords, "cameraId" | "side" | "size" | "height" | "tiltDeg" | "lensMm">): boolean {
  return w.cameraId !== null || w.side !== null || w.size !== null || w.height !== null || w.tiltDeg !== null || w.lensMm !== null;
}

/**
 * The unit vector from the figure toward a camera on `side` of it. The figure
 * faces along (sin f, cos f) (build-scene.ts placeStandIn: 0° faces +Z, 90°
 * faces +X); its right-hand side lies along (−cos f, sin f), as a camera on
 * heading f has its right along that (match-shot.ts solveMatchPose).
 */
export function sideUnit(side: CameraSide, facingDeg: number): [number, number] {
  const f = facingDeg * DEG;
  const F = [Math.sin(f), Math.cos(f)];
  const R = [-Math.cos(f), Math.sin(f)];
  const mix: Record<CameraSide, [number, number]> = {
    front: [1, 0],
    back: [-1, 0],
    right: [0, 1],
    left: [0, -1],
    front_right: [1, 1],
    front_left: [1, -1],
    back_right: [-1, 1],
    back_left: [-1, -1],
  };
  const [a, b] = mix[side];
  const x = a * F[0] + b * R[0];
  const z = a * F[1] + b * R[1];
  const n = Math.hypot(x, z) || 1;
  return [x / n, z / n];
}

/** The tilt of a pose, degrees: + up, − down. */
function pitchOf(pose: CameraPose): number {
  const d = [pose.target[0] - pose.position[0], pose.target[1] - pose.position[1], pose.target[2] - pose.position[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  return len < 1e-6 ? 0 : Math.asin(Math.min(1, Math.max(-1, d[1] / len))) / DEG;
}

/**
 * The camera the words ask for, as a matched shot (match-shot.ts ShotMatch)
 * and the camera to solve it from. solveMatchPose keeps the bearing of the
 * camera it is handed, so a side is asked for by handing it a camera already
 * on that side of the figure; without a side, the person's own camera, so
 * the bearing they were shooting from holds. Every field the words leave
 * out keeps the camera's own value: its distance, height, tilt and lens.
 * Pure; the page then solves and places it (set-view.tsx applyWords).
 *
 * A lens named in words is the lens on the rig's own body: "50 mm" on
 * Super 35 is not the 50 of full frame, and without the sensor the chip
 * came back reading another number than the one the person said (found
 * reviewing Helios, 2026-09-17). Left out, it is full frame, as the ring is.
 */
export function wordsToMatch(
  w: Pick<ShotWords, "side" | "size" | "height" | "tiltDeg" | "lensMm">,
  input: {
    mark: { x: number; z: number; facingDeg: number };
    current: CameraPose;
    sensorHeightMm?: number;
    /** The band's share of the render's height (rig.ts formatFrame bandH / renderH); the whole render when left out. */
    frame?: { heightShare: number };
  },
): { match: ShotMatch; from: CameraPose } {
  const { mark, current } = input;
  const cx = current.position[0] - mark.x;
  const cz = current.position[2] - mark.z;
  const currentDistance = Math.hypot(cx, cz);
  let ux: number;
  let uz: number;
  if (w.side) {
    [ux, uz] = sideUnit(w.side, mark.facingDeg);
  } else if (currentDistance >= SAME_SPOT_M) {
    ux = cx / currentDistance;
    uz = cz / currentDistance;
  } else {
    [ux, uz] = sideUnit("front", mark.facingDeg);
  }
  // A size is how large the person stands in the PICTURE, and the picture is
  // the band the still is cut to: Scope keeps 643 of the render's 1024 rows,
  // so the square's 1.4 m close-up came back an extreme close-up and its
  // "full" cut the head off (2026-09-18). The camera stands back by the
  // band's share, which is the rule the page's own frameFigure follows.
  const heightShare = input.frame && input.frame.heightShare > 0 ? Math.min(1, input.frame.heightShare) : 1;
  const distance = w.size ? SIZE_DISTANCE_M[w.size] / heightShare : Math.max(MIN_DISTANCE_M, currentDistance);
  const height = w.height ? HEIGHT_M[w.height] : current.position[1];
  const pitch = w.tiltDeg ?? (w.height ? HEIGHT_TILT_DEG[w.height] : pitchOf(current));
  const fov = w.lensMm ? fovForLens(w.lensMm, input.sensorHeightMm) : current.fovDeg;
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return {
    from: { position: [r(mark.x + ux * distance), r(height), r(mark.z + uz * distance)], target: [mark.x, 1, mark.z], fovDeg: fov },
    match: {
      subjectFound: true,
      cameraHeightM: height,
      pitchDeg: pitch,
      verticalFovDeg: fov,
      subjectDistanceM: distance,
      subjectX: 0.5,
      framing: null,
      confidence: "high",
    },
  };
}

/**
 * Where the figure faces, in degrees, for a facing word: toward the camera
 * at `camera`, away from it, or to the camera's left or right (as the
 * picture shows it). By the camera's bearing from the mark: a camera on
 * heading h has its right along (−cos h, sin h), so a figure facing the
 * picture's right faces h − 90°, and the picture's left h + 90°.
 */
export function facingFor(facing: FigureFacing, mark: { x: number; z: number }, camera: CameraPose): number {
  const bearing = Math.atan2(camera.position[0] - mark.x, camera.position[2] - mark.z) / DEG;
  const heading = bearing + 180;
  const deg = facing === "camera" ? bearing : facing === "away" ? heading : facing === "right" ? heading - 90 : heading + 90;
  return Math.round((((deg % 360) + 360) % 360) * 10) / 10;
}

/**
 * What one reading used, for the log: token counts and how the answer
 * ended, read off the Chat Completions answer — never a word of the
 * message, the instructions or the answer. `cached` is the input the
 * provider served from its prompt cache; `reasoning` is output spent before
 * the visible text, billed as output and counted against the cap; `finish`
 * "length" means the cap cut the answer. Null for anything not reported.
 */
export type ReaderUsage = {
  model: string;
  prompt: number | null;
  cached: number | null;
  completion: number | null;
  reasoning: number | null;
  finish: string | null;
};

export function readerUsageOf(data: unknown, model: string): ReaderUsage {
  const d = (data && typeof data === "object" ? data : {}) as {
    usage?: {
      prompt_tokens?: unknown;
      completion_tokens?: unknown;
      prompt_tokens_details?: { cached_tokens?: unknown } | null;
      completion_tokens_details?: { reasoning_tokens?: unknown } | null;
    } | null;
    choices?: { finish_reason?: unknown }[] | null;
  };
  const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  const finish = Array.isArray(d.choices) ? d.choices[0]?.finish_reason : undefined;
  return {
    model,
    prompt: count(d.usage?.prompt_tokens),
    cached: count(d.usage?.prompt_tokens_details?.cached_tokens),
    completion: count(d.usage?.completion_tokens),
    reasoning: count(d.usage?.completion_tokens_details?.reasoning_tokens),
    // The provider's own word ("stop", "length"…), kept short: never text.
    finish: typeof finish === "string" && /^[a-z_]{1,32}$/.test(finish) ? finish : null,
  };
}

/**
 * The model's answer to `text` under `instructions`, as text — or null when
 * it could not be asked or did not answer (the header: fail open). Never
 * logs the words; logs what the reading used (readerUsageOf), whatever the
 * answer turns out to be — an answer the cap emptied most of all.
 */
export async function askShotWords(
  instructions: string,
  text: string,
  opts: { timeoutMs?: number; fetchFn?: typeof fetch } = {},
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[sets] shot words skipped: OPENAI_API_KEY is not set");
    return null;
  }
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), opts.timeoutMs ?? SHOT_WORDS_TIMEOUT_MS);
  try {
    const res = await (opts.fetchFn ?? fetch)("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: SHOT_WORDS_MODEL,
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: text },
        ],
        max_completion_tokens: 400,
        temperature: 0,
        seed: SEED,
        response_format: { type: "json_object" },
      }),
      signal: deadline.signal,
    });
    if (!res.ok) {
      console.warn(`[sets] shot words failed: ${SHOT_WORDS_MODEL} answered ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] } | null;
    console.info("[sets] reader usage", readerUsageOf(data, SHOT_WORDS_MODEL));
    const answer = data?.choices?.[0]?.message?.content;
    return typeof answer === "string" ? answer : null;
  } catch (err) {
    console.warn(`[sets] shot words failed: ${err instanceof Error ? err.name : "error"}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
