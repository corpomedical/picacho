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

/** A model file the stage will load: our own media, or an object URL made on this page. */
export function modelUrlAllowed(url: string): boolean {
  return /^blob:/.test(url) || /^\/api\/media\/[^?#]+\.glb$/i.test(url);
}
