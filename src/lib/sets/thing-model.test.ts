import { describe, expect, it } from "vitest";
import { THING_MODEL_MAX_BYTES, fitThingModel, glbHeaderOk, modelHome, modelUrlAllowed, parseModelName, setModelPath, type Box } from "./thing-model";

// A built model put where a thing's blocks stand (2026-09-24): same length,
// same ground, same axis, same place, and turned round on request.

/** Where a model's corner lands once the fit is applied (three.js's own order: scale, turn, move). */
function place(fit: ReturnType<typeof fitThingModel>, p: [number, number, number]): [number, number, number] {
  const th = (fit.turnDeg * Math.PI) / 180;
  const x = p[0] * fit.scale;
  const y = p[1] * fit.scale;
  const z = p[2] * fit.scale;
  return [fit.at[0] + fit.offset[0] + x * Math.cos(th) + z * Math.sin(th), fit.at[1] + fit.offset[1] + y, fit.at[2] + fit.offset[2] - x * Math.sin(th) + z * Math.cos(th)];
}

function footprint(fit: ReturnType<typeof fitThingModel>, model: Box) {
  const pts = [model.min[0], model.max[0]].flatMap((x) => [model.min[1], model.max[1]].flatMap((y) => [model.min[2], model.max[2]].map((z) => place(fit, [x, y, z]))));
  const lo = [0, 1, 2].map((i) => Math.min(...pts.map((q) => q[i])));
  const hi = [0, 1, 2].map((i) => Math.max(...pts.map((q) => q[i])));
  return { lo, hi };
}

// A car Astra built along x: 4.4 m long, 1.8 m wide, standing on the ground at (10, 0, -3).
const blocks: Box = { min: [7.8, 0, -3.9], max: [12.2, 1.3, -2.1] };

describe("a model on a thing", () => {
  it("comes out the blocks' length, on their ground, in their place", () => {
    // A model in its own unit box, lying along x, floating off its origin.
    const model: Box = { min: [-0.5, -0.2, -0.2], max: [0.5, 0.1, 0.2] };
    const fit = fitThingModel(model, blocks);
    expect(fit.turnDeg).toBe(0);
    expect(fit.scale).toBeCloseTo(4.4, 4);
    const { lo, hi } = footprint(fit, model);
    expect(hi[0] - lo[0]).toBeCloseTo(4.4, 3);
    expect((lo[0] + hi[0]) / 2).toBeCloseTo(10, 3);
    expect((lo[2] + hi[2]) / 2).toBeCloseTo(-3, 3);
    // Its lowest point on the blocks' lowest point: on the ground, not in it.
    expect(lo[1]).toBeCloseTo(0, 3);
    // In proportion: its own height, scaled with it.
    expect(hi[1] - lo[1]).toBeCloseTo(0.3 * 4.4, 3);
  });

  it("is turned a quarter when it was built lying across the blocks", () => {
    const model: Box = { min: [-0.2, 0, -0.5], max: [0.2, 0.3, 0.5] };
    const fit = fitThingModel(model, blocks);
    expect(fit.turnDeg).toBe(90);
    const { lo, hi } = footprint(fit, model);
    // Now long along x, like the blocks.
    expect(hi[0] - lo[0]).toBeCloseTo(4.4, 3);
    expect(hi[2] - lo[2]).toBeCloseTo(0.4 * 4.4, 3);
    expect((lo[0] + hi[0]) / 2).toBeCloseTo(10, 3);
    expect((lo[2] + hi[2]) / 2).toBeCloseTo(-3, 3);
    expect(fit.size[0]).toBeCloseTo(4.4, 3);
  });

  it("turns round by half a turn, and stays exactly where it was", () => {
    const model: Box = { min: [-0.3, 0, -0.1], max: [0.7, 0.3, 0.3] };
    const a = footprint(fitThingModel(model, blocks), model);
    const b = footprint(fitThingModel(model, blocks, true), model);
    expect(fitThingModel(model, blocks, true).turnDeg).toBe(180);
    for (const i of [0, 1, 2]) {
      expect(b.lo[i]).toBeCloseTo(a.lo[i], 3);
      expect(b.hi[i]).toBeCloseTo(a.hi[i], 3);
    }
  });

  it("holds a model with no size rather than dividing by it", () => {
    const flat: Box = { min: [0, 0, 0], max: [0, 0, 0] };
    const fit = fitThingModel(flat, blocks);
    expect(fit.scale).toBe(1);
    expect(fit.offset.every(Number.isFinite)).toBe(true);
  });
});

