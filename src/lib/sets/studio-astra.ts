// Astra in Helios Studio (stage 4, 2026-09-29 — operator: "Implement Astra
// exactly as its implemented in Blender", then "SQL ran, keep going.").
//
// Blender's AI assistant lives in the N sidebar: it reads the scene, says
// what it will do, and every request is ONE undo. Until now the Studio's
// Astra matched a handful of scripted examples; this module is what lets
// her read ANY request about the scene:
//
//   - the scene summary the Studio sends (built in the engine, normalised
//     and capped HERE — on both sides, the server never trusts the browser's),
//   - the tool vocabulary: every step Astra may plan is one of STUDIO_OPS,
//     each mapped 1:1 to an operation the Studio already has,
//   - the request (instructions + strict JSON schema, ridden on the one
//     Astra client, providers/astra.ts),
//   - the validation of her answer into a PLAN: steps in plain words plus
//     the checked operations. Unknown ids become a plain "I can't find …"
//     step, numbers are clamped, and nothing is ever run on the server —
//     the Studio shows the plan and the person presses Apply.
//
// The engine validates the plan AGAIN against the live scene when Apply is
// pressed (the scene may have changed while Astra thought), with this same
// function. Pure and relative-import only, so the engine bundle and the
// tests import it directly.

import type { AstraJobRequest } from "../generations/providers/astra";
import { POSE_PRESETS, clampRot, isBone, type BoneName, type PosePreset } from "./studio-pose";
import { PATH_POINTS_MAX, type Gait } from "./studio-gait";
import { STUDIO_PART_KINDS, type StudioPartKind } from "./studio-parts";

/** The one plain line at the top of Astra's panel — his question, answered. */
export const STUDIO_ASTRA_TOP_LINE = "Astra edits this 3D scene. To make a picture or video, use Render.";

/** The longest request, in characters. */
export const STUDIO_ASTRA_MAX_CHARS = 500;
/** The scene summary's cap, as sent (JSON characters). */
export const STUDIO_SUMMARY_MAX_CHARS = 12_000;
/** How many objects the summary may name at most, before the character cap. */
export const STUDIO_SUMMARY_MAX_OBJECTS = 300;
/** The conversation Astra is shown: the last few turns, each cut short. */
export const STUDIO_TURNS_MAX = 6;
export const STUDIO_TURN_MAX_CHARS = 300;
/** A plan's longest list of steps. */
export const STUDIO_PLAN_MAX_STEPS = 40;
/** Her answer's cap: a 40-step plan at ~100 tokens a step, and room for low-effort reasoning. */
export const STUDIO_ASTRA_MAX_OUTPUT_TOKENS = 6_000;

export const STUDIO_ASTRA_TOO_SHORT = "Tell Astra what to change in the scene.";
export const STUDIO_ASTRA_NO_ANSWER = "Astra couldn't read that request — try saying it differently.";
export const STUDIO_ASTRA_NOTHING = "Astra had nothing to change for that.";
/** A resent delivery of a press already running (one job per press): the plan went to the first one. */
export const STUDIO_ASTRA_RESENT = "The connection dropped while Astra was planning — send it again.";

// ---------------- the vocabulary ----------------

export const STUDIO_OPS = [
  "select",
  "add",
  "delete",
  "duplicate",
  "move",
  "rotate",
  "scale",
  "size",
  "color",
  "material",
  "hide",
  "show",
  "rename",
  "parent",
  "key",
  "hour",
  "sky",
  "lens",
  "format",
  "aim",
  "view",
  "array",
  "mirror",
  "physics",
  "simulate",
  "bake",
  "frame",
  "range",
  // People (2026-09-30, operator picked "Posable people").
  "pose",
  "sit_on",
  "lean_on",
  "look_at",
  "add_person",
  // People that move (2026-09-30).
  "walk_to",
  "run_to",
  "follow_path",
  "turn_to",
  // The set's own parts (2026-09-30 — operator: "remove the garage and put the car on the road.").
  "place_on",
] as const;
export type StudioOpName = (typeof STUDIO_OPS)[number];

/** What "add" can make, and the Studio's own Add menu key for each. */
export const STUDIO_ADD_KINDS = {
  cube: "box",
  sphere: "sphere",
  cylinder: "cyl",
  cone: "cone",
  torus: "torus",
  ico_sphere: "ico",
  plane: "plane",
  empty: "empty",
  point_light: "point",
  spot_light: "spot",
  street_lamp: "lamp",
  car: "car",
  person: "person",
} as const;
export type StudioAddKind = keyof typeof STUDIO_ADD_KINDS;

export const STUDIO_SIDES = ["left", "right", "front", "behind", "above", "on", "near"] as const;
export type StudioSide = (typeof STUDIO_SIDES)[number];

/** The photo formats, as Astra names them, and the Studio's own labels. */
export const STUDIO_FORMATS = {
  "16:9": "16:9 · HD",
  "2.39:1": "2.39:1 · Scope",
  "9:16": "9:16 · Vertical",
  "1:1": "1:1 · Square",
  "4:5": "4:5 · Portrait",
} as const;
export type StudioFormat = keyof typeof STUDIO_FORMATS;

export const STUDIO_SKIES = ["simple", "physical", "studio"] as const;
export const STUDIO_PHYSICS = ["none", "active", "passive"] as const;
export const STUDIO_INTERPS = ["linear", "bezier", "constant"] as const;
export const STUDIO_AXES = ["x", "y", "z"] as const;

/** The Studio's clock: 10 s at 24 fps, frames 1–241 as the timeline counts them. */
export const STUDIO_FPS = 24;
export const STUDIO_LAST_FRAME = 241;

// ---------------- the scene summary ----------------

/** Blender axes: X right, Y away, Z up; metres; turn = degrees about Z. */
export type StudioSummaryObject = {
  id: string;
  name: string;
  kind: "mesh" | "light" | "camera" | "empty";
  at: [number, number, number];
  size: [number, number, number];
  turn: number;
  sel?: true;
  hidden?: true;
  astra?: true;
  parent?: string;
  keys?: number;
  physics?: "active" | "passive";
  /** A person: what their pose is doing, in words ("sitting on the red car, waving with the right hand"). */
  pose?: string;
  /** A person's walks, runs and turns on the timeline, in words ("walks to (3, -2) frames 1–73"). */
  moves?: string;
  /** A part of the set itself (studio-parts.ts): what it is. */
  set?: StudioPartKind;
  /** A part's top surface: its height (Blender Z), metres. */
  top?: number;
  /** A road: the way it runs on the ground, a unit [X, Y]. */
  along?: [number, number];
  /** A road: its width, metres. */
  width?: number;
  /** A road in several pieces: each piece's centre line [x1, y1, x2, y2, width]. */
  segs?: [number, number, number, number, number][];
};

