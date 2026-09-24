// Real models on the stage (2026-09-24, "every thing is a model"): a thing
// that has a model built for it is drawn as that model instead of the
// blocks Astra built it from. A generated model comes in its own frame — any
// size, any heading, its middle wherever it fell — so it is fitted to the
// blocks it replaces: the same length, standing on the same ground, lying
// along the same axis, in the same place. Its front is the one thing the
// blocks cannot say (a box-built car looks the same from both ends), so the
// person can turn it round by half a turn.
//
// Pure: the stage (set-view.tsx setThingModels) and the tests share it.

import type { Vec3 } from "./set-spec";

export type Box = { min: Vec3; max: Vec3 };

/** A model on a thing: where its file is, and whether it is turned round. */
export type ThingModel = { key: string; url: string; flip: boolean };

/**
 * How to put a model where a thing's blocks stand. The model is a child of a
 * group standing at `at` (the middle of the blocks' footprint, on their
 * lowest point); inside the group it is turned `turnDeg` about the upright,
 * scaled by `scale`, and moved by `offset` — so its own middle lands on the
 * group's and its lowest point on the ground.
 */
export type ModelFit = { at: Vec3; turnDeg: number; scale: number; offset: Vec3; size: Vec3 };

const r4 = (n: number) => {
  const v = Math.round(n * 10000) / 10000;
  return v === 0 ? 0 : v;
};

export function fitThingModel(model: Box, blocks: Box, flip = false): ModelFit {
  const m = [0, 1, 2].map((i) => Math.max(0, model.max[i] - model.min[i]));
  const t = [0, 1, 2].map((i) => Math.max(0, blocks.max[i] - blocks.min[i]));
  // Its long side along the blocks' long side: a car built nose-to-camera
  // lies across the track until it is turned a quarter.
  const modelLongX = m[0] >= m[2];
  const blocksLongX = t[0] >= t[2];
  const turnDeg = (modelLongX === blocksLongX ? 0 : 90) + (flip ? 180 : 0);
  // The same length as the blocks, and in proportion: the length is what a
  // car or a table is, and the model's own proportions are its design.
  const modelLong = Math.max(m[0], m[2]);
  const blocksLong = Math.max(t[0], t[2]);
  const scale = modelLong > 0 && blocksLong > 0 ? blocksLong / modelLong : 1;
  const th = (turnDeg * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const mx = (model.min[0] + model.max[0]) / 2;
  const mz = (model.min[2] + model.max[2]) / 2;
  // three.js's own turn about +Y: x' = x·cos + z·sin, z' = −x·sin + z·cos.
  const offset: Vec3 = [r4(-scale * (mx * c + mz * s)), r4(-scale * model.min[1]), r4(-scale * (-mx * s + mz * c))];
  const quarter = turnDeg % 180 !== 0;
  const size: Vec3 = [r4(scale * (quarter ? m[2] : m[0])), r4(scale * m[1]), r4(scale * (quarter ? m[0] : m[2]))];
  const at: Vec3 = [r4((blocks.min[0] + blocks.max[0]) / 2), r4(blocks.min[1]), r4((blocks.min[2] + blocks.max[2]) / 2)];
  return { at, turnDeg: turnDeg % 360, scale: r4(scale), offset, size };
}

/**
 * The same model, flat for the sketch (build-scene.ts sketchStage): its own
 * paint, nothing metal and nothing glossy. The sketch is lit without the
 * sky's light, and a metal surface with nothing to reflect draws black —
 * the first real model on this stage (2026-09-23) came out a black shape.
 * Its colour is its design, so the colour is what the sketch keeps.
 */
export const SKETCH_MODEL_MATERIAL = { metalness: 0, roughness: 1 } as const;

/** A model file the stage will load: our own media (with its signature), or an object URL made on this page. */
export function modelUrlAllowed(url: string): boolean {
  return /^blob:/.test(url) || /^\/api\/media\/[^?#]+\.glb(\?v=[A-Za-z0-9_-]+)?$/i.test(url);
}

// ---------------------------------------------------------------------------
// Kept with the set (2026-09-24): a model is a file beside the set's other
// files — no table, no column; the folder is the list, as the things' photos
// are (references.ts). One model per thing: a new one replaces it.
// ---------------------------------------------------------------------------

/** Where models live: the bucket that already keeps our 3D files (angle-stage.ts proxies), with no type limit on it. */
export const THING_MODEL_BUCKET = "generated-videos";
/** The largest model file kept: the same ceiling as an Angle Stage proxy. */
export const THING_MODEL_MAX_BYTES = 40 * 1024 * 1024;

/** A kept model's name: the set, the thing's key, when, and whether it is turned round. */
export const THING_MODEL_NAME = /^([cvo]_[0-9a-f]{8}_-?\d{1,4}_-?\d{1,4})\.([0-9a-z]{1,10})\.([fn])\.glb$/;

/** Every kept model of a set starts with this, in the owner's own sets folder. */
export function setModelPrefix(setId: string): string {
  return `${setId}.model.`;
}

/** Where a thing's model is kept: its owner's folder, its set, its key, its time, its turn. */
export function setModelPath(userId: string, setId: string, key: string, stamp: number, flip: boolean): string {
  return `${userId}/sets/${setModelPrefix(setId)}${key}.${Math.max(0, Math.floor(stamp)).toString(36)}.${flip ? "f" : "n"}.glb`;
}

/** What a kept model's file name says, or null for anything else in the folder. */
export function parseModelName(setId: string, name: string): { key: string; at: number; flip: boolean } | null {
  const prefix = setModelPrefix(setId);
  if (!name.startsWith(prefix)) return null;
  const m = THING_MODEL_NAME.exec(name.slice(prefix.length));
  if (!m) return null;
  return { key: m[1], at: parseInt(m[2], 36), flip: m[3] === "f" };
}

/**
 * Whether a file is a binary glTF model and says it is the size it is: the
 * "glTF" mark, version 2, and a length that is the file's own. Anything else
 * is not kept — a renamed picture would otherwise sit in the set as a model.
 */
export function glbHeaderOk(head: Uint8Array, size: number): boolean {
  if (head.length < 12) return false;
  const mark = head[0] === 0x67 && head[1] === 0x6c && head[2] === 0x54 && head[3] === 0x46;
  const view = new DataView(head.buffer, head.byteOffset, 12);
  return mark && view.getUint32(4, true) === 2 && view.getUint32(8, true) === size;
}

/**
 * The thing a kept model belongs to on the set as it stands: its own key, or
 * — when the set was edited and the same blocks moved — the one thing with
 * the same blocks. Null when nothing matches for certain: the model waits,
 * rather than landing on the wrong thing.
 */
export function modelHome(key: string, els: readonly { key: string }[]): string | null {
  if (els.some((e) => e.key === key)) return key;
  const same = key.split("_").slice(0, 2).join("_");
  const moved = els.filter((e) => e.key.split("_").slice(0, 2).join("_") === same);
  return moved.length === 1 ? moved[0].key : null;
}
