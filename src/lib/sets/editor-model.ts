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
import { inferMaterial } from "./stage-materials";
import {
  normaliseSetSpec,
  SET_LIMITS,
  type SetCamera,
  type SetLight,
  type SetLightKind,
  type SetMark,
  type SetObject,
  type SetShape,
  specNames,
  specTextForGate,
  type SetSpec,
  type Vec3,
  withoutName,
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
 * The words of a set that a browser may never write: its title, its
 * description, its labels (marks', then cameras', each sorted) and, since
 * Helios Cut 4, step B1, its objects' names (each once, sorted).
 */
export type EditText = { title: string; description: string; labels: string[]; names: string[] };

/**
 * A set's words as the server seals them (edit-seal.ts). Here, not there,
 * so the page can name the words of any copy it holds and find the seal the
 * server handed for them (seal-book.ts, Helios Cut 4, step A6); edit-seal.ts
 * is server-only and passes this on.
 */
export function editTextOf(spec: Pick<SetSpec, "title" | "description" | "marks" | "cameras" | "objects">): EditText {
  const labels = (xs: readonly { label: string }[]) => xs.map((x) => x.label).filter((l) => l.length > 0).sort();
  return { title: spec.title, description: spec.description, labels: [...labels(spec.marks), ...labels(spec.cameras)], names: specNames(spec) };
}

/**
 * What holdEditedText reads of a stored copy: its words alone, so the words
 * an Undo proves with a seal (edit-seal.ts, Helios Cut 2, 2026-09-25) can
 * stand first. Every SetSpec is one. `objects` (Helios Cut 4, step B1): a
 * stored copy's own objects, whose names a browser may keep and which carry
 * onto the same blocks sent without one; `names`: sealed words' names
 * (edit-seal.ts heldTextOf, a v2 seal), which a browser may keep and which
 * carry onto nothing, since sealed words hold no blocks.
 */
export type HeldText = Pick<SetSpec, "title" | "description"> & {
  marks: readonly { label: string }[];
  cameras: readonly { label: string }[];
  objects?: readonly SetObject[];
  names?: readonly string[];
};

/**
 * An object as the same block, whatever its name: every other field, in one
 * order, with a material not said read as the word the stage draws it with
 * (stage-materials.ts inferMaterial) — the word an Astra change is handed
 * for it (set-edit-prompt.ts withMaterials) and so hands back.
 */
function blockKey(o: SetObject): string {
  return JSON.stringify([o.shape, o.position, o.rotation, o.size, o.color, o.roughness, o.metalness, o.emissive, o.emissiveIntensity, o.castShadow, o.repeat, o.material ?? inferMaterial(o)]);
}

/**
 * Names carried forward (Helios Cut 4, step B1): every object of `to` with
 * no name, identical to an object of `from` apart from the name, takes that
 * object's name (the first one listed, when two identical blocks differ).
 * An object that changed — moved, resized, recoloured — takes none: it is
 * no longer what was named, until the naming pass names it again. Names
 * `to` already carries stay. The same object back when nothing is carried.
 *
 * It keeps names on everything a change did not touch: an Astra change,
 * which is sent without them (set-edit-prompt.ts) and so answers without
 * them, and every save through holdEditedText — a Build autosave from a tab
 * opened before the set was named, Aly's undo_set_change of a copy saved
 * before, undoAstraEdit's copy from before (critic item 8).
 */
export function carryNames<T extends Pick<SetSpec, "objects">>(from: { readonly objects: readonly SetObject[] }, to: T): T {
  const named = new Map<string, string>();
  for (const o of from.objects) {
    if (o.name === undefined) continue;
    const k = blockKey(o);
    if (!named.has(k)) named.set(k, o.name);
  }
  if (named.size === 0) return to;
  let carried = false;
  const objects = to.objects.map((o) => {
    if (o.name !== undefined) return o;
    const name = named.get(blockKey(o));
    if (name === undefined) return o;
    carried = true;
    return { ...o, name };
  });
  return carried ? { ...to, objects } : to;
}

/**
 * A browser's edit may move and recolour, never write: the title and
 * description come from the stored copy, and any mark or camera label the
 * stored copies never carried is dropped. Astra's own edits don't pass
 * through here — they are gated whole, like a build.
 *
 * Names too (Helios Cut 4, step B1): a name a browser sent stays only when
 * a stored copy (or the sealed words first) already carries it somewhere —
 * a block duplicated in Build keeps its name, and a browser can never
 * invent one — and every block sent without a name that a stored copy
 * holds, unchanged, under one gets it back (carryNames, the first copy's
 * first), so a save that knew nothing of names never erases them.
 */
export function holdEditedText(next: SetSpec, stored: readonly HeldText[]): SetSpec {
  let held = clone(next);
  const first = stored[0];
  if (first) {
    held.title = first.title;
    held.description = first.description;
  }
  const allowed = new Set<string>([""]);
  const names = new Set<string>();
  for (const s of stored) {
    for (const m of s.marks) allowed.add(m.label);
    for (const c of s.cameras) allowed.add(c.label);
    for (const n of s.names ?? []) names.add(n);
    for (const o of s.objects ?? []) if (o.name !== undefined) names.add(o.name);
  }
  for (const m of held.marks) if (!allowed.has(m.label)) m.label = "";
  for (const c of held.cameras) if (!allowed.has(c.label)) c.label = "";
  if (held.objects.some((o) => o.name !== undefined && !names.has(o.name))) {
    held.objects = held.objects.map((o) => (o.name !== undefined && !names.has(o.name) ? withoutName(o) : o));
  }
  for (const s of stored) if (s.objects) held = carryNames({ objects: s.objects }, held);
  return held;
}

/**
 * Whether Astra's answer leaves the set exactly as it was handed (Helios Cut
 * 4, step A1, 2026-09-26 — the owner's decision D11: an answer that changes
 * nothing does not count). No piece differs (countSpecChanges) and the gate
 * would read the same words (specTextForGate). Both, not one: a field that
 * countSpecChanges is ever taught to pass over (a name, B1) still changes the
 * words the gate reads, and such an answer is a change.
 */
export function changesNothing(before: SetSpec, after: SetSpec): boolean {
  return countSpecChanges(before, after) === 0 && specTextForGate(before) === specTextForGate(after);
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
  // A name is not a piece of the set (Helios Cut 4, step B1): naming changes nothing drawn.
  n += lists(a.objects.map(withoutName), b.objects.map(withoutName));
  n += lists(a.marks, b.marks);
  n += lists(a.cameras, b.cameras);
  return n;
}
