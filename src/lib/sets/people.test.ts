import { describe, expect, it } from "vitest";
import { PATH_MAX_POINTS, alongPath, gazeWords, normaliseGaze, normalisePath, pathLength, sideOf } from "./people";
import { normaliseSetSpec } from "./set-spec";
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