export type StudioSummary = {
  frame: number;
  hour: number;
  sky: (typeof STUDIO_SKIES)[number];
  format: StudioFormat;
  lens: number;
  camera: string | null;
  aim: string | null;
  range: [number, number];
  objects: StudioSummaryObject[];
  /** Objects left out to keep the summary under its cap. */
  omitted: number;
};

const ID_RE = /^o\d{1,7}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;
const KINDS = new Set(["mesh", "light", "camera", "empty"]);

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** To the nearest `step` (a fraction like 0.05), divided back so 18.4 stays 18.4. */
const round = (v: number, step: number) => Math.round(v / step) / (1 / step);
/** One decimal, and no "-0". */
const r1 = (v: number) => {
  const x = Math.round(v * 10) / 10;
  return Object.is(x, -0) ? 0 : x;
};

/** Text from the browser or the model: control characters out, spaces collapsed, cut to `max`. */
export function studioText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function vec3(v: unknown, lo: number, hi: number): [number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out = v.map((x) => num(x));
  if (out.some((x) => x === null)) return null;
  return (out as number[]).map((x) => r1(clamp(x, lo, hi))) as [number, number, number];
}

function summaryObject(v: unknown): StudioSummaryObject | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = typeof o.id === "string" && ID_RE.test(o.id) ? o.id : null;
  const kind = typeof o.kind === "string" && KINDS.has(o.kind) ? (o.kind as StudioSummaryObject["kind"]) : null;
  const at = vec3(o.at, -5000, 5000);
  const size = vec3(o.size, 0, 5000);
  if (!id || !kind || !at || !size) return null;
  const out: StudioSummaryObject = { id, name: studioText(o.name, 60) || id, kind, at, size, turn: Math.round(clamp(num(o.turn) ?? 0, -360, 360)) };
  if (o.sel === true) out.sel = true;
  if (o.hidden === true) out.hidden = true;
  if (o.astra === true) out.astra = true;
  if (typeof o.parent === "string" && ID_RE.test(o.parent)) out.parent = o.parent;
  const keys = num(o.keys);
  if (keys !== null && keys > 0) out.keys = Math.min(9999, Math.floor(keys));
  if (o.physics === "active" || o.physics === "passive") out.physics = o.physics;
  const pose = studioText(o.pose, 120);
  if (pose) out.pose = pose;
  const moves = studioText(o.moves, 160);
  if (moves && pose) out.moves = moves;
  if (typeof o.set === "string" && (STUDIO_PART_KINDS as readonly string[]).includes(o.set)) {
    out.set = o.set as StudioPartKind;
    const top = num(o.top);
    if (top !== null) out.top = r1(clamp(top, -5000, 5000));
    const along = Array.isArray(o.along) && o.along.length === 2 ? o.along.map((x) => num(x)) : null;
    if (along && along[0] !== null && along[1] !== null && Math.hypot(along[0], along[1]) > 0.5) {
      const l = Math.hypot(along[0], along[1]);
      out.along = [Math.round((along[0] / l) * 100) / 100 || 0, Math.round((along[1] / l) * 100) / 100 || 0];
    }
    const width = num(o.width);
    if (width !== null && width > 0) out.width = r1(clamp(width, 0, 5000));
    const segs = (Array.isArray(o.segs) ? o.segs : [])
      .slice(0, 8)
      .map((g) => (Array.isArray(g) && g.length === 5 && g.every((x) => num(x) !== null) ? (g.map((x) => r1(clamp(x as number, -5000, 5000))) as [number, number, number, number, number]) : null))
      .filter((g): g is [number, number, number, number, number] => g !== null);
    if (segs.length > 1) out.segs = segs;
  }
  return out;
}

/**
 * The summary as it may be sent: every field checked, every number clamped
 * and rounded, and the objects cut until the JSON fits
 * STUDIO_SUMMARY_MAX_CHARS. What stays first: the selection, the shot
 * camera, what Astra made, then the rest in the Studio's own order (the
 * outliner's). Used by the engine before sending and by the server on what
 * arrives — so a browser that sends more than the cap is cut the same way.
 */
export function normaliseStudioSummary(raw: unknown): StudioSummary {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const all = (Array.isArray(o.objects) ? o.objects : []).map(summaryObject).filter((x): x is StudioSummaryObject => x !== null);
  const seen = new Set<string>();
  const unique = all.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  const camera = typeof o.camera === "string" && unique.some((x) => x.id === o.camera) ? o.camera : null;
  const aim = typeof o.aim === "string" && unique.some((x) => x.id === o.aim) ? o.aim : null;
  const rank = (x: StudioSummaryObject) => (x.sel ? 0 : x.id === camera ? 1 : x.astra ? 2 : 3);
  const ordered = unique.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i).map((e) => e.x);
  const range = vec2(o.range);
  const base: StudioSummary = {
    frame: Math.round(clamp(num(o.frame) ?? 1, 1, STUDIO_LAST_FRAME)),
    hour: r1(clamp(num(o.hour) ?? 12, 0, 24)),
    sky: STUDIO_SKIES.includes(o.sky as never) ? (o.sky as StudioSummary["sky"]) : "simple",
    format: typeof o.format === "string" && o.format in STUDIO_FORMATS ? (o.format as StudioFormat) : "16:9",
    lens: Math.round(clamp(num(o.lens) ?? 35, 8, 300)),
    camera,
    aim,
    range,
    objects: [],
    omitted: 0,
  };
  // Grow the list while it fits: the empty summary's length, plus each object's JSON and a comma.
  let length = JSON.stringify({ ...base, omitted: 99999 }).length;
  const kept: StudioSummaryObject[] = [];
  for (const x of ordered) {
    if (kept.length >= STUDIO_SUMMARY_MAX_OBJECTS) break;
    const add = JSON.stringify(x).length + 1;
    if (length + add > STUDIO_SUMMARY_MAX_CHARS) break;
    kept.push(x);
    length += add;
  }
  const keptIds = new Set(kept.map((x) => x.id));
  // A camera or aim cut from the list is not named.
  return {
    ...base,
    camera: camera && keptIds.has(camera) ? camera : null,
    aim: aim && keptIds.has(aim) ? aim : null,
    objects: kept,
    omitted: ordered.length - kept.length,
  };
}

function vec2(v: unknown): [number, number] {
  const a = Array.isArray(v) ? num(v[0]) : null;
  const b = Array.isArray(v) ? num(v[1]) : null;
  const start = Math.round(clamp(a ?? 1, 1, STUDIO_LAST_FRAME - 1));
  const end = Math.round(clamp(b ?? STUDIO_LAST_FRAME, start + 1, STUDIO_LAST_FRAME));
  return [start, end];
}

