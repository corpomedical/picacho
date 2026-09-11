// A Set's description (Astra Sets, 2026-09-10) — and the ONE function that
// turns whatever the model wrote into something the page may draw.
//
// A Set is a reusable 3D location: Astra writes it once, as data, and
// Picacho's own fixed interpreter (build-scene.ts) turns the data into
// three.js primitives. Deliberately no textures, no URLs and no code: the
// model cannot make the browser fetch anything or run anything, so the
// content-security policy does not change and nothing it writes executes on
// the signed-in origin, where server actions spend credits.
//
// normaliseSetSpec IS THE TRUST BOUNDARY. The strict JSON schema the API
// enforces (set-builder-prompt.ts) only fixes the shape; every bound —
// counts, sizes, colours, string lengths, where cameras may stand — is
// enforced here, on every read, including specs read back from the
// database. Nothing downstream re-checks, so nothing downstream may be
// handed a spec that did not come through here.
//
// Relative imports only: vitest has no "@/" alias.

export const SET_SPEC_VERSION = 1 as const;

export const SET_SHAPES = ["box", "cylinder", "cone", "sphere", "torus", "capsule", "plane"] as const;
export type SetShape = (typeof SET_SHAPES)[number];

export const SET_LIGHT_KINDS = ["sun", "point", "spot", "ambient", "hemisphere"] as const;
export type SetLightKind = (typeof SET_LIGHT_KINDS)[number];

export const SET_SKY_KINDS = ["color", "gradient", "night"] as const;
export type SetSkyKind = (typeof SET_SKY_KINDS)[number];

export type Vec3 = [number, number, number];

export type SetLight = {
  kind: SetLightKind;
  color: string;
  intensity: number;
  /** Ignored for ambient and hemisphere. */
  position: Vec3;
  /** Where a sun or spot points. */
  target: Vec3;
  /** Hemisphere only: the colour bounced up from the ground. */
  groundColor: string | null;
  /** Spot only: the cone's half-angle. */
  angleDeg: number;
  /** Point and spot: where the light fades out, 0 = no cutoff. */
  distance: number;
};

export type SetObject = {
  shape: SetShape;
  /** The centre of the shape, metres. */
  position: Vec3;
  /** Degrees, applied X then Y then Z. */
  rotation: Vec3;
  /** Full width, height and depth, metres. */
  size: Vec3;
  color: string;
  roughness: number;
  metalness: number;
  emissive: string | null;
  emissiveIntensity: number;
  castShadow: boolean;
  /** Copies at position + i × offset, for i = 0 … count − 1. */
  repeat: { count: number; offset: Vec3 } | null;
};

/** Where a person can stand. Only ever drawn as the neutral stand-in. */
export type SetMark = { id: string; label: string; x: number; z: number; facingDeg: number };

export type SetCamera = { id: string; label: string; position: Vec3; target: Vec3; fovDeg: number };

export type SetSpec = {
  version: typeof SET_SPEC_VERSION;
  title: string;
  /** The ONLY model-written text that ever reaches a render provider — gated before it is saved. */
  description: string;
  bounds: { x: number; z: number; height: number };
  sky: { kind: SetSkyKind; colors: string[] };
  ground: { color: string; roughness: number };
  fog: { color: string; near: number; far: number } | null;
  lights: SetLight[];
  objects: SetObject[];
  marks: SetMark[];
  cameras: SetCamera[];
};

export const SET_LIMITS = {
  titleChars: 60,
  descriptionChars: 300,
  labelChars: 40,
  /** Full width of the set along x and z, metres. */
  minExtent: 2,
  maxExtent: 200,
  minHeight: 2,
  maxHeight: 100,
  /** Anything placed further out than this, on any axis, is pulled in. */
  maxCoordinate: 200,
  maxSize: 200,
  minSize: 0.01,
  maxLights: 8,
  maxObjects: 300,
  /** After repeats are expanded — what the phone's GPU actually draws. */
  maxInstances: 400,
  maxRepeat: 50,
  maxRepeatOffset: 50,
  maxMarks: 4,
  maxCameras: 6,
  minFovDeg: 20,
  maxFovDeg: 90,
  maxSkyColors: 3,
  /** A normalised spec cannot exceed this once serialised. */
  maxSpecBytes: 256 * 1024,
} as const;

export const DEFAULT_GROUND_COLOR = "#8c877d";
const NEUTRAL = "#9a968e";

const DEFAULT_SKY: Record<SetSkyKind, string[]> = {
  color: ["#b9c3cc"],
  gradient: ["#8fb3d9", "#e8e2d6"],
  night: ["#0b1020", "#1d2438"],
};

export type NormaliseResult =
  | { ok: true; spec: SetSpec; notes: string[] }
  | { ok: false; reason: "not_json" | "not_object" | "empty" | "too_large" };

