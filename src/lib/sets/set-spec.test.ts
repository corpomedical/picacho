import { describe, expect, it } from "vitest";
import {
  normaliseSetLayout,
  normaliseSetSpec,
  parseSetSpecText,
  SET_LIMITS,
  specInstanceCount,
  specTextForGate,
  type SetSpec,
} from "./set-spec";
import rainyMarket from "./fixtures-rainy-market.json";

// normaliseSetSpec is the trust boundary between what GPT-6 Astra writes
// and what the page draws. The fixture is a REAL answer: the first live
// build on Picacho's key (2026-09-10, effort low, $0.296).

const ok = (input: unknown): SetSpec => {
  const r = normaliseSetSpec(input);
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  return r.spec;
};

const box = (over: Record<string, unknown> = {}) => ({
  shape: "box",
  position: [0, 0.5, 0],
  rotation: [0, 0, 0],
  size: [1, 1, 1],
  color: "#888888",
  roughness: 0.5,
  metalness: 0,
  emissive: null,
  emissiveIntensity: 0,
  castShadow: true,
  repeat: null,
  ...over,
});

describe("the real Astra answer", () => {
  const r = normaliseSetSpec(rainyMarket);

  it("normalises with nothing clamped away", () => {
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notes).toEqual([]);
    expect(r.spec.objects.length).toBe((rainyMarket as { objects: unknown[] }).objects.length);
  });

  it("expands to the measured 176 shapes, under the phone budget", () => {
    if (!r.ok) throw new Error("fixture");
    expect(specInstanceCount(r.spec)).toBe(176);
    expect(specInstanceCount(r.spec)).toBeLessThanOrEqual(SET_LIMITS.maxInstances);
  });

  it("is stable: normalising a normalised set changes nothing", () => {
    if (!r.ok) throw new Error("fixture");
    expect(ok(JSON.parse(JSON.stringify(r.spec)))).toEqual(r.spec);
  });

  it("parses from the model's text, code fence or not", () => {
    const text = JSON.stringify(rainyMarket);
    expect(parseSetSpecText(text).ok).toBe(true);
    expect(parseSetSpecText("```json\n" + text + "\n```").ok).toBe(true);
  });
});

describe("refusals", () => {
  it("refuses what is not a set", () => {
    expect(parseSetSpecText("not json")).toEqual({ ok: false, reason: "not_json" });
    expect(normaliseSetSpec(null)).toEqual({ ok: false, reason: "not_object" });
    expect(normaliseSetSpec([box()])).toEqual({ ok: false, reason: "not_object" });
    expect(normaliseSetSpec({ objects: [] })).toEqual({ ok: false, reason: "empty" });
    expect(normaliseSetSpec({ objects: [{ shape: "teapot" }] })).toEqual({ ok: false, reason: "empty" });
  });
});