/** The last few turns, as sent: who spoke and their words, cut short. */
export type StudioTurn = { who: "person" | "astra"; text: string };
export function normaliseStudioTurns(raw: unknown): StudioTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => {
      const o = t && typeof t === "object" ? (t as Record<string, unknown>) : {};
      const who = o.who === "astra" ? "astra" : o.who === "person" ? "person" : null;
      const text = studioText(o.text, STUDIO_TURN_MAX_CHARS);
      return who && text ? { who, text } : null;
    })
    .filter((t): t is StudioTurn => t !== null)
    .slice(-STUDIO_TURNS_MAX);
}

// ---------------- the answer's schema (strict) ----------------

const nullableNumber = { type: ["number", "null"] };
const STEP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["say", "op", "targets", "kind", "name", "mode", "x", "y", "z", "of", "side", "value", "value2", "color", "metallic", "roughness", "emission", "points", "near"],
  properties: {
    say: { type: "string" },
    op: { type: "string", enum: [...STUDIO_OPS] },
    targets: { type: "array", items: { type: "string" } },
    kind: { type: "string" },
    name: { type: "string" },
    mode: { type: "string", enum: ["", "to", "by"] },
    x: nullableNumber,
    y: nullableNumber,
    z: nullableNumber,
    of: { type: "string" },
    side: { type: "string", enum: ["", ...STUDIO_SIDES] },
    value: nullableNumber,
    value2: nullableNumber,
    color: { type: "string" },
    metallic: nullableNumber,
    roughness: nullableNumber,
    emission: { type: "string" },
    points: { type: "array", items: { type: "array", items: { type: "number" } } },
    near: { type: "string" },
  },
} as const;

export const STUDIO_PLAN_SCHEMA_NAME = "helios_studio_plan";
export const STUDIO_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "question", "options", "steps"],
  properties: {
    reply: { type: "string" },
    question: { type: "string" },
    options: { type: "array", items: { type: "string" } },
    steps: { type: "array", items: STEP_SCHEMA },
  },
} as const;

export const STUDIO_ASTRA_INSTRUCTIONS = [
  "You are Astra, the assistant in the side panel of Helios Studio, a Blender-style 3D workspace in the browser.",
  "You change THIS 3D scene only, by planning steps the person reviews and applies (one undo for the whole plan). You never make pictures or videos: for those, tell them to use Render ▸ in the top bar. You cannot sculpt, model from photos, edit meshes, paint textures or use nodes; say so plainly with no steps. The set's own parts (a garage, the track, a wall) are whole objects: you can delete, hide, move or key them, and put things on them.",
  "",
  "The scene comes as JSON. Axes are Blender's: X right, Y away, Z up, in metres. `at` is an object's base centre (its lowest point for things on the ground), `size` its [X, Y, Z] dimensions, `turn` its heading in degrees about Z. `sel` marks the selection: \"this\", \"it\", \"these\" mean the selected objects. `camera` is the shot camera's id, `aim` what it tracks. `frame` is the current frame; frames run 1–241 at 24 fps (10 s). Objects past the cap are left out (`omitted`); never guess their ids.",
  "",
  "Answer with JSON: `reply` (one or two plain sentences saying what you will do, in the person's language), `question` (\"\" unless you must ask), `options` (short answers for the question, else []), `steps`.",
  "Ask instead of guessing when a request could mean different objects (for example two cars and none selected): put the question in `question`, the choices in `options` (use the objects' names), and give no steps.",
  "",
  "The set itself: objects with `set` are its parts, and `set` says what each is (road, marking, kerb, grass, water, ground, hill, building, wall, barrier, stand, pole, tree, prop). `top` is the height of its top surface. A road also has `along` (the way it runs, a unit [X, Y] on the ground), `width` in metres, and `segs` ([x1, y1, x2, y2, width] centre lines) when it is in pieces. \"The garage\", \"the road\", \"the grandstand\" mean these parts, by name or kind.",
  "",
  "Every step has every field; unused text fields are \"\", unused numbers null. `say` is the step in plain words (\"Add a street lamp left of the car\"). `targets` are ids from the scene, \"camera\" for the shot camera, or \"new:NAME\" for an object an earlier step of this plan added with `name` NAME.",
  "Ops (Blender axes and units throughout):",
  "- select: targets become the selection.",
  "- add: kind = cube|sphere|cylinder|cone|torus|ico_sphere|plane|empty|point_light|spot_light|street_lamp|car|person; name = its name (later steps target \"new:\"+name); place it with x,y,z (mode \"to\") OR relative to another object with of = that id and side = left|right|front|behind|above|on|near (left/right/front/behind as the shot camera sees it) and value = the gap in metres; color = \"#rrggbb\" or \"\". New things stand on the ground.",
  "- delete, hide, show: targets (objects, or parts of the set: \"remove the garage\" deletes the garage part).",
  "- place_on: targets = what to put down; of = the part (or object) whose top they stand on (\"park the car on the road\" = of the road part); kind = \"along\" (their long side down the road's `along`), \"across\", or \"\" (keep their heading); near = an id or \"camera\" to be as close to as the surface allows, or \"\"; x,y = a spot to be near instead (else null). The Studio finds the exact spot: on the top, inside its edges, clear of walls and other objects. Use it, not move, for anything that goes ON something.",
  "- duplicate: targets[0] is copied; name = the copy's name; place with x,y,z as an offset (mode \"by\") or with of/side/value.",
  "- move: mode \"to\" (x,y,z = where; a null axis keeps its value) or \"by\" (x,y,z = how far); or of/side/value to put it beside something.",
  "- rotate: degrees about X,Y,Z; mode \"to\" or \"by\"; or of = an id to turn it to face that object (\"camera\" to face the camera).",
  "- scale: factors per axis, mode \"to\" or \"by\" (multiply).",
  "- size: real dimensions in metres (x = width, y = depth, z = height); null axes follow in proportion (\"make it 4 m tall\" = z 4).",
  "- color: color = \"#rrggbb\".",
  "- material: metallic 0–1, roughness 0–1, emission = \"#rrggbb\" glow or \"\", color optional.",
  "- rename: targets[0], name = the new name.",
  "- parent: targets become children of `of`; of = \"\" clears their parent.",
  "- key: a keyframe for each target at frame `value`; mode \"to\"/\"by\" with x,y,z moves it there first (a camera, light or empty by its own origin), or mode \"\" with no x,y,z keys it where it stands; kind = linear|bezier|constant is the interpolation from THIS key to the next (Blender keeps it per keyframe: constant holds this key's place until the next key, a cut), or \"\". To animate \"over 3 seconds\": key it where it is at the current frame, then key it at frame + 72 with the move.",
  "- hour: value = time of day 0–24 (sun). sky: kind = simple|physical|studio.",
  "- lens: value = the shot camera's focal length in mm (8–300). format: kind = 16:9|2.39:1|9:16|1:1|4:5.",
  "- aim: the shot camera tracks `of` (Track To); of = \"\" stops tracking. To place the camera, move \"camera\".",
  "- view: kind = camera (look through the shot camera) or free.",
  "- array: value = count (1–50), x,y,z = spacing in metres between copies. mirror: kind = x|y|z, or \"\" to remove.",
  "- physics: kind = none|active|passive rigid body, value = mass in kg or null. simulate: run physics from the current frame. bake: simulate and keep it as keyframes.",
  "- frame: value = go to that frame. range: value = start frame, value2 = end frame for playback.",
  "People: objects with `pose` are posable people (a jointed figure; `pose` says what they are doing). Only people take these:",
  `- pose: targets = people; kind = a preset (${POSE_PRESETS.join("|")}; wave/point/hips/crossed move the arms only, so a sitting person keeps sitting), OR name = a bone and x,y,z = its angles in degrees (mode "to" or "by"). Bones: pelvis spine chest neck head, shoulder upperArm forearm hand thigh shin foot with .L (their left) or .R (their right). Angles: upperArm z 90 = arm straight out to the side, x -90 = arm straight forward; forearm x -90 = elbow bent; thigh x -90 = leg forward; shin x 90 = knee bent; neck/head y 40 = turn to their left, x -20 = look up. Joint limits hold.`,
  "- sit_on: targets = people, of = what they sit on (they sit on its nearest top, facing out). lean_on: of = what they lean on (hands on it, or their back on a tall thing). look_at: of = an id or \"camera\".",
  "- add_person: name, kind = a preset or \"\", placed like add (x,y,z or of/side). \"The stand-in\" is the person named Stand-in.",
  "- walk_to, run_to: targets = people; of = a thing to walk up to (they stop at its nearest side), OR x,y = a spot on the ground; value = start frame (null = the current frame), value2 = end frame (null = their own pace: walk 1.4 m/s, run 4 m/s; \"over 3 seconds\" from frame 1 = value 1, value2 73). They face the way they go, feet planted, and ease into a stand.",
  "- follow_path: targets = people; points = [[x,y], …] spots on the ground in order (from where they stand); kind = walk|run; value/value2 as walk_to. turn_to: of or x,y = what to face; value = start frame, value2 = end frame (null = 12 frames later). `moves` on a person lists what they already do; a new move replaces the ones it overlaps.",
  "Keep plans short and exact; use the sizes given to place things so they don't overlap. If nothing in the scene can do what they ask, say why in `reply` and give no steps.",
].join("\n");