// ---------------------------------------------------------------------------
// Primitive readers. Every one takes `unknown` and returns a value inside its
// range — they never throw and never pass an input through unchecked.
// ---------------------------------------------------------------------------

// Control characters and bidirectional overrides: the second can make a
// label render as something other than what it says.
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;

export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const flat = value.replace(UNSAFE_CHARS, " ").replace(/\s+/g, " ").trim();
  // By code point, so an emoji at the cut is dropped whole rather than
  // leaving half a surrogate pair on screen.
  const points = Array.from(flat);
  return points.length > max ? points.slice(0, max).join("").trim() : flat;
}

function num(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function int(value: unknown, min: number, max: number, fallback: number): number {
  return Math.round(num(value, min, max, fallback));
}

export function cleanColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  const short = v.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return fallback;
}

function vec3(value: unknown, min: number, max: number, fallback: Vec3): Vec3 {
  if (!Array.isArray(value) || value.length < 3) return [...fallback];
  return [num(value[0], min, max, fallback[0]), num(value[1], min, max, fallback[1]), num(value[2], min, max, fallback[2])];
}

function degrees(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const d = value % 360;
  return Math.round(d * 100) / 100;
}

function facing(value: unknown): number {
  const d = degrees(value);
  return d < 0 ? d + 360 : d;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// ---------------------------------------------------------------------------
// The normaliser.
// ---------------------------------------------------------------------------

/** Parse the model's text and normalise it. Tolerates a stray code fence. */
export function parseSetSpecText(text: string): NormaliseResult {
  const body = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return { ok: false, reason: "not_json" };
  }
  return normaliseSetSpec(raw);
}

/**
 * Hold a set to the drawn-shape budget by repeating its SMALLEST things
 * fewer times — never by dropping an object. Returns whether anything was
 * trimmed; a set within budget is left exactly as it was.
 *
 * Until 2026-09-11 the budget was spent in list order: every object after
 * the 400th shape was dropped whole. The first photo build of a bakery
 * listed its loaves of bread early and the street beyond its window last,
 * and the cap cut a 7 m facade and a 12 m wall, so the set came back open on
 * three sides. Walls are almost always single objects, and there are at most
 * maxObjects (300) objects against maxInstances (400) shapes, so trimming
 * repeats alone always fits: no object — no wall — is ever lost to the
 * budget. Smallest first, by an object's largest dimension; between equals,
 * the one listed later.
 */
function fitInstanceBudget(objects: SetObject[], maxInstances: number): boolean {
  let total = objects.reduce((n, o) => n + (o.repeat?.count ?? 1), 0);
  if (total <= maxInstances) return false;
  const order = objects
    .map((o, i) => ({ i, size: Math.max(o.size[0], o.size[1], o.size[2]) }))
    .sort((a, b) => a.size - b.size || b.i - a.i);
  for (const { i } of order) {
    if (total <= maxInstances) break;
    const o = objects[i];
    const count = o.repeat?.count ?? 1;
    if (count <= 1 || !o.repeat) continue;
    const next = Math.max(1, count - (total - maxInstances));
    total -= count - next;
    o.repeat = next > 1 ? { count: next, offset: o.repeat.offset } : null;
  }
  return true;
}

