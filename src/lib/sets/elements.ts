// The set's things (the per-thing reference photos, R1, 2026-09-21): the
// cars, the objects and the person a reference photo can belong to.
//
// WHAT A THING IS. The look's own tested rule (look-cutout.ts): prop copies
// whose boxes come within LOOK_TOUCH_M of each other are one thing, and
// structure — a wall, a floor, the track, anything too long, too broad or
// too tall, or a run longer than LOOK_GROUP_MAX_M — is never one. So the
// race track's car, 25 objects and 48 copies, is one thing, on every set
// ever built, with no change to what Astra writes. A thing is a CAR when 4
// to 6 of its own blocks are tyres (vehicles.ts isTyre) and it is 2.5 to
// 6.5 m long, a VEHICLE with 3 or more tyres otherwise, else an OBJECT. Two
// cars parked touching are one vehicle; its card says so. A body over 6 m
// (a bus, a lorry) is structure by the look's rule, its wheels objects.
//
// ITS KEY. `k_fingerprint_x_z`: the kind's letter, a fingerprint of its
// blocks' shapes, sizes, colours and materials (never where they stand),
// and the middle of its box in decimetres. A photo keeps the key it was put
// on in its file name (set-config.ts setElementPhotoPath), and
// resolvePhotos finds its thing again after the set changes: the same key;
// else the same blocks moved (a unique fingerprint, or clearly the
// nearest); else a thing of the same family standing where it stood
// (changed: "make it red"); else the photo is on nothing, never sent, and
// always shown.
//
// WHERE IT STANDS. elementPlaces reads each thing through a still's camera
// by the look's own visibility rules — in front of the lens, not behind
// structure, inside the frame — and planSheets chooses which things' sheets
// ride a still and names each by where it stands, in Picacho's own words:
// the third of the frame, its rank from the camera among every thing seen
// in that third, an object's height, a car's pose (vehicles.ts). Model
// written words never name a thing in a render prompt.
//
// Pure and relative-import only: the page and the server share it.

import type { SetObject, SetSpec, Vec3 } from "./set-spec";
import { LOOK_GROUP_MAX_M, entersOnTheWay, normaliseShotCamera, objectsOf, placedCopies, sketchProjector, type FrameBox, type LookSet, type Placed, type ShotCamera } from "./look-cutout";
import { describeVehicle, isTyre, VEHICLE_POSE_PATTERN, type Vehicle } from "./vehicles";
import { textKey } from "./film";
import { colourWord, type ColourId } from "./colour-words";
import { fill } from "./fill";
import { CAMERA_RANK_WORDS, FRAME_THIRD_WORDS } from "./thing-words";

/** The person's own element: the stand-in, played by a character (never a loose photo). */
export const FIGURE_KEY = "figure";
/** Photos per thing: a front and up to three more sides — the shape Kling's element slot takes (docs/HELIOS_REHEARSAL_PLAN.md §3.1). */
export const ELEMENT_PHOTOS_MAX = 4;
/**
 * Sheets one still carries. Two until the paid proof times a render with
 * more: a still with four pictures took 60 s, a fifth "ran past a minute"
 * (expression-set.ts), and the identity check can render it twice.
 */
export const ELEMENT_SHEETS_PER_STILL = 2;
/**
 * The picture lanes the things' sheets ride (generations/actions.ts
 * elementImageUrls): GPT Image, and Nano Banana Pro since the operator asked
 * for it in Helios (2026-09-24), which takes the same one list of pictures
 * last-to-first as the words number them.
 */
export const SHEET_LANES = ["gpt-image", "gemini"] as const;
export const ELEMENT_KEY_RE = /^([cvo])_([0-9a-f]{8})_(-?\d{1,4})_(-?\d{1,4})$/;

export type ElementKind = "car" | "vehicle" | "object";