/**
 * The person's language for Astra's words (stage 7): Picacho's locale as its
 * English name, or null for English or anything unknown. One short line at
 * the top of the input, after the cached instructions, so the cache holds.
 */
export function studioLanguage(locale: unknown): string | null {
  return locale === "es" ? "Spanish (Spain)" : locale === "pt" ? "Brazilian Portuguese" : locale === "it" ? "Italian" : null;
}

/** The request text: the person's language (when not English), the scene, the last few turns, and the person's words. */
export function studioAstraInput(text: string, summary: StudioSummary, turns: StudioTurn[], language: string | null = null): string {
  const talk = turns.map((t) => `${t.who === "person" ? "Person" : "Astra"}: ${t.text}`).join("\n");
  return [
    ...(language ? [`Write reply, question, options and every say in ${language}; names and ids stay as they are.`, ""] : []),
    "Scene:",
    JSON.stringify(summary),
    ...(talk ? ["", "Earlier in this conversation:", talk] : []),
    "",
    "The person's request:",
    text,
  ].join("\n");
}

export function studioAstraRequest(
  text: string,
  summary: StudioSummary,
  turns: StudioTurn[],
  safetyIdentifier: string | undefined,
  language: string | null = null,
): AstraJobRequest {
  return {
    instructions: STUDIO_ASTRA_INSTRUCTIONS,
    input: studioAstraInput(text, summary, turns, language),
    schemaName: STUDIO_PLAN_SCHEMA_NAME,
    schema: STUDIO_PLAN_JSON_SCHEMA as unknown as Record<string, unknown>,
    maxOutputTokens: STUDIO_ASTRA_MAX_OUTPUT_TOKENS,
    effort: "low",
    safetyIdentifier,
  };
}

// ---------------- the plan ----------------

/** Blender axes; null = "keep" (mode to) or 0 (mode by). */
export type StudioVec = { x: number | null; y: number | null; z: number | null };
export type StudioPlace = { of: string; side: StudioSide; gap: number };

export type StudioStep = { say: string } & (
  | { op: "note" }
  | { op: "select" | "delete" | "hide" | "show"; targets: string[] }
  | { op: "add"; kind: StudioAddKind; name: string | null; at: StudioVec | null; place: StudioPlace | null; color: string | null }
  | { op: "duplicate"; targets: string[]; name: string | null; by: StudioVec | null; place: StudioPlace | null }
  | { op: "move"; targets: string[]; mode: "to" | "by"; v: StudioVec | null; place: StudioPlace | null }
  | { op: "rotate"; targets: string[]; mode: "to" | "by"; v: StudioVec | null; face: string | null }
  | { op: "scale"; targets: string[]; mode: "to" | "by"; v: StudioVec }
  | { op: "size"; targets: string[]; v: StudioVec }
  | { op: "color"; targets: string[]; color: string }
  | { op: "material"; targets: string[]; metallic: number | null; roughness: number | null; emission: string | null; color: string | null }
  | { op: "rename"; targets: string[]; name: string }
  | { op: "parent"; targets: string[]; parent: string | null }
  | { op: "key"; targets: string[]; frame: number; mode: "to" | "by" | null; v: StudioVec | null; interp: (typeof STUDIO_INTERPS)[number] | null }
  | { op: "hour"; hour: number }
  | { op: "sky"; sky: (typeof STUDIO_SKIES)[number] }
  | { op: "lens"; mm: number }
  | { op: "format"; format: StudioFormat }
  | { op: "aim"; target: string | null }
  | { op: "view"; camera: boolean }
  | { op: "array"; targets: string[]; count: number; v: StudioVec }
  | { op: "mirror"; targets: string[]; axis: (typeof STUDIO_AXES)[number] | null }
  | { op: "physics"; targets: string[]; type: (typeof STUDIO_PHYSICS)[number]; mass: number | null }
  | { op: "simulate" | "bake" }
  | { op: "frame"; frame: number }
  | { op: "range"; start: number; end: number }
  | { op: "pose"; targets: string[]; preset: PosePreset | null; bone: BoneName | null; mode: "to" | "by"; v: StudioVec | null }
  | { op: "sit_on" | "lean_on" | "look_at"; targets: string[]; of: string }
  | { op: "add_person"; name: string | null; at: StudioVec | null; place: StudioPlace | null; preset: PosePreset | null }
  | { op: "walk_to" | "run_to" | "turn_to"; targets: string[]; of: string | null; at: StudioVec | null; start: number | null; end: number | null }
  | { op: "follow_path"; targets: string[]; gait: Gait; points: [number, number][]; start: number | null; end: number | null }
  | { op: "place_on"; targets: string[]; of: string; align: "along" | "across" | null; near: string | null; nearAt: StudioVec | null }
);

