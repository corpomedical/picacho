import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MARK_SEARCH_M,
  PERSON_RADIUS_M,
  blockerAt,
  blockers,
  clearMarks,
  rotationXYZ,
} from "./marks";
import { normaliseSetLayout, normaliseSetSpec, type SetMark, type SetObject } from "./set-spec";
import beach from "./fixtures-beach.json";
import rainyMarket from "./fixtures-rainy-market.json";
import showroomClosed from "./fixtures-showroom-closed.json";

// Marks on open floor (marks.ts). The operator's race track (2026-09-12)
// opened with its first mark at the car's centre, and its second inside a
// wall Astra had repeated one copy too close.

const obj = (over: Partial<SetObject>): SetObject => ({
  shape: "box",
  position: [0, 0.5, 0],
  rotation: [0, 0, 0],
  size: [1, 1, 1],
  color: "#888888",
  roughness: 0.8,
  metalness: 0,
  emissive: null,
  emissiveIntensity: 1,
  castShadow: false,
  repeat: null,
  ...over,
});
const mark = (x: number, z: number, facingDeg = 0): SetMark => ({ id: "m1", label: "", x, z, facingDeg });
const BOUNDS = { x: 30, z: 30 };
const clear = (objects: SetObject[], m: SetMark, bounds = BOUNDS) => clearMarks([m], objects, bounds);

describe("the turn a box's footprint is taken with", () => {
  it("is three.js's own Euler XYZ, the order build-scene.ts sets", () => {
    for (const [x, y, z] of [[10, 20, 30], [-32, 0, 0], [0, 0, 12], [75, -40, 190], [0, 135, 0]]) {
      const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x * (Math.PI / 180), y * (Math.PI / 180), z * (Math.PI / 180), "XYZ"));
      const e = m.elements; // column-major
      const r = rotationXYZ(x * (Math.PI / 180), y * (Math.PI / 180), z * (Math.PI / 180));
      for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) expect(r[row][col]).toBeCloseTo(e[col * 4 + row], 12);
    }
  });
});

