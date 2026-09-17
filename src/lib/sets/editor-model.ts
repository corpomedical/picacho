// The Set Editor's edits (2026-09-14). Pure and relative-import only, so the
// test can hold every edit to the same rules the first build obeyed.
//
// EVERY edit goes back through normaliseSetSpec — the trust boundary — before
// anything is drawn or saved: an edit is a new spec, never a patched scene.
// A change the normaliser cannot accept (an empty set, junk JSON) is refused
// whole, `{ ok: false }`, and the set in hand stands.
//
// Text is not editable here. The editor edits numbers, colours and shapes;
// the title, the description and every mark and camera label stay what the
// gated build (or a gated Astra edit) wrote — holdEditedText enforces that
// on the server for anything a browser sends.

import { kitObjects, kitSize, type KitKind } from "./kit";
import {
  normaliseSetSpec,
  SET_LIMITS,
  type SetCamera,
  type SetLight,
  type SetLightKind,
  type SetMark,
  type SetObject,
  type SetShape,
  type SetSpec,
  type Vec3,
} from "./set-spec";

/** What the editor has picked up: one thing, or one facet of the set itself. */
export type EditTarget =
  | { kind: "object"; index: number }
  | { kind: "light"; index: number }
  | { kind: "mark"; index: number }
  | { kind: "camera"; index: number }
  | { kind: "sky" }
  | { kind: "ground" }
  | { kind: "fog" };

export type EditResult = { ok: true; spec: SetSpec; notes: string[] } | { ok: false };

const clone = (spec: SetSpec): SetSpec => JSON.parse(JSON.stringify(spec)) as SetSpec;

function renormalise(raw: SetSpec): EditResult {
  const n = normaliseSetSpec(raw);
  return n.ok ? { ok: true, spec: n.spec, notes: n.notes } : { ok: false };
}

// ---------------------------------------------------------------------------
// Patches: copy, change, renormalise.
// ---------------------------------------------------------------------------

export function patchObject(spec: SetSpec, index: number, patch: Partial<SetObject>): EditResult {
  if (!spec.objects[index]) return { ok: false };
  const next = clone(spec);
  next.objects[index] = { ...next.objects[index], ...patch };
  return renormalise(next);
}

export function patchLight(spec: SetSpec, index: number, patch: Partial<SetLight>): EditResult {
  if (!spec.lights[index]) return { ok: false };
  const next = clone(spec);
  next.lights[index] = { ...next.lights[index], ...patch };
  return renormalise(next);
}

export function patchMark(spec: SetSpec, index: number, patch: Partial<Pick<SetMark, "x" | "z" | "facingDeg">>): EditResult {
  if (!spec.marks[index]) return { ok: false };
  const next = clone(spec);
  next.marks[index] = { ...next.marks[index], ...patch };
  return renormalise(next);
}

export function patchCamera(
  spec: SetSpec,
  index: number,
  patch: Partial<Pick<SetCamera, "position" | "target" | "fovDeg">>,
): EditResult {
  if (!spec.cameras[index]) return { ok: false };
  const next = clone(spec);
  next.cameras[index] = { ...next.cameras[index], ...patch };
  return renormalise(next);
}

export function patchSky(spec: SetSpec, patch: Partial<SetSpec["sky"]>): EditResult {
  const next = clone(spec);
  next.sky = { ...next.sky, ...patch };
  return renormalise(next);
}

export function patchGround(spec: SetSpec, patch: Partial<SetSpec["ground"]>): EditResult {
  const next = clone(spec);
  next.ground = { ...next.ground, ...patch };
  return renormalise(next);
}

export function patchFog(spec: SetSpec, fog: SetSpec["fog"]): EditResult {
  const next = clone(spec);
  next.fog = fog;
  return renormalise(next);
}

// ---------------------------------------------------------------------------
// Adding, doubling and removing.
// ---------------------------------------------------------------------------

/** A new shape's size, in metres — something visible and obviously placed. */
const NEW_SIZE: Record<SetShape, Vec3> = {
  box: [1, 1, 1],
  cylinder: [1, 1, 1],
  cone: [1, 1.2, 1],
  sphere: [1, 1, 1],
  torus: [1.4, 0.3, 1.4],
  capsule: [0.5, 1.6, 0.5],
  plane: [2, 0.01, 2],
};

