import { describe, expect, it } from "vitest";
import { PATH_MAX_POINTS, alongPath, gazeWords, normaliseGaze, normalisePath, pathLength, sideOf } from "./people";
import { normaliseSetSpec, type SetObject } from "./set-spec";
import { setElements } from "./elements";
import showroomOpen from "./fixtures-showroom-open.json";

// The people (cut D): where the figure looks, in words and on the stage,
// and the path it walks in the previz.

const spec = (() => {
  const r = normaliseSetSpec(showroomOpen);
  if (!r.ok) throw new Error("fixture");
  return r.spec;
})();
const mark = { x: 0, z: 0, facingDeg: 0 };

describe("the eye-line", () => {
  it("reads a gaze off stored data only when it points at something", () => {
    expect(normaliseGaze(null, 3)).toBeNull();
    expect(normaliseGaze({ at: "camera" }, 3)).toEqual({ at: "camera" });
    expect(normaliseGaze({ at: "object", index: 2 }, 3)).toEqual({ at: "object", index: 2 });
    expect(normaliseGaze({ at: "object", index: 3 }, 3)).toBeNull();
    expect(normaliseGaze({ at: "point", x: 1.23456, z: -2 }, 3)).toEqual({ at: "point", x: 1.235, z: -2 });
    expect(normaliseGaze({ at: "point", x: 1000, z: 0 }, 3)).toEqual({ at: "point", x: 200, z: 0 });
    expect(normaliseGaze({ at: "moon" }, 3)).toBeNull();
  });

  // Helios Cut 4, step A9: the thing's key rides beside the block number
  // (object-ref.ts), and a gaze stored without one loads without one.
  it("keeps a thing's key beside the block, and a gaze stored without one loads byte for byte", () => {
    const key = "c_89e319be_0_-1";
    expect(normaliseGaze({ at: "object", index: 2, key }, 3)).toEqual({ at: "object", index: 2, key });
    expect(JSON.stringify(normaliseGaze({ at: "object", index: 2 }, 3))).toBe('{"at":"object","index":2}');
    for (const bad of ["car", "c_89e319be_0", 7, null, "x_89e319be_0_-1"]) {
      expect(JSON.stringify(normaliseGaze({ at: "object", index: 2, key: bad }, 3)), String(bad)).toBe('{"at":"object","index":2}');
    }
    // The block still decides: a key never rescues a number the set doesn't have.
    expect(normaliseGaze({ at: "object", index: 3, key }, 3)).toBeNull();
    // The words read the number, as before.
    expect(gazeWords({ at: "object", index: 0, key }, spec, mark)).toBe(gazeWords({ at: "object", index: 0 }, spec, mark));
  });

  it("says which side of the figure a point lies, by its own front", () => {
    expect(sideOf(mark, { x: 0, z: 5 })).toBe("ahead");
    expect(sideOf(mark, { x: 0, z: -5 })).toBe("behind");
    expect(sideOf(mark, { x: 5, z: 0 })).toBe("left");
    expect(sideOf(mark, { x: -5, z: 0 })).toBe("right");
    // Facing +X (90°), +X is ahead and +Z is to the right.
    expect(sideOf({ x: 0, z: 0, facingDeg: 90 }, { x: 5, z: 0 })).toBe("ahead");
    expect(sideOf({ x: 0, z: 0, facingDeg: 90 }, { x: 0, z: 5 })).toBe("right");
    expect(sideOf(mark, { x: 0, z: 0 })).toBe("ahead");
  });

  it("puts the gaze in words, for a still and for the end of a take", () => {
    expect(gazeWords(null, spec, mark)).toBe("");
    expect(gazeWords({ at: "camera" }, spec, mark)).toBe("They look straight into the camera, eyes to the lens.");
    expect(gazeWords({ at: "camera" }, spec, mark, "take")).toMatch(/^By the end of the shot they look straight into the camera/);
    const o = spec.objects[0];
    expect(gazeWords({ at: "object", index: 0 }, spec, mark)).toBe(`They look at the ${o.shape} ${o.size.map((n) => Math.round(n * 10) / 10).join(" × ")} m, their eyes on it.`);
    expect(gazeWords({ at: "object", index: 999 }, spec, mark)).toBe("");
    expect(gazeWords({ at: "point", x: 5, z: 0 }, spec, mark)).toBe("They look off to their left, at something 5 m away, out of the frame.");
    expect(gazeWords({ at: "point", x: 3, z: 4 }, spec, mark)).toContain("straight ahead of them, at something 5 m away");
    expect(gazeWords({ at: "point", x: 0, z: -2 }, spec, mark)).toContain("back over their shoulder");
  });
});