export type StudioPlan = {
  reply: string;
  question: string | null;
  options: string[];
  steps: StudioStep[];
};

/** What the plan may name: the scene's ids (and their names, for the words), and the shot camera. */
export type StudioKnown = { ids: Map<string, string>; camera: string | null; people?: Set<string> };
export function knownOf(summary: StudioSummary): StudioKnown {
  return { ids: new Map(summary.objects.map((o) => [o.id, o.name])), camera: summary.camera, people: new Set(summary.objects.filter((o) => o.pose).map((o) => o.id)) };
}

const POS = 500; // metres from the origin, either way
const MOVE = 500;
const DEG = 3600;
const pick = <T extends string>(v: unknown, list: readonly T[]): T | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null);
const hex = (v: unknown): string | null => (typeof v === "string" && HEX_RE.test(v.trim()) ? v.trim().toLowerCase() : null);
const unit = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : clamp(n, 0, 1);
};
function vecOf(o: Record<string, unknown>, lo: number, hi: number): StudioVec | null {
  const x = num(o.x), y = num(o.y), z = num(o.z);
  if (x === null && y === null && z === null) return null;
  const c = (v: number | null) => (v === null ? null : clamp(v, lo, hi));
  return { x: c(x), y: c(y), z: c(z) };
}
const frameOf = (v: unknown, fallback: number) => Math.round(clamp(num(v) ?? fallback, 1, STUDIO_LAST_FRAME));

/**
 * Astra's answer as a plan the Studio can show and run. Every step is
 * checked against the scene it was planned on (`known`): ids that are not
 * there — and "new:NAME" handles no earlier step made — are dropped, and a
 * step left with nothing to act on becomes a plain "I can't find …" note
 * that does nothing. Every number is clamped to what the Studio accepts; a
 * step whose op is unknown or whose values are unusable is dropped with a
 * note. The plan never grows past STUDIO_PLAN_MAX_STEPS.
 */
export function validateStudioPlan(raw: unknown, known: StudioKnown): StudioPlan {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const reply = studioText(o.reply, 400);
  const question = studioText(o.question, 300) || null;
  const options = question ? (Array.isArray(o.options) ? o.options : []).map((x) => studioText(x, 60)).filter(Boolean).slice(0, 6) : [];
  const made = new Set<string>();
  // The people this plan may pose: the scene's, and any an earlier step adds (their "new:" handles join as they are made).
  known = { ...known, people: new Set(known.people ?? []) };
  const steps: StudioStep[] = [];
  const rawSteps = question ? [] : Array.isArray(o.steps) ? o.steps.slice(0, STUDIO_PLAN_MAX_STEPS) : [];
  for (const s of rawSteps) {
    const step = stepOf(s, known, made);
    if (step) steps.push(step);
  }
  return { reply, question, options, steps };
}

function nameOfRef(ref: string, known: StudioKnown): string {
  if (ref.startsWith("new:")) return ref.slice(4);
  return known.ids.get(ref) ?? ref;
}

/** The step's refs that exist: scene ids, "camera" (as the shot camera's id), and handles made earlier. */
function resolve(ref: unknown, known: StudioKnown, made: Set<string>): string | null {
  if (typeof ref !== "string") return null;
  const r = ref.trim();
  if (r === "camera") return known.camera;
  if (known.ids.has(r)) return r;
  if (r.startsWith("new:") && made.has(r.slice(4).toLowerCase())) return `new:${r.slice(4).toLowerCase()}`;
  return null;
}