export function normaliseSetSpec(input: unknown): NormaliseResult {
  const root = obj(input);
  if (!root) return { ok: false, reason: "not_object" };
  const notes: string[] = [];
  const L = SET_LIMITS;

  const b = obj(root.bounds) ?? {};
  const bounds = {
    x: num(b.x, L.minExtent, L.maxExtent, 30),
    z: num(b.z, L.minExtent, L.maxExtent, 30),
    height: num(b.height, L.minHeight, L.maxHeight, 12),
  };
  const halfX = bounds.x / 2;
  const halfZ = bounds.z / 2;
  const C = L.maxCoordinate;

  const skyIn = obj(root.sky) ?? {};
  const skyKind = pick(skyIn.kind, SET_SKY_KINDS, "gradient");
  const skyColors = list(skyIn.colors)
    .slice(0, L.maxSkyColors)
    .map((c) => cleanColor(c, ""))
    .filter(Boolean);
  const sky = { kind: skyKind, colors: skyColors.length > 0 ? skyColors : [...DEFAULT_SKY[skyKind]] };

  const g = obj(root.ground) ?? {};
  const ground = { color: cleanColor(g.color, DEFAULT_GROUND_COLOR), roughness: num(g.roughness, 0, 1, 0.9) };

  const f = obj(root.fog);
  let fog: SetSpec["fog"] = null;
  if (f) {
    const near = num(f.near, 0, 1000, 10);
    const far = num(f.far, near + 1, 2000, Math.max(near + 1, 80));
    fog = { color: cleanColor(f.color, sky.colors[sky.colors.length - 1]), near, far };
  }

  const lights: SetLight[] = [];
  for (const entry of list(root.lights)) {
    if (lights.length >= L.maxLights) {
      notes.push("lights_capped");
      break;
    }
    const l = obj(entry);
    if (!l) continue;
    const kind = pick(l.kind, SET_LIGHT_KINDS, "point");
    if (typeof l.kind !== "string" || !(SET_LIGHT_KINDS as readonly string[]).includes(l.kind)) continue;
    const maxIntensity = kind === "ambient" || kind === "hemisphere" ? 5 : kind === "sun" ? 10 : 500;
    lights.push({
      kind,
      color: cleanColor(l.color, "#ffffff"),
      intensity: num(l.intensity, 0, maxIntensity, kind === "point" || kind === "spot" ? 20 : 1),
      position: vec3(l.position, -C, C, [0, Math.min(bounds.height, 8), 0]),
      target: vec3(l.target, -C, C, [0, 0, 0]),
      groundColor: kind === "hemisphere" ? cleanColor(l.groundColor, ground.color) : null,
      angleDeg: num(l.angleDeg, 5, 80, 35),
      distance: num(l.distance, 0, 500, 0),
    });
  }
  if (lights.length === 0) {
    notes.push("default_lights");
    lights.push(
      {
        kind: "hemisphere",
        color: "#eef2ff",
        intensity: 0.9,
        position: [0, 0, 0],
        target: [0, 0, 0],
        groundColor: ground.color,
        angleDeg: 35,
        distance: 0,
      },
      {
        kind: "sun",
        color: "#fff1dc",
        intensity: 2.2,
        position: [halfX * 0.6, bounds.height, halfZ * 0.8],
        target: [0, 0, 0],
        groundColor: null,
        angleDeg: 35,
        distance: 0,
      },
    );
  }

  const objects: SetObject[] = [];
  for (const entry of list(root.objects)) {
    if (objects.length >= L.maxObjects) {
      notes.push("objects_capped");
      break;
    }
    const o = obj(entry);
    if (!o) continue;
    if (typeof o.shape !== "string" || !(SET_SHAPES as readonly string[]).includes(o.shape)) continue;
    const size = vec3(o.size, L.minSize, L.maxSize, [1, 1, 1]);
    let repeat: SetObject["repeat"] = null;
    const r = obj(o.repeat);
    if (r) {
      const count = int(r.count, 1, L.maxRepeat, 1);
      if (count > 1) {
        repeat = { count, offset: vec3(r.offset, -L.maxRepeatOffset, L.maxRepeatOffset, [1, 0, 0]) };
      }
    }
    objects.push({
      shape: o.shape as SetShape,
      position: vec3(o.position, -C, C, [0, size[1] / 2, 0]),
      rotation: [0, 1, 2].map((i) => degrees(list(o.rotation)[i])) as Vec3,
      size,
      color: cleanColor(o.color, NEUTRAL),
      roughness: num(o.roughness, 0, 1, 0.8),
      metalness: num(o.metalness, 0, 1, 0),
      emissive: o.emissive == null ? null : cleanColor(o.emissive, "") || null,
      emissiveIntensity: num(o.emissiveIntensity, 0, 10, 1),
      castShadow: o.castShadow === true,
      repeat,
    });
  }
  if (objects.length === 0) return { ok: false, reason: "empty" };
  if (fitInstanceBudget(objects, L.maxInstances)) notes.push("repeat_truncated");

  // Marks stand ON the set: pulled inside its footprint. Ids are ours, by
  // position — never the model's, which the page would otherwise key on.
  const marks: SetMark[] = [];
  for (const entry of list(root.marks)) {
    if (marks.length >= L.maxMarks) break;
    const m = obj(entry);
    if (!m) continue;
    const n = marks.length + 1;
    marks.push({
      id: `m${n}`,
      label: cleanText(m.label, L.labelChars),
      x: num(m.x, -halfX, halfX, 0),
      z: num(m.z, -halfZ, halfZ, 0),
      facingDeg: facing(m.facingDeg),
    });
  }
  if (marks.length === 0) {
    notes.push("default_mark");
    marks.push({ id: "m1", label: "", x: 0, z: 0, facingDeg: 0 });
  }

  // Cameras may stand a little outside the footprint (a wide from the
  // doorway) but not miles away, never under the ground, and never looking
  // at themselves.
  const camReachX = halfX + 10;
  const camReachZ = halfZ + 10;
  const cameras: SetCamera[] = [];
  const first = marks[0];
  for (const entry of list(root.cameras)) {
    if (cameras.length >= L.maxCameras) break;
    const c = obj(entry);
    if (!c) continue;
    const p = vec3(c.position, -C, C, [first.x, 1.6, first.z + 6]);
    const position: Vec3 = [
      Math.min(camReachX, Math.max(-camReachX, p[0])),
      Math.min(bounds.height * 2, Math.max(0.2, p[1])),
      Math.min(camReachZ, Math.max(-camReachZ, p[2])),
    ];
    let target = vec3(c.target, -C, C, [first.x, 1.4, first.z]);
    if (Math.hypot(target[0] - position[0], target[1] - position[1], target[2] - position[2]) < 0.1) {
      target = [first.x, 1.4, first.z];
      if (Math.hypot(target[0] - position[0], target[1] - position[1], target[2] - position[2]) < 0.1) {
        target = [position[0], position[1], position[2] - 1];
      }
    }
    const n = cameras.length + 1;
    cameras.push({
      id: `c${n}`,
      label: cleanText(c.label, L.labelChars),
      position,
      target,
      fovDeg: num(c.fovDeg, L.minFovDeg, L.maxFovDeg, 40),
    });
  }
  if (cameras.length === 0) {
    notes.push("default_camera");
    cameras.push({
      id: "c1",
      label: "",
      position: [first.x, 1.6, Math.min(camReachZ, first.z + 6)],
      target: [first.x, 1.4, first.z],
      fovDeg: 40,
    });
  }

  const spec: SetSpec = {
    version: SET_SPEC_VERSION,
    title: cleanText(root.title, L.titleChars),
    description: cleanText(root.description, L.descriptionChars),
    bounds,
    sky,
    ground,
    fog,
    lights,
    objects,
    marks,
    cameras,
  };
  if (JSON.stringify(spec).length > L.maxSpecBytes) return { ok: false, reason: "too_large" };
  return { ok: true, spec, notes };
}