describe("what blocks a person", () => {
  it("a car's body: the mark at its centre moves out, clear of it and inside the set", () => {
    const car = [obj({ size: [1.9, 0.5, 3.7], position: [0, 0.55, 0] }), obj({ size: [1.3, 0.12, 0.8], position: [0, 1.25, -0.4] })];
    const r = clear(car, mark(0, 0));
    expect(r.moved).toBe(1);
    const [m] = r.marks;
    expect(blockerAt([m.x, m.z], blockers(car))).toBeNull();
    expect(Math.hypot(m.x, m.z)).toBeLessThan(1.6);
    expect(Math.abs(m.x)).toBeLessThanOrEqual(BOUNDS.x / 2);
  });

  it("a desk top at desk height, a pillar, a wall turned 30°", () => {
    const desk = obj({ size: [1.4, 0.05, 0.7], position: [0, 0.75, 0] });
    expect(clear([desk], mark(0.2, 0.1)).moved).toBe(1);
    const pillar = obj({ shape: "cylinder", size: [1, 3, 1], position: [0, 1.5, 0] });
    expect(clear([pillar], mark(0.6, 0)).moved).toBe(1);
    const wall = obj({ size: [10, 3, 0.2], position: [0, 1.5, 0], rotation: [0, 30, 0] });
    // A point on the wall's own line, 3 m along it: blocked only because the wall is turned.
    const along: [number, number] = [3 * Math.cos((30 * Math.PI) / 180), -3 * Math.sin((30 * Math.PI) / 180)];
    expect(blockerAt(along, blockers([wall]))).not.toBeNull();
    expect(blockerAt([3, 0], blockers([wall]))).toBeNull();
  });

  it("what a person sits or stands on does not: a chair seat, a rug, a kerb, a low wide stage", () => {
    const seat = obj({ size: [0.5, 0.1, 0.5], position: [0, 0.45, 0] });
    const rug = obj({ shape: "plane", size: [3, 0.01, 2], position: [0, 0.01, 0] });
    const kerb = obj({ size: [10, 0.15, 0.3], position: [0, 0.075, 0] });
    const stage = obj({ size: [6, 0.9, 4], position: [0, 0.45, 0] });
    for (const o of [seat, rug, kerb, stage]) expect(clear([o], mark(0, 0)).moved, o.shape + JSON.stringify(o.size)).toBe(0);
  });

  it("a stage too high to be one does (a 2 m block is a wall), and so does a narrow one (a counter)", () => {
    expect(clear([obj({ size: [6, 2, 4], position: [0, 1, 0] })], mark(0, 0)).moved).toBe(1);
    expect(clear([obj({ size: [3, 1.05, 0.8], position: [0, 0.525, 0] })], mark(0, 0)).moved).toBe(1);
  });

  it("something overhead does not: a sign that starts above the person's head", () => {
    expect(clear([obj({ size: [2, 0.6, 0.1], position: [0, 2.4, 0] })], mark(0, 0)).moved).toBe(0);
  });

  it("a round pillar blocks by its true circle, not the square around it", () => {
    const pillar = obj({ shape: "cylinder", size: [1, 3, 1], position: [0, 1.5, 0] });
    // Off the square's corner: 0.9 m from the centre on the diagonal is 0.4 m clear of the circle.
    const d = 0.9 / Math.SQRT2;
    expect(blockerAt([d, d], blockers([pillar]))).toBeNull();
    expect(blockerAt([0.7, 0], blockers([pillar]))).not.toBeNull();
  });

  it("a dune mostly under the ground blocks only where it stands taller than a seat", () => {
    // An ellipsoid 24 × 6 × 32 m whose centre is 1 m under the ground: 2 m tall at its middle.
    const dune = obj({ shape: "sphere", size: [24, 6, 32], position: [0, -1, 0] });
    expect(blockerAt([0, 0], blockers([dune]))).not.toBeNull();
    // Near its edge it rises less than 0.65 m: stood on.
    expect(blockerAt([11, 0], blockers([dune]))).toBeNull();
  });

  it("every copy of a repeated object counts", () => {
    const bollards = obj({ shape: "cylinder", size: [0.4, 1, 0.4], position: [-4, 0.5, 0], repeat: { count: 5, offset: [2, 0, 0] } });
    // The third copy stands at x = 0.
    expect(blockerAt([0, 0], blockers([bollards]))).not.toBeNull();
    expect(blockerAt([1, 0], blockers([bollards]))).toBeNull();
  });

  it("a round shape tipped over falls back to the box around it", () => {
    const log = obj({ shape: "cylinder", size: [0.6, 4, 0.6], position: [0, 0.3 + 0.35, 0], rotation: [0, 0, 90] });
    // Lying along x: 4 m long, 0.6 m across, its top at 0.95 m.
    expect(blockerAt([1.8, 0], blockers([log]))).not.toBeNull();
    expect(blockerAt([0, 1], blockers([log]))).toBeNull();
  });
});

describe("where a blocked mark goes", () => {
  it("to the nearest open floor, first away from what it stood in, the same every time", () => {
    const box = obj({ size: [2, 2, 2], position: [0, 1, 0] });
    const a = clear([box], mark(0.5, 0));
    const b = clear([box], mark(0.5, 0));
    expect(a.marks).toEqual(b.marks);
    // Away is +x: the first free step clears the box's side (1 m) by the person's radius.
    expect(a.marks[0].z).toBeCloseTo(0, 6);
    expect(a.marks[0].x).toBeGreaterThanOrEqual(1 + PERSON_RADIUS_M);
    expect(a.marks[0].x).toBeLessThan(1 + PERSON_RADIUS_M + 0.25 + 1e-9);
  });

  it("keeps its id, label and the way it faces", () => {
    const m = { id: "m2", label: "Trackside", x: 0, z: 0, facingDeg: 140 };
    const [out] = clearMarks([m], [obj({ size: [2, 2, 2], position: [0, 1, 0] })], BOUNDS).marks;
    expect(out).toMatchObject({ id: "m2", label: "Trackside", facingDeg: 140 });
  });

  it("never leaves the set, and stays put when no open floor is near enough", () => {
    const small = { x: 3, z: 3 };
    const r = clear([obj({ size: [20, 3, 20], position: [0, 1.5, 0] })], mark(0, 0), small);
    expect(r).toMatchObject({ moved: 0, stuck: 1 });
    expect(r.marks[0]).toMatchObject({ x: 0, z: 0 });
    const far = clear([obj({ size: [2 * MARK_SEARCH_M + 4, 3, 2 * MARK_SEARCH_M + 4], position: [0, 1.5, 0] })], mark(0, 0), { x: 60, z: 60 });
    expect(far.stuck).toBe(1);
  });

  it("the race track: out of the car, and out of the wall copied one step too close", () => {
    const car = obj({ size: [1.88, 0.5, 3.65], position: [0, 0.55, -0.15] });
    // Astra's perimeter wall at x = −52, repeated +50: its copy runs through the track at x = −4…0.
    const wall = obj({ size: [4, 20, 136], position: [-52, 10, 0], repeat: { count: 2, offset: [50, 0, 0] } });
    const r = clearMarks([mark(0, 0), { ...mark(-3, 3.5, 140), id: "m2" }], [car, wall], { x: 100, z: 120 });
    expect(r.moved).toBe(2);
    for (const m of r.marks) expect(blockerAt([m.x, m.z], blockers([car, wall]))).toBeNull();
  });
});