function stepOf(s: unknown, known: StudioKnown, made: Set<string>): StudioStep | null {
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  const op = pick(o.op, STUDIO_OPS);
  const say = studioText(o.say, 160);
  if (!op) return say ? { op: "note", say: `Skipped: ${say}` } : null;
  const rawTargets = Array.isArray(o.targets) ? o.targets.slice(0, 50) : [];
  const targets: string[] = [];
  const missing: string[] = [];
  for (const t of rawTargets) {
    const id = resolve(t, known, made);
    if (id) {
      if (!targets.includes(id)) targets.push(id);
    } else if (typeof t === "string" && t.trim()) missing.push(studioText(t, 40));
  }
  const cantFind = (what: string[]) => ({ op: "note" as const, say: `I can't find ${what.map((w) => `"${nameOfRef(w, known)}"`).join(", ") || "what that step names"} in the scene, so this step is skipped.` });
  const needTargets = () => (targets.length ? null : cantFind(missing));
  const mode = o.mode === "by" ? "by" : "to";
  const name = studioText(o.name, 60) || null;
  const placeOf = (): StudioPlace | null | "missing" => {
    if (typeof o.of !== "string" || !o.of.trim()) return null;
    const of = resolve(o.of, known, made);
    if (!of) return "missing";
    const side = pick(o.side, STUDIO_SIDES) ?? "near";
    return { of, side, gap: clamp(num(o.value) ?? 1, 0, 50) };
  };
  const base = { say: say || op };
  switch (op) {
    case "select":
    case "delete":
    case "hide":
    case "show":
      return needTargets() ?? { ...base, op, targets };
    case "add": {
      const kind = pick(o.kind, Object.keys(STUDIO_ADD_KINDS) as StudioAddKind[]);
      if (!kind) return { op: "note", say: `I can't add "${studioText(o.kind, 30) || "that"}" here, so this step is skipped.` };
      const place = placeOf();
      if (place === "missing") return cantFind([studioText(o.of, 40)]);
      if (name) made.add(name.toLowerCase());
      if (name && kind === "person") known.people?.add(`new:${name.toLowerCase()}`);
      return { ...base, op, kind, name, at: place ? null : vecOf(o, -POS, POS), place, color: hex(o.color) };
    }
    case "duplicate": {
      const miss = needTargets();
      if (miss) return miss;
      const place = placeOf();
      if (place === "missing") return cantFind([studioText(o.of, 40)]);
      if (name) made.add(name.toLowerCase());
      if (name && known.people?.has(targets[0])) known.people.add(`new:${name.toLowerCase()}`);
      return { ...base, op, targets: targets.slice(0, 1), name, by: place ? null : vecOf(o, -MOVE, MOVE), place };
    }
    case "move": {
      const miss = needTargets();
      if (miss) return miss;
      const place = placeOf();
      if (place === "missing") return cantFind([studioText(o.of, 40)]);
      const v = vecOf(o, mode === "to" ? -POS : -MOVE, mode === "to" ? POS : MOVE);
      if (!place && !v) return null;
      return { ...base, op, targets, mode, v: place ? null : v, place };
    }
    case "rotate": {
      const miss = needTargets();
      if (miss) return miss;
      const faceRaw = typeof o.of === "string" && o.of.trim() ? o.of : null;
      const face = faceRaw ? resolve(faceRaw, known, made) : null;
      if (faceRaw && !face) return cantFind([studioText(faceRaw, 40)]);
      const v = vecOf(o, -DEG, DEG);
      if (!face && !v) return null;
      return { ...base, op, targets, mode, v: face ? null : v, face };
    }
    case "scale": {
      const miss = needTargets();
      if (miss) return miss;
      const v = vecOf(o, 0.01, 100);
      return v ? { ...base, op, targets, mode, v } : null;
    }
    case "size": {
      const miss = needTargets();
      if (miss) return miss;
      const v = vecOf(o, 0.01, 1000);
      return v ? { ...base, op, targets, v } : null;
    }
    case "color": {
      const miss = needTargets();
      if (miss) return miss;
      const color = hex(o.color);
      return color ? { ...base, op, targets, color } : null;
    }
    case "material": {
      const miss = needTargets();
      if (miss) return miss;
      const step = { ...base, op, targets, metallic: unit(o.metallic), roughness: unit(o.roughness), emission: hex(o.emission), color: hex(o.color) };
      return step.metallic === null && step.roughness === null && step.emission === null && step.color === null ? null : step;
    }
    case "rename": {
      const miss = needTargets();
      if (miss) return miss;
      return name ? { ...base, op, targets: targets.slice(0, 1), name } : null;
    }
    case "parent": {
      const miss = needTargets();
      if (miss) return miss;
      if (typeof o.of !== "string" || !o.of.trim()) return { ...base, op, targets, parent: null };
      const parent = resolve(o.of, known, made);
      if (!parent) return cantFind([studioText(o.of, 40)]);
      const kids = targets.filter((t) => t !== parent);
      return kids.length ? { ...base, op, targets: kids, parent } : null;
    }
    case "key": {
      const miss = needTargets();
      if (miss) return miss;
      // A key with a place but no mode is keyed THERE ("key the camera at frame 1 at (−3, −9, 1.6)"), never where it stands.
      const keyMode = o.mode === "to" || o.mode === "by" ? o.mode : vecOf(o, -POS, POS) ? "to" : null;
      const v = keyMode ? vecOf(o, keyMode === "to" ? -POS : -MOVE, keyMode === "to" ? POS : MOVE) : null;
      return { ...base, op, targets, frame: frameOf(o.value, 1), mode: v ? keyMode : null, v, interp: pick(o.kind, STUDIO_INTERPS) };
    }
    case "hour": {
      const h = num(o.value);
      return h === null ? null : { ...base, op, hour: round(clamp(h, 0, 24), 0.05) };
    }
    case "sky": {
      const sky = pick(o.kind, STUDIO_SKIES);
      return sky ? { ...base, op, sky } : null;
    }
    case "lens": {
      const mm = num(o.value);
      return mm === null ? null : { ...base, op, mm: Math.round(clamp(mm, 8, 300)) };
    }
    case "format": {
      const format = typeof o.kind === "string" && o.kind in STUDIO_FORMATS ? (o.kind as StudioFormat) : null;
      return format ? { ...base, op, format } : null;
    }
    case "aim": {
      if (!known.camera) return { op: "note", say: "There's no shot camera in the scene to aim, so this step is skipped." };
      if (typeof o.of !== "string" || !o.of.trim()) return { ...base, op, target: null };
      const target = resolve(o.of, known, made);
      if (!target) return cantFind([studioText(o.of, 40)]);
      return target === known.camera ? null : { ...base, op, target };
    }
    case "view":
      return { ...base, op, camera: o.kind !== "free" };
    case "array": {
      const miss = needTargets();
      if (miss) return miss;
      const count = Math.round(clamp(num(o.value) ?? 2, 1, 50));
      return { ...base, op, targets, count, v: vecOf(o, -100, 100) ?? { x: 2, y: null, z: null } };
    }
    case "mirror": {
      const miss = needTargets();
      if (miss) return miss;
      return { ...base, op, targets, axis: pick(o.kind, STUDIO_AXES) };
    }
    case "physics": {
      const miss = needTargets();
      if (miss) return miss;
      const type = pick(o.kind, STUDIO_PHYSICS);
      if (!type) return null;
      const mass = num(o.value);
      return { ...base, op, targets, type, mass: mass === null ? null : clamp(mass, 0.01, 10_000) };
    }
    case "simulate":
    case "bake":
      return { ...base, op };
    case "frame":
      return { ...base, op, frame: frameOf(o.value, 1) };
    case "range": {
      const start = frameOf(o.value, 1);
      const end = frameOf(o.value2, STUDIO_LAST_FRAME);
      return end > start ? { ...base, op, start, end } : null;
    }
    case "pose":
    case "sit_on":
    case "lean_on":
    case "look_at": {
      const miss = needTargets();
      if (miss) return miss;
      const who = targets.filter((t) => known.people?.has(t));
      if (!who.length) return { op: "note", say: `${targets.map((t) => `"${nameOfRef(t, known)}"`).join(", ")} ${targets.length === 1 ? "isn't a person" : "aren't people"}, so this step is skipped.` };
      if (op === "pose") {
        const preset = pick(o.kind, POSE_PRESETS);
        const bone = isBone(o.name) ? o.name : null;
        const v = bone ? vecOf(o, -360, 360) : null;
        if (!preset && !(bone && v)) return { op: "note", say: `I can't pose "${studioText(o.kind, 30) || studioText(o.name, 30) || "that"}", so this step is skipped.` };
        // "to" is held inside the bone's limits here; "by" is held there by the Studio, from where the bone is.
        const held = bone && v && mode === "to" ? clampRot(bone, [v.x ?? 0, v.y ?? 0, v.z ?? 0]) : null;
        const vv = held && v ? { x: v.x === null ? null : held[0], y: v.y === null ? null : held[1], z: v.z === null ? null : held[2] } : v;
        return { ...base, op, targets: who, preset, bone, mode, v: vv };
      }
      if (typeof o.of !== "string" || !o.of.trim()) return { op: "note", say: `"${say || op}" needs something to ${op === "look_at" ? "look at" : op === "sit_on" ? "sit on" : "lean on"}, so this step is skipped.` };
      const of = resolve(o.of, known, made);
      if (!of) return cantFind([studioText(o.of, 40)]);
      if (op !== "look_at" && of === known.camera) return { op: "note", say: "Nobody can sit or lean on the shot camera, so this step is skipped." };
      const kept = who.filter((t) => t !== of);
      return kept.length ? { ...base, op, targets: kept, of } : null;
    }
    case "walk_to":
    case "run_to":
    case "turn_to":
    case "follow_path": {
      const miss = needTargets();
      if (miss) return miss;
      const who = targets.filter((t) => known.people?.has(t));
      if (!who.length) return { op: "note", say: `${targets.map((t) => `"${nameOfRef(t, known)}"`).join(", ")} ${targets.length === 1 ? "isn't a person" : "aren't people"}, so this step is skipped.` };
      // Frames: value = start (null: the current frame), value2 = end (null: the gait's own pace; a turn, 12 frames).
      const start = num(o.value) === null ? null : frameOf(o.value, 1);
      let end = num(o.value2) === null ? null : frameOf(o.value2, STUDIO_LAST_FRAME);
      if (start !== null && end !== null && end <= start) end = null;
      if (op === "follow_path") {
        const points = (Array.isArray(o.points) ? o.points : [])
          .slice(0, PATH_POINTS_MAX)
          .map((p) => (Array.isArray(p) && num(p[0]) !== null && num(p[1]) !== null ? ([clamp(p[0] as number, -POS, POS), clamp(p[1] as number, -POS, POS)] as [number, number]) : null))
          .filter((p): p is [number, number] => p !== null);
        if (!points.length) return { op: "note", say: `"${say || "That path"}" has no points to walk, so this step is skipped.` };
        return { ...base, op, targets: who, gait: o.kind === "run" ? "run" : "walk", points, start, end };
      }
      let of: string | null = null;
      if (typeof o.of === "string" && o.of.trim()) {
        of = resolve(o.of, known, made);
        if (!of) return cantFind([studioText(o.of, 40)]);
      }
      const at = of ? null : vecOf(o, -POS, POS);
      if (!of && !at) return { op: "note", say: `"${say || op}" doesn't say where to, so this step is skipped.` };
      const kept = who.filter((t) => t !== of);
      return kept.length ? { ...base, op, targets: kept, of, at, start, end } : null;
    }
    case "place_on": {
      const miss = needTargets();
      if (miss) return miss;
      if (typeof o.of !== "string" || !o.of.trim()) return { op: "note", say: `"${say || "That step"}" doesn't say what to put it on, so this step is skipped.` };
      const of = resolve(o.of, known, made);
      if (!of) return cantFind([studioText(o.of, 40)]);
      if (of === known.camera) return { op: "note", say: "Nothing can stand on the shot camera, so this step is skipped." };
      const kept = targets.filter((t) => t !== of && t !== known.camera);
      if (!kept.length) return null;
      // Near: an id or the camera (one that isn't there is left out, and the spot is nearest where it stands), or x,y.
      const nearRaw = typeof o.near === "string" && o.near.trim() ? o.near : null;
      const nearId = nearRaw ? resolve(nearRaw, known, made) : null;
      const near = nearId && !kept.includes(nearId) ? nearId : null;
      const at = vecOf(o, -POS, POS);
      const nearAt = near || !at || at.x === null || at.y === null ? null : { x: at.x, y: at.y, z: null };
      return { ...base, op, targets: kept, of, align: o.kind === "along" || o.kind === "across" ? o.kind : null, near, nearAt };
    }
    case "add_person": {
      const place = placeOf();
      if (place === "missing") return cantFind([studioText(o.of, 40)]);
      if (name) {
        made.add(name.toLowerCase());
        known.people?.add(`new:${name.toLowerCase()}`);
      }
      return { ...base, op, name, at: place ? null : vecOf(o, -POS, POS), place, preset: pick(o.kind, POSE_PRESETS) };
    }
  }
}