// "The car" by name (Helios Cut 2, step 9, 2026-09-25 — operator: "Run,
// keep going."): a look at a block of the set's ONLY car names the car;
// with two, which one is only in the geometry, so the geometry stays.
describe("the eye-line on a car", () => {
  const els = setElements(spec);
  const car = els.find((e) => e.kind === "car");
  if (!car) throw new Error("the showroom has its car");
  const block = car.members[0][0];
  const o = spec.objects[block];
  const geometry = `They look at the ${o.shape} ${o.size.map((n) => Math.round(n * 10) / 10).join(" × ")} m, their eyes on it.`;

  it("names the only car, for a still and a take", () => {
    expect(gazeWords({ at: "object", index: block }, spec, mark, "still", els)).toBe("They look at the car, their eyes on it.");
    expect(gazeWords({ at: "object", index: block }, spec, mark, "take", els)).toBe("By the end of the shot they look at the car, their eyes on it.");
  });

  it("keeps the geometry without the set's things handed in, as every still did", () => {
    expect(gazeWords({ at: "object", index: block }, spec, mark)).toBe(geometry);
  });

  it("keeps the geometry with two cars, and for a block that is no car", () => {
    const members = [...new Set(car.members.map(([m]) => m))];
    const copies = members.map((i) => ({ ...spec.objects[i], position: [spec.objects[i].position[0] - 9, spec.objects[i].position[1], spec.objects[i].position[2]] }) as SetObject);
    const two = normaliseSetSpec({ ...spec, objects: [...spec.objects, ...copies] });
    if (!two.ok) throw new Error("two cars");
    const twoEls = setElements(two.spec);
    expect(twoEls.filter((e) => e.kind === "car")).toHaveLength(2);
    expect(gazeWords({ at: "object", index: block }, two.spec, mark, "still", twoEls)).toBe(geometry);
    const loose = els.find((e) => e.kind === "object");
    if (loose) {
      const lo = spec.objects[loose.members[0][0]];
      expect(gazeWords({ at: "object", index: loose.members[0][0] }, spec, mark, "still", els)).toContain(`the ${lo.shape} `);
    }
  });
});

describe("the path", () => {
  it("reads at most six points, each on the ground and within reach", () => {
    expect(normalisePath(null)).toEqual([]);
    expect(normalisePath([{ x: 1, z: 2 }, { x: "a", z: 1 }, { x: 3, z: 4.00001 }])).toEqual([
      { x: 1, z: 2 },
      { x: 3, z: 4 },
    ]);
    expect(normalisePath(Array.from({ length: 9 }, (_, i) => ({ x: i, z: 0 })))).toHaveLength(PATH_MAX_POINTS);
  });

  it("measures the whole walk and finds where the figure stands along it, facing the way it walks", () => {
    const from = { x: 0, z: 0 };
    const to = { x: 3, z: 4 };
    expect(pathLength(from, [], to)).toBe(5);
    expect(pathLength(from, [{ x: 3, z: 0 }], to)).toBe(7);
    // A straight walk: halfway is halfway, facing along it.
    expect(alongPath(from, [], to, 0.5)).toEqual({ x: 1.5, z: 2, facingDeg: 36.9 });
    // Through a corner at (3, 0): 3 m along the first leg, then 4 m up.
    const bent = alongPath(from, [{ x: 3, z: 0 }], to, 3 / 7);
    expect(bent.x).toBeCloseTo(3, 3);
    expect(bent.z).toBeCloseTo(0, 3);
    const up = alongPath(from, [{ x: 3, z: 0 }], to, 5 / 7);
    expect(up.x).toBeCloseTo(3, 3);
    expect(up.z).toBeCloseTo(2, 3);
    expect(up.facingDeg).toBe(0);
    expect(alongPath(from, [], to, 0)).toEqual({ x: 0, z: 0, facingDeg: 36.9 });
    expect(alongPath(from, [], to, 1)).toEqual({ x: 3, z: 4, facingDeg: 36.9 });
    // Nowhere to walk: it stands where it ends.
    expect(alongPath(to, [], to, 0.5)).toEqual({ x: 3, z: 4, facingDeg: null });
  });
});
