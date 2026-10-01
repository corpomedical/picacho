// Helios Studio's prompt bar (2026-10-01, operator: "Finalizing the UI to look
// and work like this" — Higgsfield's add-on inside Blender: a floating dark bar
// docked bottom-centre over the viewport, mode tabs on top, a text box with a
// reference picture, an engine picker, option chips and a big Generate button).
// The bar is the front door to what the Studio already has; this module holds
// the parts that can be tested without a page: its modes, the 3D Model press's
// payload, the camera moves' keys, the animation chips, and where the bar may
// stand (dragged, and never over the gizmo).
//
// Pure; imports three for the camera's aim, relative imports only (vitest has
// no "@/" alias).

import * as THREE from "three";
import {
  MODEL_DEFAULT_OPTIONS,
  MODEL_VIEWS,
  modelBuildUsd,
  modelEngine,
  modelInputProblem,
  normaliseModelOptions,
  type ModelBuildOptions,
  type ModelEngineId,
  type ModelImages,
  type ModelInputKind,
} from "./model-engines";

export type BarMode = "scene" | "model" | "anim" | "image" | "video" | "camera" | "assets";

/** The tabs, in the add-on's order. */
export const BAR_MODES: readonly { id: BarMode; label: string }[] = [
  { id: "scene", label: "Scene builder" },
  { id: "model", label: "3D Model" },
  { id: "anim", label: "Animation" },
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
  { id: "camera", label: "Camera" },
  { id: "assets", label: "Assets" },
];

export function isBarMode(v: unknown): v is BarMode {
  return BAR_MODES.some((m) => m.id === v);
}

/** The text box's words for each mode (the add-on's "Describe the model you imagine…"). */
export const BAR_PLACEHOLDERS: Record<BarMode, string> = {
  scene: "Tell Astra what to add, move, change or animate…  “this” means the selected object",
  model: "Describe the model you imagine…",
  anim: "Or say how they move: “walk to the car, then wave”…",
  image: "What happens in the photo (optional): what they're doing, the mood",
  video: "What happens in the video (optional): what they're doing, the mood",
  camera: "Or say the shot you want: “slow push in on the car”…",
  assets: "Search the set's parts, things and pictures",
};

// ---------------------------------------------------------------------------
// 3D Model: what the press sends
// ---------------------------------------------------------------------------

export type BarModelState = {
  engine: ModelEngineId;
  kind: ModelInputKind;
  prompt: string;
  /** Data URIs by view; "front" is the one photo of an Image build. */
  images: ModelImages;
  options: ModelBuildOptions;
  /** "el:<key>" of a thing of the set, or "new". */
  target: string;
};

export const BAR_MODEL_DEFAULT: BarModelState = { engine: "hunyuan-3.1-pro", kind: "image", prompt: "", images: {}, options: MODEL_DEFAULT_OPTIONS, target: "new" };

/**
 * The start door's input (model-actions.ts startStudioModelBuild) for the bar as it stands, without its press id,
 * or why it can't go yet. Only the images the kind uses are sent; the options are kept to what the engine takes.
 */
export function barModelPayload(s: BarModelState):
  | { error: string }
  | { error: null; input: { engine: ModelEngineId; kind: ModelInputKind; prompt: string; images: ModelImages; options: ModelBuildOptions; target: { key: string } | { new: true } }; usd: number } {
  const engine = modelEngine(s.engine);
  if (!engine || !engine.endpoints[s.kind]) return { error: "Pick an engine that builds from this." };
  const options = normaliseModelOptions(engine, s.options);
  const images: ModelImages = {};
  if (s.kind === "image" && s.images.front) images.front = s.images.front;
  if (s.kind === "multi") for (const v of MODEL_VIEWS) if (s.images[v]) images[v] = s.images[v];
  const prompt = s.kind === "text" ? s.prompt.trim() : "";
  const problem = modelInputProblem(engine, { kind: s.kind, prompt, images, options });
  if (problem) return { error: problem };
  const target = s.target.startsWith("el:") ? { key: s.target.slice(3) } : ({ new: true } as const);
  return { error: null, input: { engine: engine.id, kind: s.kind, prompt, images, options, target }, usd: modelBuildUsd(engine, s.kind, options) };
}

/** The first engine that builds from `kind`, keeping `engine` when it does. */
export function engineForKind(engine: ModelEngineId, kind: ModelInputKind): ModelEngineId {
  if (modelEngine(engine)?.endpoints[kind]) return engine;
  return (["hunyuan-3.1-pro", "meshy-7.1", "tripo-2.5", "trellis-2"] as const).find((id) => modelEngine(id)?.endpoints[kind]) ?? "hunyuan-3.1-pro";
}