/**
 * Her answer's text as a plan, or null when it isn't the JSON the schema
 * asks for. `answer` is the parsed JSON itself, handed to the Studio so it
 * checks the plan again against the scene as it stands when Apply is pressed.
 */
export function parseStudioAnswer(text: string, known: StudioKnown): { plan: StudioPlan; answer: Record<string, unknown> } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const answer = raw as Record<string, unknown>;
  return { plan: validateStudioPlan(answer, known), answer };
}

/** Whether a plan changes anything: at least one step that acts (a question, a reply alone or notes only do not). */
export function planActs(plan: StudioPlan): boolean {
  return plan.steps.some((s) => s.op !== "note");
}

// ---------------- Blender axes → the Studio's (three.js, Y up) ----------------

/** A Blender-axes vector in three.js order: (x, z, −y). Null axes stay null. */
export function toThreeAxes(v: StudioVec): { x: number | null; y: number | null; z: number | null } {
  return { x: v.x, y: v.z, z: v.y === null ? null : -v.y };
}

/** Scale factors or dimensions: the same axes, no sign (a size has none). */
export function toThreeSizes(v: StudioVec): { x: number | null; y: number | null; z: number | null } {
  return { x: v.x, y: v.z, z: v.y };
}

/**
 * The uniform-or-per-axis factors that give an object these dimensions
 * (three.js axes, metres), from its current dimensions: a null axis follows
 * the others in proportion (their mean factor), as "4 m tall" scales the
 * whole thing. Returns null when the object has no size to scale from.
 */
export function sizeFactors(current: { x: number; y: number; z: number }, want: { x: number | null; y: number | null; z: number | null }): { x: number; y: number; z: number } | null {
  const f = (w: number | null, c: number) => (w === null ? null : c > 1e-6 ? w / c : null);
  const fx = f(want.x, current.x), fy = f(want.y, current.y), fz = f(want.z, current.z);
  const given = [fx, fy, fz].filter((v): v is number => v !== null);
  if (!given.length) return null;
  const mean = given.reduce((a, b) => a + b, 0) / given.length;
  const c = (v: number | null) => clamp(v ?? mean, 0.001, 1000);
  return { x: c(fx), y: c(fy), z: c(fz) };
}

/**
 * Where a thing of size `own` stands beside `ref` (three.js axes, world
 * boxes), as the shot camera sees it: `right` is the camera's right on the
 * ground, `front` towards the camera. `gap` metres between the two boxes.
 * Returns the new BASE centre (x, y = ground or top, z).
 */