describe("normaliseSetSpec moves blocked marks, and only those", () => {
  it("notes it when it does", () => {
    const n = normaliseSetSpec({
      bounds: { x: 20, z: 20, height: 6 },
      objects: [{ shape: "box", position: [0, 0.55, 0], size: [1.9, 0.5, 3.7] }],
      marks: [{ label: "Inside the car", x: 0, z: 0, facingDeg: 0 }],
      cameras: [{ label: "Wide", position: [6, 1.6, 6], target: [0, 1, 0], fovDeg: 40 }],
    });
    expect(n.ok).toBe(true);
    if (!n.ok) return;
    expect(n.notes).toContain("marks_moved");
    expect(blockerAt([n.spec.marks[0].x, n.spec.marks[0].z], blockers(n.spec.objects))).toBeNull();
  });

  it("leaves the recorded sets' marks exactly where Astra put them", () => {
    for (const fixture of [rainyMarket, showroomClosed, beach]) {
      const n = normaliseSetSpec(fixture);
      expect(n.ok).toBe(true);
      if (!n.ok) continue;
      expect(n.notes).not.toContain("marks_moved");
      const raw = (fixture as { marks: { x: number; z: number }[] }).marks;
      n.spec.marks.forEach((m, i) => expect([m.x, m.z]).toEqual([raw[i].x, raw[i].z]));
    }
  });
});

describe("the person's own figure follows the same rule", () => {
  const n = normaliseSetSpec({
    bounds: { x: 20, z: 20, height: 6 },
    objects: [{ shape: "box", position: [4, 0.55, 0], size: [1.9, 0.5, 3.7] }],
    marks: [{ label: "Beside the car", x: 0, z: 0, facingDeg: 0 }],
    cameras: [{ label: "Wide", position: [6, 1.6, 6], target: [0, 1, 0], fovDeg: 40 }],
  });
  if (!n.ok) throw new Error("fixture");
  const spec = n.spec;

  it("a saved figure inside the car comes back on open floor, facing as saved", () => {
    const l = normaliseSetLayout({ markId: "m1", mark: { x: 4, z: 0, facingDeg: 120 } }, spec);
    expect(l).not.toBeNull();
    expect(blockerAt([l!.mark.x, l!.mark.z], blockers(spec.objects))).toBeNull();
    expect(l!.mark.facingDeg).toBe(120);
    expect(Math.hypot(l!.mark.x - 4, l!.mark.z)).toBeLessThan(2);
  });

  it("a saved figure already on open floor stays exactly where they put it", () => {
    expect(normaliseSetLayout({ markId: "m1", mark: { x: -3.25, z: 2.5, facingDeg: 30 } }, spec)?.mark).toEqual({
      x: -3.25,
      z: 2.5,
      facingDeg: 30,
    });
  });

  it("the stage runs it where the figure is dropped (read as source)", () => {
    const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
    const onUp = view.slice(view.indexOf("const onUp = (e: PointerEvent) => {"));
    expect(onUp.slice(0, onUp.indexOf("canvas.addEventListener"))).toContain("clearMarks([{ ...dropped,");
  });
});