// ---------------------------------------------------------------------------
// Camera: presets that write the shot camera's keys
// ---------------------------------------------------------------------------

export type CameraPreset = "orbit" | "push" | "pull" | "crane" | "follow" | "cuts";

export const CAMERA_PRESETS: readonly { id: CameraPreset; label: string; line: string }[] = [
  { id: "orbit", label: "Orbit", line: "Circles the subject once, at an even speed." },
  { id: "push", label: "Push in", line: "Moves in towards the subject, easing in and out." },
  { id: "pull", label: "Pull out", line: "Moves back from the subject, easing in and out." },
  { id: "crane", label: "Crane up", line: "Rises while it keeps the subject in frame." },
  { id: "follow", label: "Follow", line: "Keeps its distance as the subject moves." },
  { id: "cuts", label: "Cuts: 3 angles", line: "Three camera angles, cutting from one to the next." },
];

export type CameraForm = { distance: number; height: number; start: number; end: number };

export type CameraKey = { frame: number; p: [number, number, number]; r: [number, number, number]; ip: "bezier" | "linear" | "constant" };

type V3 = [number, number, number];

/** Clamped to what the Studio's timeline and stage hold (frames 1…last, 0.5–80 m away, 0.1–60 m up). */
export function normaliseCameraForm(f: Partial<CameraForm>, lastFrame: number): CameraForm {
  const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const start = Math.max(1, Math.min(lastFrame - 1, Math.round(n(f.start, 1))));
  const end = Math.max(start + 1, Math.min(lastFrame, Math.round(n(f.end, lastFrame))));
  return { distance: Math.max(0.5, Math.min(80, n(f.distance, 6))), height: Math.max(0.1, Math.min(60, n(f.height, 1.6))), start, end };
}

const TAU = Math.PI * 2;
/** `a` moved by whole turns to lie within π of `ref`. */
const near = (a: number, ref: number) => a + TAU * Math.round((ref - a) / TAU);

/**
 * The rotation that aims the shot camera from `p` at `look` (the Studio's shot camera is a group whose +Z is the
 * lens, and three's Object3D.lookAt turns +Z to the target), as XYZ Euler angles written the way nearest the key
 * before it — of the two triples that name one rotation, (x, y, z) and (x+π, π−y, z+π), each unwrapped — so the
 * linear blend between keys turns the short way instead of spinning.
 */
export function aimRotation(p: V3, look: V3, prev: V3 | null): V3 {
  const o = new THREE.Object3D();
  o.position.set(p[0], p[1], p[2]);
  o.lookAt(look[0], look[1], look[2]);
  const e = o.rotation;
  const a: V3 = [e.x, e.y, e.z];
  if (!prev) return a;
  const b: V3 = [e.x + Math.PI, Math.PI - e.y, e.z + Math.PI];
  const fit = (t: V3): V3 => [near(t[0], prev[0]), near(t[1], prev[1]), near(t[2], prev[2])];
  const fa = fit(a), fb = fit(b);
  const dist = (t: V3) => Math.abs(t[0] - prev[0]) + Math.abs(t[1] - prev[1]) + Math.abs(t[2] - prev[2]);
  return dist(fa) <= dist(fb) ? fa : fb;
}

/**
 * The shot camera's keys for one preset. `look` is the point it aims at (the subject's middle), `from` where the
 * camera stands now (its side of the subject is kept), `lookAt(frame)` where the subject is on a frame (Follow).
 * Orbit and Follow are keyed every few frames at linear speed; Push, Pull and Crane are two eased keys; Cuts are three
 * keys that hold (constant) and jump. Heights are the camera's own above the ground.
 */