/** How many meshes the spec draws once repeats are expanded. */
export function specInstanceCount(spec: SetSpec): number {
  return spec.objects.reduce((n, o) => n + (o.repeat?.count ?? 1), 0);
}

/**
 * Every piece of model-written text a person will read, joined for ONE
 * gate reading: the description (which also reaches a render provider) and
 * the title and labels (which are only shown on screen).
 */
export function specTextForGate(spec: SetSpec): string {
  return [
    spec.title,
    spec.description,
    ...spec.cameras.map((c) => c.label),
    ...spec.marks.map((m) => m.label),
  ]
    .filter((s) => s.length > 0)
    .join("\n");
}

// ---------------------------------------------------------------------------
// The person's own arrangement: where they moved the stand-in and the
// cameras they placed. Stored beside the spec, never merged into it, so the
// model's version is always recoverable — and normalised by the same rules.
// ---------------------------------------------------------------------------

export type SetLayout = {
  markId: string;
  mark: { x: number; z: number; facingDeg: number };
  camera: { position: Vec3; target: Vec3; fovDeg: number } | null;
};

export function normaliseSetLayout(input: unknown, spec: SetSpec): SetLayout | null {
  const root = obj(input);
  if (!root) return null;
  const markId = typeof root.markId === "string" && spec.marks.some((m) => m.id === root.markId)
    ? root.markId
    : spec.marks[0].id;
  const base = spec.marks.find((m) => m.id === markId) ?? spec.marks[0];
  const m = obj(root.mark) ?? {};
  const halfX = spec.bounds.x / 2;
  const halfZ = spec.bounds.z / 2;
  const mark = {
    x: num(m.x, -halfX, halfX, base.x),
    z: num(m.z, -halfZ, halfZ, base.z),
    facingDeg: facing(m.facingDeg ?? base.facingDeg),
  };
  const c = obj(root.camera);
  let camera: SetLayout["camera"] = null;
  if (c) {
    const reachX = halfX + 10;
    const reachZ = halfZ + 10;
    const p = vec3(c.position, -reachX - reachZ, reachX + reachZ, [0, 1.6, 6]);
    const position: Vec3 = [
      Math.min(reachX, Math.max(-reachX, p[0])),
      Math.min(spec.bounds.height * 2, Math.max(0.2, p[1])),
      Math.min(reachZ, Math.max(-reachZ, p[2])),
    ];
    const target = vec3(c.target, -SET_LIMITS.maxCoordinate, SET_LIMITS.maxCoordinate, [mark.x, 1.4, mark.z]);
    if (Math.hypot(target[0] - position[0], target[1] - position[1], target[2] - position[2]) >= 0.1) {
      camera = { position, target, fovDeg: num(c.fovDeg, SET_LIMITS.minFovDeg, SET_LIMITS.maxFovDeg, 40) };
    }
  }
  return { markId, mark, camera };
}