export function besidePosition(
  ref: { min: [number, number, number]; max: [number, number, number] },
  own: [number, number, number],
  side: StudioSide,
  gap: number,
  camRight: [number, number],
  camToward: [number, number],
): [number, number, number] {
  const cx = (ref.min[0] + ref.max[0]) / 2, cz = (ref.min[2] + ref.max[2]) / 2;
  if (side === "above" || side === "on") return [cx, ref.max[1] + (side === "above" ? gap : 0), cz];
  // The half-extent of a box along a ground direction d: |dx|·w/2 + |dz|·d/2.
  const half = (size: [number, number, number], d: [number, number]) => (Math.abs(d[0]) * size[0] + Math.abs(d[1]) * size[2]) / 2;
  const refSize: [number, number, number] = [ref.max[0] - ref.min[0], ref.max[1] - ref.min[1], ref.max[2] - ref.min[2]];
  const norm = (d: [number, number]): [number, number] => {
    const l = Math.hypot(d[0], d[1]);
    return l > 1e-6 ? [d[0] / l, d[1] / l] : [1, 0];
  };
  const right = norm(camRight), toward = norm(camToward);
  const dir: [number, number] =
    side === "left" ? [-right[0], -right[1]] : side === "right" ? right : side === "front" ? toward : side === "behind" ? [-toward[0], -toward[1]] : right;
  const dist = half(refSize, dir) + gap + half(own, dir);
  const ground = Math.max(0, ref.min[1]);
  return [cx + dir[0] * dist, ground, cz + dir[1] * dist];
}

// ---------------- clear of walls (stage 5, 2026-09-29 — operator: "Fix walls.") ----------------
//
// "Left of the car" can land inside the set's own walls (the race track has
// a 20 m wall right beside its car), or behind them from the shot camera,
// where nobody sees it. After Astra adds, moves or copies a thing, the
// Studio looks for the nearest spot that is clear of the set's solid
// geometry and of the other things, and that the shot camera can see:
// first further along the way it was asked to go, then towards the shot
// camera, in small steps. Pure: the engine hands in the boxes and a
// visibility check (a ray from the shot camera).

/** An axis-aligned box in the Studio's (three.js) axes: [x, y, z], y up. */
export type StudioBox = { min: [number, number, number]; max: [number, number, number] };
export type StudioObstacle = StudioBox & { name: string };

/** The ground direction a side means, from the shot camera's right and "towards the camera". */
export function sideDirection(side: StudioSide, right: [number, number], toward: [number, number]): [number, number] {
  if (side === "left") return [-right[0], -right[1]];
  if (side === "front") return toward;
  if (side === "behind") return [-toward[0], -toward[1]];
  return right;
}

/** Whether two boxes share volume (touching faces, within 2 cm, do not count). */
export function boxesOverlap(a: StudioBox, b: StudioBox, eps = 0.02): boolean {
  for (let i = 0; i < 3; i++) if (a.max[i] <= b.min[i] + eps || a.min[i] >= b.max[i] - eps) return false;
  return true;
}

export const CLEAR_STEP_M = 0.25;
export const CLEAR_MAX_M = 12;

export type ClearResult = {
  /** How far to slide it on the ground (x, z), and the distance. */
  dx: number;
  dz: number;
  moved: number;
  /** Which of the directions it slid along (-1: none). */
  dir: number;
  /** What it stood inside where it was put, or null. */
  inside: string | null;
  /** Still hidden from the shot camera where it ends up. */
  hidden: boolean;
  /** Inside something, and no free spot within reach: left where it was. */
  stuck: boolean;
};

/**
 * The nearest spot for `box` that overlaps no obstacle and that `visible`
 * accepts, searched along each of `dirs` in turn (ground vectors),
 * CLEAR_STEP_M at a time up to CLEAR_MAX_M. Only x and z change, so it
 * stays on the ground. With no spot both free and seen, the nearest free
 * one (it is then still hidden); free but hidden where it was put, it
 * stays; with no free spot at all, it stays (stuck).
 */
export function clearSpot(opts: {
  box: StudioBox;
  obstacles: StudioObstacle[];
  dirs: [number, number][];
  visible?: (box: StudioBox) => boolean;
  step?: number;
  max?: number;
}): ClearResult {
  const step = opts.step ?? CLEAR_STEP_M, max = opts.max ?? CLEAR_MAX_M;
  const at = (dx: number, dz: number): StudioBox => ({
    min: [opts.box.min[0] + dx, opts.box.min[1], opts.box.min[2] + dz],
    max: [opts.box.max[0] + dx, opts.box.max[1], opts.box.max[2] + dz],
  });
  const hit = (b: StudioBox) => opts.obstacles.find((o) => boxesOverlap(b, o)) ?? null;
  const seen = (b: StudioBox) => !opts.visible || opts.visible(b);
  const inside = hit(opts.box)?.name ?? null;
  const none: ClearResult = { dx: 0, dz: 0, moved: 0, dir: -1, inside, hidden: false, stuck: false };
  if (!inside && seen(opts.box)) return none;
  let freeOnly: ClearResult | null = null;
  for (let k = 0; k < opts.dirs.length; k++) {
    const l = Math.hypot(opts.dirs[k][0], opts.dirs[k][1]);
    if (l < 1e-6) continue;
    const ux = opts.dirs[k][0] / l, uz = opts.dirs[k][1] / l;
    for (let n = 1; n * step <= max + 1e-9; n++) {
      const d = n * step, b = at(ux * d, uz * d);
      if (hit(b)) continue;
      const r: ClearResult = { dx: ux * d, dz: uz * d, moved: Math.round(d * 100) / 100, dir: k, inside, hidden: false, stuck: false };
      if (seen(b)) return r;
      if (inside && (!freeOnly || d < freeOnly.moved)) freeOnly = { ...r, hidden: true };
    }
  }
  if (!inside) return { ...none, hidden: true };
  return freeOnly ?? { ...none, stuck: true };
}

/** What the plan's step says after Apply when the Studio moved it, or couldn't ("" when there is nothing to say). */
export function clearNote(r: ClearResult, dirWords: string[]): string {
  const m = `${r.moved.toFixed(1).replace(/\.0$/, "")} m`;
  const where = dirWords[r.dir] ?? "aside";
  if (r.stuck) return `it's inside ${r.inside} and there's no free spot within ${CLEAR_MAX_M} m, so it stays there`;
  if (r.moved > 0 && !r.hidden) return r.inside ? `placed ${m} ${where} so it isn't inside ${r.inside}` : `placed ${m} ${where} so the wall doesn't hide it from the shot camera`;
  if (r.moved > 0) return `placed ${m} ${where} so it isn't inside ${r.inside}; from the shot camera it's still behind the wall`;
  if (r.hidden) return "it's behind the wall from the shot camera, and there's no clear spot nearby";
  return "";
}