describe("which model files the stage loads", () => {
  it("takes our own media and a file picked on this page, nothing else", () => {
    expect(modelUrlAllowed("blob:https://picacho.ai/1f2e")).toBe(true);
    expect(modelUrlAllowed("/api/media/element-models/u/set/car.glb")).toBe(true);
    expect(modelUrlAllowed("https://example.com/car.glb")).toBe(false);
    expect(modelUrlAllowed("/api/media/x.png")).toBe(false);
    expect(modelUrlAllowed("javascript:alert(1)")).toBe(false);
    // Our media carries its signature (media/url.ts mediaUrl).
    expect(modelUrlAllowed("/api/media/generated-videos/u/sets/s.model.c_89e319be_0_-1.abc.n.glb?v=Ab_3-x")).toBe(true);
    expect(modelUrlAllowed("/api/media/x.glb?v=a&b=c")).toBe(false);
  });
});

describe("a model kept with the set", () => {
  const user = "11111111-1111-1111-1111-111111111111";
  const set = "22222222-2222-2222-2222-222222222222";
  const key = "c_89e319be_0_-1";

  it("is named by its set, its thing, its time and its turn, and read back the same", () => {
    const path = setModelPath(user, set, key, 1790205070123, true);
    expect(path.startsWith(`${user}/sets/${set}.model.${key}.`)).toBe(true);
    expect(path.endsWith(".f.glb")).toBe(true);
    const name = path.slice(`${user}/sets/`.length);
    expect(parseModelName(set, name)).toEqual({ key, at: 1790205070123, flip: true });
    expect(parseModelName(set, name.replace(".f.glb", ".n.glb"))?.flip).toBe(false);
    // Another set's model, a photo, a sheet: not a model of this set.
    expect(parseModelName("33333333-3333-3333-3333-333333333333", name)).toBeNull();
    expect(parseModelName(set, `${set}.ref.${key}.1.abc.jpg`)).toBeNull();
    expect(parseModelName(set, `${set}.model.not-a-key.abc.n.glb`)).toBeNull();
  });

  it("is kept only when it is a binary glTF of the size it says", () => {
    const glb = (size: number, version = 2) => {
      const b = new Uint8Array(12);
      b.set([0x67, 0x6c, 0x54, 0x46]);
      new DataView(b.buffer).setUint32(4, version, true);
      new DataView(b.buffer).setUint32(8, size, true);
      return b;
    };
    expect(glbHeaderOk(glb(2836), 2836)).toBe(true);
    expect(glbHeaderOk(glb(2836), 2900)).toBe(false);
    expect(glbHeaderOk(glb(2836, 1), 2836)).toBe(false);
    const jpeg = new Uint8Array(12);
    jpeg.set([0xff, 0xd8, 0xff, 0xe0]);
    expect(glbHeaderOk(jpeg, 2836)).toBe(false);
    expect(glbHeaderOk(new Uint8Array(4), 4)).toBe(false);
    expect(THING_MODEL_MAX_BYTES).toBe(40 * 1024 * 1024);
  });

  it("finds its thing after an edit moved the same blocks, and waits when it cannot be sure", () => {
    expect(modelHome(key, [{ key }, { key: "o_11111111_5_5" }])).toBe(key);
    // The same car, moved: the same blocks, another place.
    expect(modelHome(key, [{ key: "c_89e319be_30_12" }, { key: "o_11111111_5_5" }])).toBe("c_89e319be_30_12");
    // Two of the same car: which one is not certain, so neither.
    expect(modelHome(key, [{ key: "c_89e319be_30_12" }, { key: "c_89e319be_-8_4" }])).toBeNull();
    // Gone from the set.
    expect(modelHome(key, [{ key: "o_11111111_5_5" }])).toBeNull();
  });
});