/** A new thing, resting on the ground where the view looks. */
export function addObject(spec: SetSpec, shape: SetShape, at: [number, number]): EditResult {
  if (spec.objects.length >= SET_LIMITS.maxObjects) return { ok: false };
  const next = clone(spec);
  const size = NEW_SIZE[shape];
  next.objects.push({
    shape,
    position: [at[0], size[1] / 2, at[1]],
    rotation: [0, 0, 0],
    size: [...size],
    color: "#9a968e",
    roughness: 0.8,
    metalness: 0,
    emissive: null,
    emissiveIntensity: 1,
    castShadow: true,
    material: null,
    repeat: null,
  });
  return renormalise(next);
}

/** A prop from the kit (kit.ts), its objects added at the end; refused when it would not fit the set's object count. */
export function addKit(spec: SetSpec, kind: KitKind, at: [number, number], facingDeg = 0): EditResult {
  if (spec.objects.length + kitSize(kind) > SET_LIMITS.maxObjects) return { ok: false };
  const next = clone(spec);
  next.objects.push(...kitObjects(kind, at, facingDeg));
  return renormalise(next);
}

/** The same thing again, beside the first. */
export function duplicateObject(spec: SetSpec, index: number): EditResult {
  const o = spec.objects[index];
  if (!o || spec.objects.length >= SET_LIMITS.maxObjects) return { ok: false };
  const next = clone(spec);
  const copy = clone(spec).objects[index];
  copy.position = [o.position[0] + Math.max(0.6, o.size[0]) + 0.3, o.position[1], o.position[2]];
  next.objects.splice(index + 1, 0, copy);
  return renormalise(next);
}

/** A set keeps at least one thing: the normaliser refuses an empty one. */
export function removeObject(spec: SetSpec, index: number): EditResult {
  if (!spec.objects[index]) return { ok: false };
  const next = clone(spec);
  next.objects.splice(index, 1);
  return renormalise(next);
}

/** A new light, lit sensibly for its kind. */
export function addLight(spec: SetSpec, kind: SetLightKind): EditResult {
  if (spec.lights.length >= SET_LIMITS.maxLights) return { ok: false };
  const next = clone(spec);
  const h = spec.bounds.height;
  const base: SetLight = {
    kind,
    color: kind === "sun" ? "#fff1dc" : "#ffffff",
    intensity: kind === "sun" ? 2.2 : kind === "point" ? 60 : kind === "spot" ? 120 : 0.8,
    position: kind === "spot" ? [0, Math.max(2, h * 0.6), 0] : [spec.bounds.x * 0.3, Math.max(3, h), spec.bounds.z * 0.4],
    target: [0, 0, 0],
    groundColor: kind === "hemisphere" ? spec.ground.color : null,
    angleDeg: 35,
    distance: 0,
    size: kind === "area" ? [1.5, 1] : null,
  };
  if (kind === "area") {
    base.intensity = 12;
    base.position = [0, Math.max(2, h * 0.7), Math.max(1, spec.bounds.z * 0.3)];
    base.target = [0, 1, 0];
  }
  next.lights.push(base);
  return renormalise(next);
}

/** Removing the last light is allowed: the normaliser lights the set its default way. */
export function removeLight(spec: SetSpec, index: number): EditResult {
  if (!spec.lights[index]) return { ok: false };
  const next = clone(spec);
  next.lights.splice(index, 1);
  return renormalise(next);
}

export function addMark(spec: SetSpec, at: [number, number]): EditResult {
  if (spec.marks.length >= SET_LIMITS.maxMarks) return { ok: false };
  const next = clone(spec);
  next.marks.push({ id: "", label: "", x: at[0], z: at[1], facingDeg: 0 });
  return renormalise(next);
}

/** A set keeps at least one mark: the figure must have somewhere to stand. */
export function removeMark(spec: SetSpec, index: number): EditResult {
  if (!spec.marks[index] || spec.marks.length <= 1) return { ok: false };
  const next = clone(spec);
  next.marks.splice(index, 1);
  return renormalise(next);
}

export function addCamera(spec: SetSpec, from: { position: Vec3; target: Vec3; fovDeg: number }): EditResult {
  if (spec.cameras.length >= SET_LIMITS.maxCameras) return { ok: false };
  const next = clone(spec);
  next.cameras.push({ id: "", label: "", position: [...from.position], target: [...from.target], fovDeg: from.fovDeg });
  return renormalise(next);
}

