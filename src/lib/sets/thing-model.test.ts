import { describe, expect, it } from "vitest";
import { fitThingModel, modelUrlAllowed, type Box } from "./thing-model";

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
  });
});