describe("bounds on everything the model controls", () => {
  it("drops unknown shapes and light kinds instead of guessing", () => {
    const s = ok({
      objects: [box(), { ...box(), shape: "script" }, { ...box(), shape: "<img>" }],
      lights: [{ kind: "laser", intensity: 5 }, { kind: "sun", intensity: 2 }],
    });
    expect(s.objects).toHaveLength(1);
    expect(s.lights.map((l) => l.kind)).toEqual(["sun"]);
  });

  it("clamps every number, and replaces non-numbers", () => {
    const s = ok({
      bounds: { x: 1e9, z: -5, height: Number.NaN },
      objects: [
        box({ position: [1e9, -1e9, "3"], size: [0, 1e6, -1], roughness: 7, metalness: -1, emissiveIntensity: 1e3 }),
      ],
    });
    expect(s.bounds).toEqual({ x: SET_LIMITS.maxExtent, z: SET_LIMITS.minExtent, height: 12 });
    const o = s.objects[0];
    expect(o.position[0]).toBe(SET_LIMITS.maxCoordinate);
    expect(o.position[1]).toBe(-SET_LIMITS.maxCoordinate);
    expect(o.position[2]).toBe(0);
    expect(o.size).toEqual([SET_LIMITS.minSize, SET_LIMITS.maxSize, SET_LIMITS.minSize]);
    expect([o.roughness, o.metalness, o.emissiveIntensity]).toEqual([1, 0, 10]);
  });

  it("accepts only #rrggbb colours (and expands #rgb)", () => {
    const s = ok({
      objects: [
        box({ color: "url(javascript:alert(1))" }),
        box({ color: "#ABC" }),
        box({ color: "red" }),
        box({ emissive: "#ffcc00" }),
        box({ emissive: "expression()" }),
      ],
    });
    expect(s.objects.map((o) => o.color)).toEqual(["#9a968e", "#aabbcc", "#9a968e", "#888888", "#888888"]);
    expect(s.objects.map((o) => o.emissive)).toEqual([null, null, null, "#ffcc00", null]);
  });

  it("caps objects, lights, marks and cameras", () => {
    const s = ok({
      objects: Array.from({ length: 1000 }, () => box()),
      lights: Array.from({ length: 50 }, () => ({ kind: "point", intensity: 10 })),
      marks: Array.from({ length: 20 }, (_, i) => ({ label: `m${i}`, x: 0, z: 0, facingDeg: 0 })),
      cameras: Array.from({ length: 20 }, () => ({ label: "c", position: [0, 2, 5], target: [0, 1, 0], fovDeg: 40 })),
    });
    expect(s.objects.length).toBe(SET_LIMITS.maxObjects);
    expect(s.lights.length).toBe(SET_LIMITS.maxLights);
    expect(s.marks.length).toBe(SET_LIMITS.maxMarks);
    expect(s.cameras.length).toBe(SET_LIMITS.maxCameras);
  });

  it("holds the drawn total to the instance budget, truncating repeats", () => {
    const s = ok({
      objects: Array.from({ length: 20 }, () => box({ repeat: { count: 50, offset: [1, 0, 0] } })),
    });
    expect(specInstanceCount(s)).toBe(SET_LIMITS.maxInstances);
    expect(s.objects.every((o) => (o.repeat?.count ?? 1) <= SET_LIMITS.maxRepeat)).toBe(true);
  });

  it("never drops a wall to the shape budget: the smallest things are repeated fewer times instead", () => {
    // The first photo build's shape: loaves of bread listed first, the
    // street beyond the window last. The old list-order cap cut the walls.
    const loaf = (i: number) => box({ size: [0.3, 0.15, 0.2], position: [i * 0.1, 1, 0], repeat: { count: 20, offset: [0.35, 0, 0] } });
    const wall = (x: number) => box({ size: [0.2, 3, 10], position: [x, 1.5, 0] });
    const s = ok({ objects: [...Array.from({ length: 40 }, (_, i) => loaf(i)), wall(-5), wall(5), wall(8)] });
    expect(s.objects).toHaveLength(43);
    expect(specInstanceCount(s)).toBe(SET_LIMITS.maxInstances);
    const walls = s.objects.filter((o) => o.size[2] === 10);
    expect(walls).toHaveLength(3);
    expect(walls.every((w) => w.repeat === null)).toBe(true);
  });

  it("trims the smallest repeated things first, and leaves a set within budget exactly as it was", () => {
    // A fence of 50 panels, then ten rows of 50 cups: 550 shapes, 150 over.
    const fence = box({ size: [3, 1.2, 0.1], repeat: { count: SET_LIMITS.maxRepeat, offset: [3, 0, 0] } });
    const cup = box({ size: [0.1, 0.1, 0.1], repeat: { count: SET_LIMITS.maxRepeat, offset: [0.2, 0, 0] } });
    const s = ok({ objects: [fence, ...Array.from({ length: 10 }, () => cup)] });
    expect(specInstanceCount(s)).toBe(SET_LIMITS.maxInstances);
    expect(s.objects).toHaveLength(11);
    expect(s.objects[0].repeat?.count).toBe(SET_LIMITS.maxRepeat);
    // The rows listed last give way first: 150 over is three rows cut to one
    // cup (49 each) and three more cups from the row before.
    expect(s.objects.slice(1).map((o) => o.repeat?.count ?? 1)).toEqual([50, 50, 50, 50, 50, 50, 47, 1, 1, 1]);
    const within = ok({ objects: [fence, cup] });
    expect(within.objects.map((o) => o.repeat?.count)).toEqual([SET_LIMITS.maxRepeat, SET_LIMITS.maxRepeat]);
  });

  it("can always fit by trimming repeats alone: fewer objects are allowed than shapes", () => {
    expect(SET_LIMITS.maxObjects).toBeLessThan(SET_LIMITS.maxInstances);
  });

  it("turns a repeat of one into no repeat, and bounds the offset", () => {
    const s = ok({ objects: [box({ repeat: { count: 1, offset: [9, 9, 9] } }), box({ repeat: { count: 3, offset: [500, 0, 0] } })] });
    expect(s.objects[0].repeat).toBeNull();
    expect(s.objects[1].repeat).toEqual({ count: 3, offset: [SET_LIMITS.maxRepeatOffset, 0, 0] });
  });

  it("keeps marks on the set, and uses its own ids", () => {
    const s = ok({
      bounds: { x: 10, z: 20, height: 5 },
      objects: [box()],
      marks: [{ id: "__proto__", label: "Here", x: 99, z: -99, facingDeg: -90 }],
    });
    expect(s.marks[0]).toEqual({ id: "m1", label: "Here", x: 5, z: -10, facingDeg: 270 });
  });

  it("keeps cameras near the set, above the ground, and never looking at themselves", () => {
    const s = ok({
      bounds: { x: 10, z: 10, height: 5 },
      objects: [box()],
      cameras: [
        { label: "far", position: [500, -3, 0], target: [0, 1, 0], fovDeg: 5 },
        { label: "self", position: [0, 2, 3], target: [0, 2, 3], fovDeg: 200 },
      ],
    });
    expect(s.cameras[0].position).toEqual([15, 0.2, 0]);
    expect(s.cameras[0].fovDeg).toBe(SET_LIMITS.minFovDeg);
    expect(s.cameras[1].fovDeg).toBe(SET_LIMITS.maxFovDeg);
    const [c] = [s.cameras[1]];
    expect(Math.hypot(c.target[0] - c.position[0], c.target[1] - c.position[1], c.target[2] - c.position[2])).toBeGreaterThan(0.1);
  });

  it("fills in a light, a mark and a camera when the model gave none", () => {
    const s = ok({ objects: [box()] });
    expect(s.lights.length).toBeGreaterThan(0);
    expect(s.marks).toHaveLength(1);
    expect(s.cameras).toHaveLength(1);
  });
});