/** A set keeps at least one camera: the page opens through one. */
export function removeCamera(spec: SetSpec, index: number): EditResult {
  if (!spec.cameras[index] || spec.cameras.length <= 1) return { ok: false };
  const next = clone(spec);
  next.cameras.splice(index, 1);
  return renormalise(next);
}

// ---------------------------------------------------------------------------
// The selection across a step of history.
// ---------------------------------------------------------------------------

const LISTS = { object: "objects", light: "lights", mark: "marks", camera: "cameras" } as const;

/** Two entries as the same thing: everything but the id, which the normaliser hands out by position. */
function sameEntry(a: unknown, b: unknown): boolean {
  const bare = (v: unknown) => JSON.stringify(v && typeof v === "object" ? { ...v, id: undefined } : v);
  return bare(a) === bare(b);
}

/**
 * What stays picked up when Undo or Redo swaps the whole set: the same
 * thing, wherever the step left it. A step that added nothing to the picked
 * thing's list and took nothing from it — a move, a turn, a colour, the
 * usual undo — keeps its place; one that did finds the thing again by what
 * it is, and lets go only of a thing the step took away. The sky, the ground
 * and the fog are always there.
 */
export function selectionAfter(sel: EditTarget | null, from: SetSpec, to: SetSpec): EditTarget | null {
  if (!sel || !("index" in sel)) return sel;
  const before: readonly unknown[] = from[LISTS[sel.kind]];
  const after: readonly unknown[] = to[LISTS[sel.kind]];
  const was = before[sel.index];
  if (was === undefined) return null;
  if (before.length === after.length) return sel;
  if (after[sel.index] !== undefined && sameEntry(after[sel.index], was)) return sel;
  const at = after.findIndex((x) => sameEntry(x, was));
  return at >= 0 ? { ...sel, index: at } : null;
}

// ---------------------------------------------------------------------------
// The gizmo's readback: a dragged mesh's transform, back into spec fields.
// ---------------------------------------------------------------------------

/** build-scene draws unit shapes scaled (unitScale); this is that map read backwards. */
export function sizeFromScale(o: SetObject, scale: { x: number; y: number; z: number }): Vec3 {
  switch (o.shape) {
    case "capsule":
      return [scale.x / 2, scale.y, scale.z / 2];
    case "plane":
      return [scale.x, o.size[1], scale.z];
    case "torus":
      // A torus is built at its real size, not scaled: the gizmo cannot size it.
      return [...o.size];
    default:
      return [scale.x, scale.y, scale.z];
  }
}

// ---------------------------------------------------------------------------
// The server's hold on text, and what an Astra edit changed.
// ---------------------------------------------------------------------------

/**
 * A browser's edit may move and recolour, never write: the title and
 * description come from the stored copy, and any mark or camera label the
 * stored copies never carried is dropped. Astra's own edits don't pass
 * through here — they are gated whole, like a build.
 */
export function holdEditedText(next: SetSpec, stored: SetSpec[]): SetSpec {
  const held = clone(next);
  const first = stored[0];
  if (first) {
    held.title = first.title;
    held.description = first.description;
  }
  const allowed = new Set<string>([""]);
  for (const s of stored) {
    for (const m of s.marks) allowed.add(m.label);
    for (const c of s.cameras) allowed.add(c.label);
  }
  for (const m of held.marks) if (!allowed.has(m.label)) m.label = "";
  for (const c of held.cameras) if (!allowed.has(c.label)) c.label = "";
  return held;
}

/** How many pieces of the set an edit touched — said, never shown as text. */
export function countSpecChanges(a: SetSpec, b: SetSpec): number {
  let n = 0;
  const differs = (x: unknown, y: unknown) => JSON.stringify(x) !== JSON.stringify(y);
  if (a.title !== b.title) n += 1;
  if (a.description !== b.description) n += 1;
  if (differs(a.sky, b.sky)) n += 1;
  if (differs(a.ground, b.ground)) n += 1;
  if (differs(a.fog, b.fog)) n += 1;
  if (differs(a.bounds, b.bounds)) n += 1;
  const lists = <T,>(xs: T[], ys: T[]) => {
    const shared = Math.min(xs.length, ys.length);
    let c = Math.abs(xs.length - ys.length);
    for (let i = 0; i < shared; i++) if (differs(xs[i], ys[i])) c += 1;
    return c;
  };
  n += lists(a.lights, b.lights);
  n += lists(a.objects, b.objects);
  n += lists(a.marks, b.marks);
  n += lists(a.cameras, b.cameras);
  return n;
}