export function cameraMoveKeys(preset: CameraPreset, form: CameraForm, look: V3, from: V3, lookAt?: (frame: number) => V3): CameraKey[] {
  const { distance: d, height: h, start, end } = form;
  const a0 = Math.atan2(from[0] - look[0], from[2] - look[2]);
  const at = (az: number, dist: number, y: number, c: V3 = look): V3 => [c[0] + Math.sin(az) * dist, y, c[2] + Math.cos(az) * dist];
  const out: CameraKey[] = [];
  let prev: V3 | null = null;
  const key = (frame: number, p: V3, l: V3, ip: CameraKey["ip"]) => {
    const r = aimRotation(p, l, prev);
    prev = r;
    out.push({ frame: Math.round(frame), p, r, ip });
  };
  const span = end - start;
  switch (preset) {
    case "orbit": {
      const n = Math.max(12, Math.min(48, Math.round(span / 5)));
      for (let i = 0; i <= n; i++) key(start + (span * i) / n, at(a0 + (TAU * i) / n, d, h), look, "linear");
      break;
    }
    case "push":
    case "pull": {
      const near1 = Math.max(0.8, d * 0.45);
      const [d0, d1] = preset === "push" ? [d, near1] : [near1, d];
      key(start, at(a0, d0, h), look, "bezier");
      key(end, at(a0, d1, h), look, "bezier");
      break;
    }
    case "crane": {
      key(start, at(a0, d, h), look, "bezier");
      key(end, at(a0, d, h + Math.max(2, d * 0.6)), look, "bezier");
      break;
    }
    case "follow": {
      const where = lookAt ?? (() => look);
      const n = Math.max(2, Math.round(span / 6));
      for (let i = 0; i <= n; i++) {
        const f = start + (span * i) / n, c = where(Math.round(f));
        key(f, at(a0, d, h, c), c, "linear");
      }
      break;
    }
    case "cuts": {
      const third = Math.max(1, Math.floor(span / 3));
      key(start, at(a0, d, h), look, "constant");
      key(start + third, at(a0 + (70 * Math.PI) / 180, d * 0.7, h), look, "constant");
      key(start + 2 * third, at(a0 - (45 * Math.PI) / 180, d * 1.1, h + 1.5), look, "constant");
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Animation: the quick chips
// ---------------------------------------------------------------------------

export type AnimChip = { id: string; label: string; needs: "target" | "none" | "click" };

export const ANIM_CHIPS: readonly AnimChip[] = [
  { id: "walkCam", label: "Walk to the camera", needs: "none" },
  { id: "walkTo", label: "Walk to…", needs: "target" },
  { id: "runTo", label: "Run to…", needs: "target" },
  { id: "walkPoint", label: "Walk to a point", needs: "click" },
  { id: "path", label: "Draw a path", needs: "click" },
  { id: "turnCam", label: "Turn to the camera", needs: "none" },
  { id: "turnTo", label: "Turn to…", needs: "target" },
  { id: "lookCam", label: "Look at the camera", needs: "none" },
  { id: "sitOn", label: "Sit on…", needs: "target" },
  { id: "leanOn", label: "Lean on…", needs: "target" },
];

// ---------------------------------------------------------------------------
// Where the bar stands
// ---------------------------------------------------------------------------

export type Rect = { left: number; top: number; width: number; height: number };

/** A dragged offset kept so the whole bar stays inside the viewport (a 6 px margin). */
export function clampBarOffset(off: { x: number; y: number }, bar: Rect, view: Rect): { x: number; y: number } {
  const m = 6;
  const minX = view.left + m - bar.left, maxX = view.left + view.width - m - (bar.left + bar.width);
  const minY = view.top + m - bar.top, maxY = view.top + view.height - m - (bar.top + bar.height);
  return { x: Math.max(Math.min(minX, maxX), Math.min(Math.max(minX, maxX), off.x)), y: Math.max(Math.min(minY, maxY), Math.min(Math.max(minY, maxY), off.y)) };
}

/**
 * How far to move the bar so it leaves the gizmo free: a circle of `radius` round the gizmo's point on screen. First
 * to the top of the viewport (the sky, where it covers least of what is being worked on), then just above the
 * gizmo, then below it, then to the side with more room; {0,0} when it doesn't touch. `top` is where the viewport's
 * own header ends, which the bar never covers.
 */
export function barAvoid(bar: Rect, point: { x: number; y: number } | null, view: Rect, radius = 72, top = 40): { x: number; y: number } {
  if (!point) return { x: 0, y: 0 };
  const r = radius;
  const hits = (dx: number, dy: number) =>
    point.x + r > bar.left + dx && point.x - r < bar.left + dx + bar.width && point.y + r > bar.top + dy && point.y - r < bar.top + dy + bar.height;
  if (!hits(0, 0)) return { x: 0, y: 0 };
  const dock = view.top + top - bar.top;
  if (dock < 0 && !hits(0, dock)) return { x: 0, y: dock };
  const up = point.y - r - (bar.top + bar.height);
  if (bar.top + up >= view.top + top) return { x: 0, y: up };
  const down = point.y + r - bar.top;
  if (bar.top + down + bar.height <= view.top + view.height - 6) return { x: 0, y: down };
  // Beside it, only when the whole bar still fits inside the viewport; else it stays where it is (never off-screen).
  const toLeft = point.x - r - (bar.left + bar.width), toRight = point.x + r - bar.left;
  if (bar.left + toLeft >= view.left + 6) return { x: toLeft, y: 0 };
  if (bar.left + toRight + bar.width <= view.left + view.width - 6) return { x: toRight, y: 0 };
  return { x: 0, y: 0 };
}