describe("text the model wrote", () => {
  it("strips control and direction-override characters, and bounds length", () => {
    const s = ok({
      title: "Market\u202e gnp.exe \u0007 street" + "x".repeat(200),
      description: "A".repeat(1000),
      objects: [box()],
    });
    expect(s.title).not.toMatch(/[\u0000-\u001f\u202a-\u202e]/);
    expect(Array.from(s.title).length).toBeLessThanOrEqual(SET_LIMITS.titleChars);
    expect(s.description.length).toBe(SET_LIMITS.descriptionChars);
  });

  it("cuts by code point, never splitting an emoji", () => {
    const s = ok({ title: "🎬".repeat(100), objects: [box()] });
    expect(Array.from(s.title).every((ch) => ch === "🎬")).toBe(true);
  });

  it("gives the gate every word a person will read", () => {
    const s = ok({
      title: "T",
      description: "D",
      objects: [box()],
      marks: [{ label: "M", x: 0, z: 0, facingDeg: 0 }],
      cameras: [{ label: "C", position: [0, 2, 5], target: [0, 1, 0], fovDeg: 40 }],
    });
    expect(specTextForGate(s).split("\n").sort()).toEqual(["C", "D", "M", "T"]);
  });
});

describe("the person's arrangement", () => {
  const spec = ok({
    bounds: { x: 10, z: 10, height: 5 },
    objects: [box()],
    marks: [
      { label: "a", x: 1, z: 1, facingDeg: 0 },
      { label: "b", x: -2, z: 3, facingDeg: 90 },
    ],
  });

  it("keeps a known mark, clamps the stand-in onto the set", () => {
    expect(normaliseSetLayout({ markId: "m2", mark: { x: 50, z: -50, facingDeg: 450 } }, spec)).toEqual({
      markId: "m2",
      mark: { x: 5, z: -5, facingDeg: 90 },
      camera: null,
    });
  });

  it("falls back to the first mark for an unknown id", () => {
    expect(normaliseSetLayout({ markId: "evil" }, spec)?.markId).toBe("m1");
  });

  it("bounds a placed camera like a model's", () => {
    const l = normaliseSetLayout({ camera: { position: [99, 99, 99], target: [0, 1, 0], fovDeg: 1 } }, spec);
    expect(l?.camera?.position).toEqual([15, 10, 15]);
    expect(l?.camera?.fovDeg).toBe(SET_LIMITS.minFovDeg);
  });

  it("refuses what is not an arrangement", () => {
    expect(normaliseSetLayout("x", spec)).toBeNull();
    expect(normaliseSetLayout(null, spec)).toBeNull();
  });
});