export type SetElement = {
  key: string;
  kind: ElementKind;
  /** Its number among things of its kind, by the spec's order: "Car 2", "Object 3". */
  ordinal: number;
  /** [object index, copy] of every block it is made of. */
  members: [number, number][];
  min: Vec3;
  max: Vec3;
  centre: Vec3;
  /** Where its thumbnail floats: over the middle of its top. */
  anchor: Vec3;
  fingerprint: string;
  tyres: number;
};

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
const cm = (v: number) => Math.round(v * 100);
/** What a block is, never where it stands. */
const signature = (o: SetObject) => `${o.shape}|${o.size.map(cm).join(",")}|${o.color}|${o.material ?? ""}|${o.emissive ?? ""}`;
const letter: Record<ElementKind, string> = { car: "c", vehicle: "v", object: "o" };
const r2 = (n: number) => Math.round(n * 100) / 100;

/** The set's things, in the spec's order. */
export function setElements(spec: Pick<SetSpec, "objects" | "bounds">): SetElement[] {
  const placed = placedCopies(spec.objects, spec.bounds);
  const groups = objectsOf(placed.filter((p) => p.prop)).filter((g) =>
    [0, 1, 2].every((i) => Math.max(...g.map((p) => p.max[i])) - Math.min(...g.map((p) => p.min[i])) <= LOOK_GROUP_MAX_M),
  );
  const found = groups.map((g) => {
    const min = [0, 1, 2].map((i) => Math.min(...g.map((p) => p.min[i]))) as Vec3;
    const max = [0, 1, 2].map((i) => Math.max(...g.map((p) => p.max[i]))) as Vec3;
    const centre = [0, 1, 2].map((i) => r2((min[i] + max[i]) / 2)) as Vec3;
    const members = g.map((p) => [p.object, p.copy] as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const fingerprint = fnv(members.map(([o]) => fnv(signature(spec.objects[o]))).sort().join(";"));
    const tyres = members.filter(([o]) => isTyre(spec.objects[o])).length;
    const length = Math.max(max[0] - min[0], max[2] - min[2]);
    const kind: ElementKind = tyres >= 4 && tyres <= 6 && length >= 2.5 && length <= 6.5 ? "car" : tyres >= 3 ? "vehicle" : "object";
    const key = `${letter[kind]}_${fingerprint}_${Math.round(centre[0] * 10)}_${Math.round(centre[2] * 10)}`;
    const anchor: Vec3 = [centre[0], r2(max[1] + 0.15), centre[2]];
    return { key, kind, ordinal: 0, members, min, max, centre, anchor, fingerprint, tyres };
  });
  found.sort((a, b) => a.members[0][0] - b.members[0][0] || a.members[0][1] - b.members[0][1]);
  const counts: Record<ElementKind, number> = { car: 0, vehicle: 0, object: 0 };
  for (const e of found) e.ordinal = ++counts[e.kind];
  return found;
}

/**
 * A thing's name (Helios Cut 4, step B1): the name most of its blocks carry,
 * counted per copy, so a repeated block counts as often as it is drawn;
 * between names carried equally, the one on its largest block (by volume;
 * the first listed between equals); null when none of its blocks is named.
 * Blocks without a name don't vote. Never part of its key: names are not
 * in a block's signature, so naming a set moves no photo.
 */
export function thingNameOf(el: Pick<SetElement, "members">, spec: Pick<SetSpec, "objects">): string | null {
  const count = new Map<string, number>();
  for (const [oi] of el.members) {
    const name = spec.objects[oi]?.name;
    if (name !== undefined) count.set(name, (count.get(name) ?? 0) + 1);
  }
  if (count.size === 0) return null;
  const top = Math.max(...count.values());
  const tied = new Set([...count].filter(([, n]) => n === top).map(([name]) => name));
  if (tied.size === 1) return [...tied][0];
  let best: string | null = null;
  let volume = -1;
  for (const [oi] of el.members) {
    const o = spec.objects[oi];
    if (!o?.name || !tied.has(o.name)) continue;
    const v = o.size[0] * o.size[1] * o.size[2];
    if (v > volume) {
      volume = v;
      best = o.name;
    }
  }
  return best;
}

/** A thing's largest block by volume, the first listed between equals (turn-plan.ts largestObjectOf's rule), or null. */
export function largestBlockOf(el: Pick<SetElement, "members">, objects: readonly Pick<SetObject, "size">[]): number | null {
  let best: number | null = null;
  let volume = -1;
  for (const [o] of el.members) {
    const size = objects[o]?.size;
    if (!size) continue;
    const v = size[0] * size[1] * size[2];
    if (v > volume) {
      volume = v;
      best = o;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// One naming rule (Helios Cut 4, step B2, 2026-09-26). The set page, the
// chat's replies, Aly and the chat reader each named a thing by its own
// copy of "Car", "Car 2"; now each reads labelOf, which adds its name when
// the set gives it one and its colour, so a named set says "Red sports
// car" everywhere and an unnamed one keeps "Car 2" and gains "red". A name
// never groups or splits things: the things, their keys and their photos
// are exactly setElements'.
// ---------------------------------------------------------------------------

/** How a thing is named: its name or its kind and number, and its colour. */
export type ThingLabel = {
  key: string;
  /** Its name (thingNameOf), as written; null when none of its blocks has one. */
  name: string | null;
  kind: ElementKind;
  /** Its number among things of its kind (setElements' ordinal)… */
  ordinal: number;
  /** …said only when the set has several of its kind: "Car 2", else "Car". */
  several: boolean;
  /** Among the set's things with the same name (ignoring case), which it is, from 1 in the set's order; 0 without a name. The second is "Red sports car 2". */
  sameNameIndex: number;
  /** Its largest block's colour word (colour-words.ts). */
  colour: ColourId;
  /** Its largest block: what a menu's row for it points at (the words then name that block, critic item 7). */
  largest: number;
};

/** Every thing's label, in setElements' order. */
export function thingLabels(spec: Pick<SetSpec, "objects">, els: readonly SetElement[]): ThingLabel[] {
  const seen = new Map<string, number>();
  return els.map((el) => {
    const name = thingNameOf(el, spec);
    let sameNameIndex = 0;
    if (name !== null) {
      const k = name.toLowerCase();
      sameNameIndex = (seen.get(k) ?? 0) + 1;
      seen.set(k, sameNameIndex);
    }
    const largest = largestBlockOf(el, spec.objects) ?? el.members[0][0];
    return {
      key: el.key,
      name,
      kind: el.kind,
      ordinal: el.ordinal,
      several: els.filter((e) => e.kind === el.kind).length > 1,
      sameNameIndex,
      colour: colourWord(spec.objects[largest]?.color ?? ""),
      largest,
    };
  });
}

/** One thing's label (thingLabels). */
export function labelOf(el: SetElement, els: readonly SetElement[], spec: Pick<SetSpec, "objects">): ThingLabel {
  return thingLabels(spec, els).find((l) => l.key === el.key)!;
}

/** A name as a label shows it: its first letter capitalised, the rest as written (other scripts: the first letter only). */
export function capitalised(name: string): string {
  const [first = "", ...rest] = Array.from(name);
  return first.toUpperCase() + rest.join("");
}

/** The words a label is said with, in the person's language (sets.cast). */
export type ThingWords = { car: string; carN: string; vehicle: string; vehicleN: string; object: string; objectN: string; namedN: string };

/**
 * A thing's name on screen: its name, capitalised, with its number when
 * another thing has the same name ("Red sports car 2"); else "Car" alone,
 * "Car 2" among several, the same for vehicles and objects. Filled in one
 * pass, so a name is never read as a template.
 */
export function thingLabelText(l: ThingLabel, w: ThingWords): string {
  if (l.name !== null) {
    const shown = capitalised(l.name);
    return l.sameNameIndex > 1 ? fill(w.namedN, { name: shown, n: l.sameNameIndex }) : shown;
  }
  if (l.kind === "car") return l.several ? fill(w.carN, { n: l.ordinal }) : w.car;
  if (l.kind === "vehicle") return l.several ? fill(w.vehicleN, { n: l.ordinal }) : w.vehicle;
  return l.several ? fill(w.objectN, { n: l.ordinal }) : w.object;
}

/**
 * A thing as a list row or a menu row names it: a named thing by its name;
 * an unnamed one by its kind and number and, after them, its colour
 * ("Car 2 · red"), so two cars can be told apart before any name is written.
 */
export function thingRowText(l: ThingLabel, w: ThingWords, colours: Record<ColourId, string>): string {
  const text = thingLabelText(l, w);
  return l.name !== null ? text : `${text} · ${colours[l.colour]}`;
}

/** The blocks of the set itself: every object none of whose copies is part of a thing (what a tap on the stage calls "Part of the set"). */
export function setOwnBlocks(spec: Pick<SetSpec, "objects">, els: readonly SetElement[]): number[] {
  const inThing = new Set(els.flatMap((e) => e.members.map(([o]) => o)));
  return spec.objects.flatMap((_, i) => (inThing.has(i) ? [] : [i]));
}

/** A named part of the set: its blocks of the set itself carrying one name (ignoring case), and the largest of them. */
export type SetPart = { name: string; objects: number[]; largest: number };

/**
 * The set's named parts ("grandstand", "pit wall"), in the set's order:
 * the blocks of the set itself grouped by their name. Only named blocks are
 * parts; the rest of the set itself has none until the naming pass names
 * it. A name is shown as the first block of the group wrote it.
 */
export function setParts(spec: Pick<SetSpec, "objects">, els: readonly SetElement[]): SetPart[] {
  const parts = new Map<string, SetPart>();
  for (const i of setOwnBlocks(spec, els)) {
    const o = spec.objects[i];
    if (o.name === undefined) continue;
    const k = o.name.toLowerCase();
    const part = parts.get(k);
    if (part) part.objects.push(i);
    else parts.set(k, { name: o.name, objects: [i], largest: i });
  }
  for (const part of parts.values()) part.largest = largestBlockOf({ members: part.objects.map((o) => [o, 0]) }, spec.objects) ?? part.objects[0];
  return [...parts.values()];
}

/**
 * A part as a turn of the chat points at it (Helios Cut 4, step B3): "s:"
 * and its name in lower case, the way setParts groups it. It lives only in
 * a reading, a turn's plan and its chips; it is never stored: an eye-line
 * on a part keeps the part's block by number, the stored shape old code
 * reads (object-ref.ts; critic items 7 and 21).
 */
export const PART_KEY_PREFIX = "s:";
export const partKeyOf = (name: string): string => `${PART_KEY_PREFIX}${name.toLowerCase()}`;
export const isPartKey = (key: string): boolean => key.startsWith(PART_KEY_PREFIX);

/** A named part with where it stands: each copy of each of its blocks on the ground (a repeated barrier is two long boxes, never one box between them), and the box round them all. */
export type PartShape = SetPart & { key: string; footprints: { min: Vec3; max: Vec3 }[]; min: Vec3; max: Vec3 };

/** The set's named parts (setParts, in the set's order), each with its blocks' boxes as placed (look-cutout.ts placedCopies). */
export function partShapes(spec: Pick<SetSpec, "objects" | "bounds">, els: readonly SetElement[]): PartShape[] {
  const parts = setParts(spec, els);
  if (parts.length === 0) return [];
  const placed = placedCopies(spec.objects, spec.bounds);
  return parts.map((p) => {
    const footprints = placed.filter((c) => p.objects.includes(c.object)).map((c) => ({ min: c.min, max: c.max }));
    const min = [0, 1, 2].map((i) => Math.min(...footprints.map((f) => f.min[i]))) as Vec3;
    const max = [0, 1, 2].map((i) => Math.max(...footprints.map((f) => f.max[i]))) as Vec3;
    return { ...p, key: partKeyOf(p.name), footprints, min, max };
  });
}

/** Which thing each block copy belongs to, as "object:copy" → key. */
export function copyToElement(els: readonly SetElement[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of els) for (const [oi, copy] of e.members) out.set(`${oi}:${copy}`, e.key);
  return out;
}

// ---------------------------------------------------------------------------
// Photos on things.
// ---------------------------------------------------------------------------

/** One reference photo as stored: the key it was put on (null for a photo from before R1), its slot, when it came. */
export type ElementPhoto = { refId: string; anchor: string | null; slot: 1 | 2 | 3 | 4 | null; at: number; url: string };

export type HeldPhotos = {
  key: string;
  /** The photos that ride, front first, at most ELEMENT_PHOTOS_MAX. */
  photos: ElementPhoto[];
  /** Any past the four: shown, never sent. */
  extra: ElementPhoto[];
  /** How the photos found this thing: its own key, the same blocks moved, or a changed thing where it stood. */
  how: "exact" | "moved" | "changed";
  /** The sheet these photos make (set-config.ts setElementSheetPath): only the photos decide it. */
  sheetHash: string;
};

export type LoosePhoto = { photo: ElementPhoto; why: "unassigned" | "gone" | "ambiguous" | "taken" };

/** How far a changed thing's middle may stand from where its photos were put, metres: a car's, an object's. */
const CHANGED_REACH_M = { vehicle: 1.0, object: 0.5 } as const;
/** A moved thing is found only when the nearest match is clearly nearer than the next, metres. */
const MOVED_MARGIN_M = 0.5;

const family = (k: ElementKind) => (k === "object" ? "object" : "vehicle");
const kindOfLetter = (l: string): ElementKind => (l === "c" ? "car" : l === "v" ? "vehicle" : "object");

/** The sheet a thing's photos make: a key of their ids, front first. */
export function sheetHashOf(photos: readonly ElementPhoto[]): string {
  return textKey(photos.map((p) => p.refId).join(","));
}

/** Which thing each photo is on now, and the photos on nothing. */
export function resolvePhotos(els: readonly SetElement[], photos: readonly ElementPhoto[]): { held: HeldPhotos[]; loose: LoosePhoto[] } {
  const loose: LoosePhoto[] = [];
  const byAnchor = new Map<string, ElementPhoto[]>();
  for (const p of photos) {
    if (!p.anchor) {
      loose.push({ photo: p, why: "unassigned" });
      continue;
    }
    byAnchor.set(p.anchor, [...(byAnchor.get(p.anchor) ?? []), p]);
  }
  const claimed = new Map<string, { how: HeldPhotos["how"]; photos: ElementPhoto[] }>();
  const byKey = new Map(els.map((e) => [e.key, e]));
  const pending: [string, ElementPhoto[]][] = [];
  // Exact matches first: a thing that holds its own photos never takes followers.
  for (const [anchor, ps] of byAnchor) {
    if (byKey.has(anchor)) claimed.set(anchor, { how: "exact", photos: ps });
    else pending.push([anchor, ps]);
  }
  for (const [anchor, ps] of pending.sort((a, b) => a[0].localeCompare(b[0]))) {
    const m = ELEMENT_KEY_RE.exec(anchor);
    if (!m) {
      for (const p of ps) loose.push({ photo: p, why: "gone" });
      continue;
    }
    const [, l, fp, xs, zs] = m;
    const x = Number(xs) / 10;
    const z = Number(zs) / 10;
    const dist = (e: SetElement) => Math.hypot(e.centre[0] - x, e.centre[2] - z);
    let target: SetElement | null = null;
    let why: LoosePhoto["why"] = "gone";
    const same = els.filter((e) => e.fingerprint === fp).sort((a, b) => dist(a) - dist(b));
    if (same.length === 1 || (same.length > 1 && dist(same[1]) - dist(same[0]) >= MOVED_MARGIN_M)) {
      target = same[0];
    } else if (same.length > 1) {
      why = "ambiguous";
    }
    let how: HeldPhotos["how"] = "moved";
    if (!target && why !== "ambiguous") {
      const fam = family(kindOfLetter(l));
      const reach = CHANGED_REACH_M[fam];
      const near = els
        .filter((e) => family(e.kind) === fam)
        .filter((e) => (x >= e.min[0] && x <= e.max[0] && z >= e.min[2] && z <= e.max[2]) || dist(e) <= reach)
        .sort((a, b) => dist(a) - dist(b));
      if (near.length > 0) {
        target = near[0];
        how = "changed";
      }
    }
    if (target && claimed.has(target.key)) {
      for (const p of ps) loose.push({ photo: p, why: "taken" });
      continue;
    }
    if (!target) {
      for (const p of ps) loose.push({ photo: p, why });
      continue;
    }
    claimed.set(target.key, { how, photos: ps });
  }
  const held: HeldPhotos[] = [];
  for (const e of els) {
    const c = claimed.get(e.key);
    if (!c) continue;
    const sorted = [...c.photos].sort((a, b) => (a.slot ?? 9) - (b.slot ?? 9) || a.at - b.at || a.refId.localeCompare(b.refId));
    const ride = sorted.slice(0, ELEMENT_PHOTOS_MAX);
    held.push({ key: e.key, photos: ride, extra: sorted.slice(ELEMENT_PHOTOS_MAX), how: c.how, sheetHash: sheetHashOf(ride) });
  }
  return { held, loose };
}

/**
 * The things an edit changed that are drawn from their own photos (Helios
 * Cut 4, step A7): each thing holding photos after the edit whose blocks
 * are not what they were — its fingerprint moved (a shape, a size, a colour,
 * a material, a block more or less) — while the same photos were on it
 * before. Its sheet rides its stills and the sketch draws it grey
 * (set-shot-prompt.ts), so its colour in a still follows the photos, not
 * the edit. Read from the blocks, never from words: a thing only moved, or
 * one whose photos found it only now, says nothing. Keys of `after`, in its order.
 */
export function photoThingsChanged(before: readonly SetElement[], after: readonly SetElement[], photos: readonly ElementPhoto[]): string[] {
  const printBefore = new Map(before.map((e) => [e.key, e.fingerprint]));
  const was = new Map<string, string>();
  for (const h of resolvePhotos(before, photos).held) for (const p of [...h.photos, ...h.extra]) was.set(p.refId, printBefore.get(h.key) ?? "");
  const printAfter = new Map(after.map((e) => [e.key, e.fingerprint]));
  return resolvePhotos(after, photos)
    .held.filter((h) => [...h.photos, ...h.extra].some((p) => was.has(p.refId) && was.get(p.refId) !== printAfter.get(h.key)))
    .map((h) => h.key);
}

// ---------------------------------------------------------------------------
// Where things stand in a still, and which sheets ride it.
// ---------------------------------------------------------------------------

export type ElementPlace =
  | { key: string; seen: true; box: FrameBox; share: number; across: "left" | "middle" | "right"; depthM: number; heightM: number }
  | { key: string; seen: false; why: "behind" | "out" | "hidden" };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
function clip(b: FrameBox): FrameBox | null {
  const c = { u0: clamp01(b.u0), v0: clamp01(b.v0), u1: clamp01(b.u1), v1: clamp01(b.v1) };
  return c.u1 > c.u0 && c.v1 > c.v0 ? c : null;
}

/** Where each thing stands through a still's camera, by the look's own visibility rules. */
export function elementPlaces(spec: LookSet, els: readonly SetElement[], camera: ShotCamera): ElementPlace[] {
  const cam = normaliseShotCamera(camera);
  if (!cam) return els.map((e) => ({ key: e.key, seen: false, why: "out" }));
  const project = sketchProjector(cam);
  const placed = placedCopies(spec.objects, spec.bounds);
  const structure = placed.filter((p) => !p.prop);
  const byCopy = new Map<string, Placed>(placed.map((p) => [`${p.object}:${p.copy}`, p]));
  return els.map((e): ElementPlace => {
    const boxes: FrameBox[] = [];
    let behind = 0;
    let hidden = 0;
    for (const [oi, copy] of e.members) {
      const p = byCopy.get(`${oi}:${copy}`);
      if (!p) continue;
      const seen = p.corners.map(project);
      if (seen.some((s) => s === null)) {
        behind++;
        continue;
      }
      if (structure.some((s) => entersOnTheWay(cam.position, p.centre, s))) {
        hidden++;
        continue;
      }
      const us = seen.map((s) => s!.u);
      const vs = seen.map((s) => s!.v);
      const box = clip({ u0: Math.min(...us), v0: Math.min(...vs), u1: Math.max(...us), v1: Math.max(...vs) });
      if (box) boxes.push(box);
    }
    if (boxes.length === 0) return { key: e.key, seen: false, why: behind === e.members.length ? "behind" : hidden > 0 ? "hidden" : "out" };
    const box = { u0: Math.min(...boxes.map((b) => b.u0)), v0: Math.min(...boxes.map((b) => b.v0)), u1: Math.max(...boxes.map((b) => b.u1)), v1: Math.max(...boxes.map((b) => b.v1)) };
    const u = (box.u0 + box.u1) / 2;
    return {
      key: e.key,
      seen: true,
      box,
      share: (box.u1 - box.u0) * (box.v1 - box.v0),
      across: u < 1 / 3 ? "left" : u > 2 / 3 ? "right" : "middle",
      depthM: Math.hypot(e.centre[0] - cam.position[0], e.centre[1] - cam.position[1], e.centre[2] - cam.position[2]),
      heightM: e.max[1] - e.min[1],
    };
  });
}

export type SheetPlan =
  | { key: string; status: "rides"; sheet: number }
  | { key: string; status: "no-room" }
  | { key: string; status: "alike"; like: number }
  | { key: string; status: "not-in-frame"; why: "behind" | "out" | "hidden" };

/**
 * Two things are too alike to tell apart in words when they stand in the
 * same third, are of the same kind, within 0.2 m of each other's height
 * and within 15% of each other's distance: the later one's sheet is not
 * sent, and its chip says so.
 */
export const ALIKE_HEIGHT_M = 0.2;
export const ALIKE_DEPTH_RATIO = 1.15;

// The sheets' place words, shared with a still's words for a thing since Helios Cut 4, step B5 (thing-words.ts): the same words, byte for byte.
const THIRD = FRAME_THIRD_WORDS;
const RANK = CAMERA_RANK_WORDS;

/**
 * Which things' sheets ride a still, in sheet order, and the sentence that
 * names each by where it stands. Things are taken in the person's saved
 * order, then by how much of the frame they fill, then by key; one too
 * alike to an accepted thing, or past the budget, is not sent. The rank
 * from the camera counts every thing seen in that third, with photos or
 * without, so it is true of the sketch.
 */
export function planSheets(i: {
  els: readonly SetElement[];
  places: readonly ElementPlace[];
  withPhotos: readonly string[];
  order?: readonly string[];
  vehicles: readonly Vehicle[];
  camera: { position: Vec3; target: Vec3; fovDeg: number };
  budget: number;
}): { plan: SheetPlan[]; sentences: string[] } {
  const byKey = new Map(i.els.map((e) => [e.key, e]));
  const placeOf = new Map(i.places.map((p) => [p.key, p]));
  const plan: SheetPlan[] = [];
  const order = i.order ?? [];
  const rankOf = (k: string) => {
    const at = order.indexOf(k);
    return at === -1 ? Number.POSITIVE_INFINITY : at;
  };
  const candidates: Extract<ElementPlace, { seen: true }>[] = [];
  for (const key of i.withPhotos) {
    const place = placeOf.get(key);
    if (!place || !byKey.has(key)) continue;
    if (!place.seen) plan.push({ key, status: "not-in-frame", why: place.why });
    else candidates.push(place);
  }
  candidates.sort((a, b) => rankOf(a.key) - rankOf(b.key) || b.share - a.share || a.key.localeCompare(b.key));
  const accepted: Extract<ElementPlace, { seen: true }>[] = [];
  for (const c of candidates) {
    const kind = byKey.get(c.key)!.kind;
    const twin = accepted.findIndex(
      (a) =>
        a.across === c.across &&
        byKey.get(a.key)!.kind === kind &&
        Math.abs(a.heightM - c.heightM) < ALIKE_HEIGHT_M &&
        Math.max(a.depthM, c.depthM) / Math.min(a.depthM, c.depthM) < ALIKE_DEPTH_RATIO,
    );
    if (twin !== -1) {
      plan.push({ key: c.key, status: "alike", like: twin + 1 });
      continue;
    }
    if (accepted.length >= i.budget) {
      plan.push({ key: c.key, status: "no-room" });
      continue;
    }
    accepted.push(c);
    plan.push({ key: c.key, status: "rides", sheet: accepted.length });
  }
  const seenAll = i.places.filter((p): p is Extract<ElementPlace, { seen: true }> => p.seen);
  const sentences = accepted.map((c, n) => {
    const e = byKey.get(c.key)!;
    const inThird = seenAll.filter((p) => p.across === c.across).sort((a, b) => a.depthM - b.depthM);
    const rank = inThird.findIndex((p) => p.key === c.key);
    const depth = inThird.length > 1 && rank >= 0 && rank < RANK.length ? `, ${RANK[rank]}` : "";
    const height = e.kind === "object" ? `, ${(Math.round(c.heightM * 10) / 10).toFixed(1)} m tall` : "";
    const v = e.kind !== "object" && e.tyres <= 6 ? i.vehicles.find((w) => w.x >= e.min[0] && w.x <= e.max[0] && w.z >= e.min[2] && w.z <= e.max[2]) : undefined;
    const pose = v ? describeVehicle(v, i.camera) : null;
    const lead = accepted.length === 1 ? "That sheet" : `Sheet ${n + 1}`;
    return `${lead} is the ${e.kind} ${THIRD[c.across]}${depth}${height}${pose ? `, which ${pose}` : ""}.`;
  });
  return { plan, sentences };
}

/**
 * What became of each thing with photos in one still (R1, 2026-09-21):
 * its sheet rode (as sheet n), or it did not and why — no room left,
 * too alike to sheet n, behind the camera, out of the frame, hidden behind
 * the set, its sheet not drawn, a picture model that takes no sheets, or
 * planned but not sent by the render lane.
 */
export type ShotElementStatus = {
  key: string;
  status: "rode" | "no-room" | "alike" | "behind" | "out" | "hidden" | "no-sheet" | "model" | "not-sent";
  sheet?: number;
  like?: number;
};

/**
 * planSheets for a real shot: only a thing whose sheet is already drawn
 * can ride. A riding thing whose sheet is missing becomes "no-sheet" and
 * the plan is made again without it, so the next thing takes its place and
 * the numbering and the depth words stay true. With no camera nothing is
 * in the frame; with a budget of 0 (a picture model that takes no sheets)
 * every thing in the frame says "model".
 */
export function planShotSheets(i: {
  els: readonly SetElement[];
  held: readonly HeldPhotos[];
  sheets: readonly string[];
  order?: readonly string[];
  vehicles: readonly Vehicle[];
  shotCamera: ShotCamera | null;
  poseCamera: { position: Vec3; target: Vec3; fovDeg: number } | null;
  budget: number;
  spec: LookSet;
}): { riding: { key: string; hash: string }[]; sentences: string[]; statuses: ShotElementStatus[] } {
  const hashOf = new Map(i.held.filter((h) => h.photos.length > 0).map((h) => [h.key, h.sheetHash]));
  if (hashOf.size === 0) return { riding: [], sentences: [], statuses: [] };
  if (!i.shotCamera) return { riding: [], sentences: [], statuses: [...hashOf.keys()].map((key) => ({ key, status: "out" })) };
  const places = elementPlaces(i.spec, i.els, i.shotCamera);
  const camera = i.poseCamera ?? i.shotCamera;
  const drawn = new Set(i.sheets);
  const missing: string[] = [];
  for (;;) {
    const planned = planSheets({
      els: i.els,
      places,
      withPhotos: [...hashOf.keys()].filter((k) => !missing.includes(k)),
      order: i.order,
      vehicles: i.vehicles,
      camera,
      budget: i.budget,
    });
    const gone = planned.plan.filter((p) => p.status === "rides" && !drawn.has(hashOf.get(p.key)!)).map((p) => p.key);
    if (gone.length > 0) {
      missing.push(...gone);
      continue;
    }
    const statuses: ShotElementStatus[] = planned.plan.map((p) =>
      p.status === "rides"
        ? { key: p.key, status: "rode", sheet: p.sheet }
        : p.status === "alike"
          ? { key: p.key, status: "alike", like: p.like }
          : p.status === "no-room"
            ? { key: p.key, status: i.budget > 0 ? "no-room" : "model" }
            : { key: p.key, status: p.why },
    );
    for (const key of missing) statuses.push({ key, status: "no-sheet" });
    const riding = planned.plan.flatMap((p) => (p.status === "rides" ? [{ key: p.key, hash: hashOf.get(p.key)! }] : []));
    return { riding, sentences: planned.sentences, statuses };
  }
}

/** Every sentence planSheets can write, anchored to its whole form (set-shot-prompt.ts strips it for the brand-rule check). */
export const ELEMENT_NAMING_SENTENCE = new RegExp(
  "(?:That sheet|Sheet [1-9]) is the (?:car|vehicle|object) (?:at the left|in the middle|at the right) of the frame" +
    `(?:, (?:${RANK.join("|")}))?` +
    "(?:, \\d{1,3}\\.\\d m tall)?" +
    `(?:, which ${VEHICLE_POSE_PATTERN})?\\.`,
  "g",
);
