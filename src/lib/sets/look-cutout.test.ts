import { describe, expect, it } from "vitest";
import * as THREE from "three";
import raceTrack from "./fixtures-race-track.json";
import {
  LOOK_CUT_MEASURED_USD,
  LOOK_CUT_WORST_USD,
  LOOK_FIGURE_GROW,
  LOOK_FIGURE_GROW_UP,
  LOOK_GROUP_MAX_M,
  LOOK_MAX_GROUPS,
  LOOK_MEASURED_USD,
  LOOK_MIN_SHARE,
  LOOK_PROP_MAX_M,
  LOOK_SLAB_MIN_M,
  LOOK_TALL_SHARE,
  LOOK_WORST_USD,
  SAM2_USD_PER_COMPUTE_SECOND,
  lookCuts,
  normaliseShotCamera,
  seesLookObjects,
  sketchFovDeg,
  sketchProjector,
  type FrameBox,
  type LookCut,
  type LookSet,
  type ShotCamera,
} from "./look-cutout";
import { fovForLens } from "./build-scene";
import { SAM2_TIMEOUT_MS } from "../generations/providers/fal-segment";
import { normaliseSetSpec, type SetObject, type Vec3 } from "./set-spec";

// Where a set's objects are in an earlier still (2026-09-12): the look sends
// only them, cut out, so the boxes SAM 2 is given must be where the still's
// sketch drew them — and never where its person is. Checked against a real
// three.js camera, and on the operator's own race track.

const DEG = Math.PI / 180;

/**
 * Where three.js's own camera, at the canvas's shape, puts a point in the
 * canvas's centre square (set-view.tsx cropSquare) — 0 to 1, left to right
 * and top to bottom. On a landscape canvas the square is the canvas's full
 * height (±1/aspect of its width in NDC); on a portrait one its full width
 * (±aspect of its height).
 */
function threeSquare(camera: Omit<ShotCamera, "figure">, point: Vec3): { u: number; v: number } {
  const cam = new THREE.PerspectiveCamera(camera.fovDeg, camera.canvasAspect, 0.05, 2000);
  cam.position.set(...camera.position);
  cam.lookAt(new THREE.Vector3(...camera.target));
  cam.updateMatrixWorld();
  const ndc = new THREE.Vector3(...point).project(cam);
  const a = camera.canvasAspect;
  return a >= 1 ? { u: 0.5 + (ndc.x * a) / 2, v: 0.5 - ndc.y / 2 } : { u: 0.5 + ndc.x / 2, v: 0.5 - ndc.y / (2 * a) };
}

const box = (over: Partial<SetObject> & Pick<SetObject, "position" | "size">): SetObject => ({
  shape: "box",
  rotation: [0, 0, 0],
  color: "#808080",
  material: null,
  roughness: 0.8,
  metalness: 0,
  emissive: null,
  emissiveIntensity: 0,
  castShadow: true,
  repeat: null,
  ...over,
});

const spec = (() => {
  const n = normaliseSetSpec(raceTrack);
  if (!n.ok) throw new Error("the race-track fixture no longer normalises");
  return n.spec;
})();

const SQUARE = { width: 1024, height: 1024 };

// The operator's first real test (2026-09-12): still 1 was shot from a camera
// that was not recorded. This is the one its sketch was taken from, fitted
// to eight points of the car read off that sketch (both headlights, the near
// wheels' hubs, the rear wing's ends and uprights; 12 px rms on 1024): it
// stands inside the stray 20 m wall's copy, which the stage draws from the
// outside only, looking at the car's front three-quarter on a landscape
// screen. The figure is where the set's saved layout still has it, which is
// where that sketch shows it: at the right edge, feet at about y 765.
const STILL_1: ShotCamera = {
  position: [-3.674, 1.894, 4.691],
  target: [-0.361, 1.128, 1.025],
  fovDeg: 44.7,
  canvasAspect: 16 / 9,
  figure: { x: 1.39, z: 2.37 },
};

// Where GPT Image drew the person in still 1: far larger than the figure
// and lower, about x 800–1010 and y 280–965 of 1024.
const STILL_1_PERSON = { x_min: 800, y_min: 280, x_max: 1010, y_max: 965 };

// Indices in the fixture's objects: what Astra built.
const CAR = { first: 22, last: 46, body: 23, rearWing: 40 };
const STRAY_WALL = 48; // 4 × 20 × 136 m, repeated 50 m along: the copy runs through the track, beside the car
const GRANDSTANDS = [11, 12, 13, 14, 15, 16]; // base, tiers, seat rows, columns, roof
const KERBS = [5, 6];

/** The person's region in a still's pixels, rounded outward as look-cutout-image.ts clears it. */
const regionPx = (r: FrameBox, still = SQUARE) => ({
  x_min: Math.floor(r.u0 * still.width),
  y_min: Math.floor(r.v0 * still.height),
  x_max: Math.ceil(r.u1 * still.width),
  y_max: Math.ceil(r.v1 * still.height),
});

/** How far a box reaches into a region, in pixels across and down (0 when they do not meet). */
function reach(b: LookCut["box"], r: ReturnType<typeof regionPx>): { across: number; down: number } {
  const across = Math.min(b.x_max, r.x_max) - Math.max(b.x_min, r.x_min);
  const down = Math.min(b.y_max, r.y_max) - Math.max(b.y_min, r.y_min);
  return across > 0 && down > 0 ? { across, down } : { across: 0, down: 0 };
}

/**
 * No box sent reaches into anyone's region — the figure's, or one found in
 * the still — by more than the one pixel where their edges round to the same
 * column or row, and every point is in its box — so never in a region either.
 */
function expectClearOfPerson(got: ReturnType<typeof lookCuts>, label: string) {
  expect(got.people.length, label).toBeGreaterThan(0);
  for (const region of got.people) {
    const r = regionPx(region);
    for (const c of got.cuts) {
      const { across, down } = reach(c.box, r);
      expect(Math.min(across, down), `${label}: box round object ${c.object} ${JSON.stringify(c)} into ${JSON.stringify(r)}`).toBeLessThanOrEqual(1);
      expectPointInBox(c, label);
    }
  }
}

/** A cut's point lies in its box (fal-segment.ts sends nothing otherwise). */
function expectPointInBox(c: LookCut, label: string) {
  expect(c.point.x, `${label}: ${JSON.stringify(c)}`).toBeGreaterThanOrEqual(c.box.x_min);
  expect(c.point.x, `${label}: ${JSON.stringify(c)}`).toBeLessThanOrEqual(c.box.x_max);
  expect(c.point.y, `${label}: ${JSON.stringify(c)}`).toBeGreaterThanOrEqual(c.box.y_min);
  expect(c.point.y, `${label}: ${JSON.stringify(c)}`).toBeLessThanOrEqual(c.box.y_max);
}

describe("normaliseShotCamera", () => {
  it("reads back a frame recorded with a shot", () => {
    expect(normaliseShotCamera(STILL_1)).toEqual(STILL_1);
  });

  it("is no camera without every part — the canvas's shape and the figure included", () => {
    const { canvasAspect: _a, ...noShape } = STILL_1;
    const { figure: _f, ...noFigure } = STILL_1;
    void _a;
    void _f;
    for (const bad of [null, undefined, 42, "camera", [], noShape, noFigure, { ...STILL_1, fovDeg: Number.NaN }, { ...STILL_1, canvasAspect: 0 },
      { ...STILL_1, position: [0, 1] }, { ...STILL_1, target: [0, "1", 0] }, { ...STILL_1, target: [...STILL_1.position] },
      { ...STILL_1, figure: { x: 1 } }, { ...STILL_1, figure: { x: "1", z: 2 } }, { ...STILL_1, figure: [1, 2] }]) {
      expect(normaliseShotCamera(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("moves nothing: a lens, a canvas or a place no stage can have is no camera, never one brought inside the bounds", () => {
    // A camera held to a bound is not the camera the frame was drawn from.
    for (const bad of [{ fovDeg: 5 }, { fovDeg: 170 }, { canvasAspect: 0.01 }, { canvasAspect: 50 }, { position: [0, 1.6, 401] }, { figure: { x: 0, z: 201 } }]) {
      expect(normaliseShotCamera({ ...STILL_1, ...bad }), JSON.stringify(bad)).toBeNull();
    }
    // The edges themselves are kept as they are.
    expect(normaliseShotCamera({ ...STILL_1, fovDeg: 10, canvasAspect: 0.2 })).toEqual({ ...STILL_1, fovDeg: 10, canvasAspect: 0.2 });
    expect(normaliseShotCamera({ ...STILL_1, fovDeg: 90, canvasAspect: 10 })).toEqual({ ...STILL_1, fovDeg: 90, canvasAspect: 10 });
  });
});

describe("the sketch's own projection", () => {
  it("spans the lens's field of view on a landscape canvas, and the canvas's width's on a portrait one", () => {
    expect(sketchFovDeg(50, 16 / 9)).toBe(50);
    expect(sketchFovDeg(50, 1)).toBe(50);
    expect(sketchFovDeg(50, 0.5)).toBeCloseTo((2 * Math.atan(0.5 * Math.tan(25 * DEG))) / DEG, 10);
  });

  it("puts every point where three.js's camera does, on landscape, square and portrait canvases", () => {
    const poses: Omit<ShotCamera, "canvasAspect" | "figure">[] = [
      STILL_1,
      { position: [4.8, 1.8, 6.6], target: [0, 0.85, 0.4], fovDeg: 44 },
      { position: [-4.4, 0.45, -6.6], target: [0, 0.95, -0.6], fovDeg: 48 },
      { position: [0, 1.6, 5], target: [0, 1.6, -5], fovDeg: 25 },
      // Straight down: three.js's lookAt nudges its axes, and so must this.
      { position: [0.3, 12, -0.2], target: [0.3, 0, -0.2], fovDeg: 60 },
    ];
    let checked = 0;
    for (const pose of poses) {
      for (const canvasAspect of [16 / 9, 1, 0.46, 2.4]) {
        const camera = { ...pose, canvasAspect, figure: { x: 0, z: 0 } };
        const project = sketchProjector(camera);
        for (let i = 0; i < 40; i++) {
          // Points scattered round the target, most of them in front.
          const p: Vec3 = [
            camera.target[0] + Math.sin(i * 1.7) * 3,
            camera.target[1] + Math.cos(i * 2.3) * 1.5,
            camera.target[2] + Math.sin(i * 0.9 + 1) * 3,
          ];
          const mine = project(p);
          const three = threeSquare(camera, p);
          const cam = new THREE.PerspectiveCamera(camera.fovDeg, canvasAspect, 0.05, 2000);
          cam.position.set(...camera.position);
          cam.lookAt(new THREE.Vector3(...camera.target));
          cam.updateMatrixWorld();
          const depth = new THREE.Vector3(...p).applyMatrix4(cam.matrixWorldInverse).z * -1;
          if (depth <= 0.05) {
            expect(mine, `${JSON.stringify(camera)} ${p}`).toBeNull();
            continue;
          }
          expect(mine, `${JSON.stringify(camera)} ${p}`).not.toBeNull();
          expect(mine!.u).toBeCloseTo(three.u, 6);
          expect(mine!.v).toBeCloseTo(three.v, 6);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});

describe("the operator's race track, from still 1's camera", () => {
  const got = lookCuts(spec, STILL_1, SQUARE);

  it("keeps one object, the car, the size the sketch drew it", () => {
    expect(got.objects).toHaveLength(1);
    const [car] = got.objects;
    // The sketch sent with still 1 drew the car from x ≈ 15 to 930 px and
    // y ≈ 385 to 890 of 1024.
    expect(car.box.u0).toBeLessThan(0.03);
    expect(car.box.u1).toBeGreaterThan(0.88);
    expect(car.box.u1).toBeLessThan(0.97);
    expect(car.box.v0).toBeGreaterThan(0.33);
    expect(car.box.v0).toBeLessThan(0.4);
    expect(car.box.v1).toBeGreaterThan(0.84);
    expect(car.box.v1).toBeLessThan(0.9);
    expect(car.shapes).toBeGreaterThan(15);
  });

  it("cuts the car in one request: a box round all of it that shows, and a point at its middle, on its body", () => {
    expect(got.cuts).toHaveLength(1);
    const [car] = got.cuts;
    // The middle of the car on screen lies on its floor pan and its body;
    // the pan, the larger, names it.
    expect(car.object).toBe(CAR.first);
    expectPointInBox(car, "still 1");
    const sketched = got.objects[0].box;
    expect(car.point).toEqual({ x: Math.round(((sketched.u0 + sketched.u1) / 2) * 1024), y: Math.round(((sketched.v0 + sketched.v1) / 2) * 1024) });
    // GPT Image drew the car from about x 40 to 830 and y 440 to 800 of
    // 1024, smaller and lower than its sketch: the point lands on its body.
    expect(car.point.x).toBeGreaterThan(200);
    expect(car.point.x).toBeLessThan(650);
    expect(car.point.y).toBeGreaterThan(500);
    expect(car.point.y).toBeLessThan(760);
    // Measured 2026-09-14 through fal: this box with a point on the body
    // cut the car whole, rear wing included (the box's right edge is the
    // person's region).
    expect(car.box).toEqual({ x_min: 0, y_min: 302, x_max: 696, y_max: 967 });
    expect(car.point).toEqual({ x: 491, y: 635 });
  });

  it("gives the stray wall, the grandstands and the kerbs no cut: the one object is the car", () => {
    expect(got.objects).toHaveLength(1);
    for (const c of got.cuts) {
      expect(c.object, `point on object ${c.object}`).toBeGreaterThanOrEqual(CAR.first);
      expect(c.object, `point on object ${c.object}`).toBeLessThanOrEqual(CAR.last);
    }
    const objects = got.cuts.map((c) => c.object);
    for (const not of [STRAY_WALL, ...GRANDSTANDS, ...KERBS]) expect(objects).not.toContain(not);
  });

  it("grows the box well past the car as sketched, wing included, so a car drawn a little smaller or higher is still inside", () => {
    const [car] = got.cuts;
    const sketched = got.objects[0].box;
    const carHeight = (sketched.v1 - sketched.v0) * 1024;
    const carWidth = (sketched.u1 - sketched.u0) * 1024;
    // At least 10% of the car's size past it above, below and to the left;
    // to the right the person's region cuts it back.
    expect(car.box.y_min).toBeLessThan(sketched.v0 * 1024 - 0.1 * carHeight);
    expect(car.box.y_max).toBeGreaterThan(sketched.v1 * 1024 + 0.1 * carHeight);
    expect(car.box.x_min).toBeLessThanOrEqual(Math.max(0, sketched.u0 * 1024 - 0.1 * carWidth));
    expect(Math.abs(car.box.x_max - regionPx(got.people[0]).x_min)).toBeLessThanOrEqual(1);
    // The rear wing, the car's highest and hindmost part, is in the box.
    const project = sketchProjector(STILL_1);
    const o = spec.objects[CAR.rearWing];
    const corners: Vec3[] = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      // The wing is turned 5° about x; its box, as drawn, is inside the box of its turned corners.
      const [hx, hy, hz] = [o.size[0] / 2, o.size[1] / 2, o.size[2] / 2];
      const c = Math.cos(o.rotation[0] * DEG);
      const s = Math.sin(o.rotation[0] * DEG);
      corners.push([o.position[0] + x * hx, o.position[1] + c * y * hy - s * z * hz, o.position[2] + s * y * hy + c * z * hz]);
    }
    const seen = corners.map((p) => project(p)!);
    expect(car.box.y_min).toBeLessThan(Math.min(...seen.map((s) => s.v)) * 1024 - 0.1 * carHeight);
    expect(car.box.x_min).toBeLessThanOrEqual(Math.max(0, Math.min(...seen.map((s) => s.u)) * 1024));
  });

  it("stays inside the still, in whole pixels, at most LOOK_MAX_GROUPS cuts", () => {
    expect(got.cuts.length).toBeLessThanOrEqual(LOOK_MAX_GROUPS);
    for (const c of got.cuts) {
      for (const n of [c.box.x_min, c.box.y_min, c.box.x_max, c.box.y_max, c.point.x, c.point.y]) expect(Number.isInteger(n)).toBe(true);
      expect(c.box.x_min).toBeGreaterThanOrEqual(0);
      expect(c.box.y_min).toBeGreaterThanOrEqual(0);
      expect(c.box.x_max).toBeLessThanOrEqual(1023);
      expect(c.box.y_max).toBeLessThanOrEqual(1023);
      expect(c.box.x_max).toBeGreaterThan(c.box.x_min);
      expect(c.box.y_max).toBeGreaterThan(c.box.y_min);
      expectPointInBox(c, "still 1");
    }
  });

  it("maps the square onto a still that is not square, each axis on its own", () => {
    const wide = lookCuts(spec, STILL_1, { width: 1536, height: 1024 });
    expect(wide.cuts.map((c) => c.object)).toEqual(got.cuts.map((c) => c.object));
    expect(wide.people).toEqual(got.people);
    for (const [i, c] of wide.cuts.entries()) {
      const sq = got.cuts[i];
      expect(Math.abs(c.box.x_min - sq.box.x_min * 1.5)).toBeLessThanOrEqual(2);
      expect(Math.abs(c.box.x_max - Math.min(1535, sq.box.x_max * 1.5))).toBeLessThanOrEqual(2);
      expect(c.box.y_min).toBe(sq.box.y_min);
      expect(c.box.y_max).toBe(sq.box.y_max);
      expect(Math.abs(c.point.x - sq.point.x * 1.5)).toBeLessThanOrEqual(2);
      expect(c.point.y).toBe(sq.point.y);
    }
  });

  it("is the same from the same camera every time", () => {
    expect(lookCuts(spec, STILL_1, SQUARE)).toEqual(got);
  });
});

describe("never the person", () => {
  it("still 1: the region covers where GPT Image actually drew the person, and no box reaches into it", () => {
    const got = lookCuts(spec, STILL_1, SQUARE);
    expect(LOOK_FIGURE_GROW).toBe(0.4);
    const r = regionPx(got.people[0]);
    expect(r.x_min).toBeLessThanOrEqual(STILL_1_PERSON.x_min);
    expect(r.y_min).toBeLessThanOrEqual(STILL_1_PERSON.y_min);
    expect(r.x_max).toBeGreaterThanOrEqual(STILL_1_PERSON.x_max);
    expect(r.y_max).toBeGreaterThanOrEqual(STILL_1_PERSON.y_max);
    expectClearOfPerson(got, "still 1");
    // Before the fence, the car's box ran through the person to x 950.
    for (const c of got.cuts) expect(c.box.x_max, `object ${c.object}`).toBeLessThanOrEqual(r.x_min + 1);
  });

  it("still 3: shot from behind the car with the person at its middle, drawn so much closer than the sketch that the head stands high above the figure — the region still covers it", () => {
    // The operator's first still after the camera column (2026-09-14, no
    // look to take): GPT Image drew the person from about x 405 to 530 and
    // from y 318 (the hair) down behind the car's roof at about y 500.
    const still3: ShotCamera = { position: [-2.952, 2.069, -4.408], target: [1.115, 1.333, 2.515], fovDeg: 53.13, canvasAspect: 2.325242718446602, figure: { x: 1.39, z: 2.37 } };
    const got = lookCuts(spec, still3, SQUARE);
    expect(LOOK_FIGURE_GROW_UP).toBe(0.7);
    const r = regionPx(got.people[0]);
    expect(r.x_min).toBeLessThanOrEqual(405);
    expect(r.x_max).toBeGreaterThanOrEqual(530);
    expect(r.y_min).toBeLessThanOrEqual(318);
    expect(r.y_max).toBeGreaterThanOrEqual(500);
    // The car is cut from what lies clear of the person: the strip below.
    expectClearOfPerson(got, "still 3");
    expect(got.cuts).toHaveLength(1);
    expect(got.cuts[0].box.y_min).toBeGreaterThanOrEqual(r.y_max - 1);
  });

  it("still 4: the person was drawn a metre from the figure, sitting at the right — a region found in the still is cleared as the figure's is", () => {
    // The operator's shot 44ed7657 (2026-09-14): the figure stood behind the
    // car's middle; GPT Image sat the person on the track to its right, from
    // about x 700 to 1000 of 1024. The vision reader's box for her (grown):
    const found: FrameBox = { u0: 0.498, v0: 0.317, u1: 1, v1: 1 };
    const still4: ShotCamera = { position: [-1.942, 0.575, -3.578], target: [1.115, 1.333, 2.515], fovDeg: 53.13, canvasAspect: 2.325242718446602, figure: { x: 1.39, z: 2.37 } };
    // From the figure alone, the one cut was the strip at the right edge —
    // where she sat — and its cutout carried her arm and legs.
    const blind = lookCuts(spec, still4, SQUARE);
    expect(blind.cuts).toHaveLength(1);
    expect(blind.cuts[0].box.x_min).toBeGreaterThan(found.u0 * 1024);
    // With her region found, nothing sent reaches it: what is left of the
    // car is what lies left of the figure's region, or nothing.
    const seen = lookCuts(spec, still4, SQUARE, [found]);
    expect(seen.people).toHaveLength(2);
    expect(seen.people[1]).toEqual(found);
    expectClearOfPerson(seen, "still 4, person found");
    for (const c of seen.cuts) expect(c.box.x_max).toBeLessThanOrEqual(Math.floor(found.u0 * 1024) + 1);
    // A found region outside the frame is clipped, not trusted.
    expect(lookCuts(spec, still4, SQUARE, [{ u0: -1, v0: 2, u1: 3, v1: 4 }]).people).toHaveLength(1);
  });

  it("wherever the figure stands by the car — behind it, beside it on the camera's side, in front of its nose — no box reaches the person, and some of the car is still cut", () => {
    for (const [label, x, z] of [
      ["the fixture's first mark, behind the car", 1.5, 0],
      ["beside the car, on the camera's side", -1.5, 1.2],
      ["in front of the nose", -0.6, 2.6],
    ] as const) {
      const got = lookCuts(spec, { ...STILL_1, figure: { x, z } }, SQUARE);
      expectClearOfPerson(got, label);
      expect(got.cuts.length, label).toBeGreaterThan(0);
      for (const c of got.cuts) expect(c.object, label).toBeGreaterThanOrEqual(CAR.first);
    }
  });

  it("the point moves off a part whose centre the person's region takes, to the next nearest the middle — and an object with none left is not cut", () => {
    // A two-part object with the figure square in front of its larger part:
    // the point goes to the smaller part, clear of the person.
    const big = box({ position: [0, 0.5, 0], size: [2, 1, 1] });
    const small = box({ position: [1.6, 0.4, 0], size: [1, 0.8, 1] });
    const cam: ShotCamera = { position: [0.5, 1.6, 8], target: [0.5, 0.5, 0], fovDeg: 50, canvasAspect: 16 / 9, figure: { x: -0.2, z: 1.2 } };
    const moved = lookCuts({ objects: [big, small], bounds: { height: 12 } }, cam, SQUARE);
    expectClearOfPerson(moved, "figure before the larger part");
    expect(moved.cuts.map((c) => c.object)).toEqual([1]);
    // The figure square in front of a one-part object: nothing to point at.
    expect(lookCuts({ objects: [big], bounds: { height: 12 } }, cam, SQUARE).cuts).toEqual([]);
  });

  it("a figure seated on a chair: the chair is theirs, not the look's; the table beside it is cut back clear of them", () => {
    const chair = [
      box({ position: [0, 0.45, 0], size: [0.5, 0.08, 0.5] }),
      box({ position: [0, 0.85, -0.22], size: [0.5, 0.8, 0.06] }),
      box({ position: [-0.22, 0.2, -0.22], size: [0.05, 0.4, 0.05], repeat: { count: 2, offset: [0.44, 0, 0] } }),
      box({ position: [-0.22, 0.2, 0.22], size: [0.05, 0.4, 0.05], repeat: { count: 2, offset: [0.44, 0, 0] } }),
    ];
    const table = [box({ position: [3, 0.74, 0], size: [1.4, 0.05, 0.9] }), box({ position: [3, 0.36, 0], size: [0.12, 0.72, 0.12] })];
    const camera: ShotCamera = { position: [0.8, 1.5, 6], target: [1.2, 0.7, 0], fovDeg: 50, canvasAspect: 16 / 9, figure: { x: 0, z: 0.2 } };
    const got = lookCuts({ objects: [...chair, ...table], bounds: { height: 6 } }, camera, SQUARE);
    expectClearOfPerson(got, "seated");
    expect(got.objects).toHaveLength(1);
    // One cut, the table's; its point at the table's middle on screen, which
    // lies on its pedestal.
    expect(got.cuts.map((c) => c.object)).toEqual([5]);
    const sketched = got.objects[0].box;
    expect(got.cuts[0].point).toEqual({ x: Math.round(((sketched.u0 + sketched.u1) / 2) * 1024), y: Math.round(((sketched.v0 + sketched.v1) / 2) * 1024) });
  });

  it("a still whose sketch did not show the figure has nothing to cut: nobody can say where its person is", () => {
    for (const [label, figure] of [
      ["behind the camera", { x: -4.31, z: 4.23 }],
      ["out of frame", { x: 6, z: 6 }],
      // In frame (its middle lands at about 0.65, 0.34), but inside the pit
      // building, which the stage draws from the outside: none of it shows.
      ["hidden inside the pit building", { x: 25, z: -20 }],
    ] as const) {
      const got = lookCuts(spec, { ...STILL_1, figure }, SQUARE);
      expect(got.people, label).toEqual([]);
      expect(got.cuts, label).toEqual([]);
    }
  });
});

describe("which stills can lend a look", () => {
  it("still 1 can, whatever size the still", () => {
    expect(seesLookObjects(spec, STILL_1)).toBe(true);
    for (const still of [SQUARE, { width: 1536, height: 1024 }, { width: 390, height: 844 }]) {
      expect(lookCuts(spec, STILL_1, still).cuts.length).toBe(lookCuts(spec, STILL_1, SQUARE).cuts.length);
    }
  });

  it("a still from Astra's low rear camera never can: the wall hides the car, and the only floor it sees is between it and the wall", () => {
    const c3 = { ...spec.cameras[2], canvasAspect: 16 / 9 };
    for (const figure of [...spec.marks.map((m) => ({ x: m.x, z: m.z })), { x: -4, z: -4.5 }, { x: -4.2, z: -5 }, { x: 0, z: 0 }]) {
      expect(seesLookObjects(spec, { ...c3, figure }), JSON.stringify(figure)).toBe(false);
    }
  });

  it("nor can a still of bare structure, or one whose figure was out of frame", () => {
    // The figure in view at the foot of the grandstands, and nothing there but structure.
    const stands: ShotCamera = { position: [-10, 1.6, 0], target: [-35, 5, 0], fovDeg: 50, canvasAspect: 16 / 9, figure: { x: -18, z: -4 } };
    expect(lookCuts(spec, stands, SQUARE).people.length).toBeGreaterThan(0);
    expect(seesLookObjects(spec, stands)).toBe(false);
    // The car in view, the figure not.
    expect(seesLookObjects(spec, { ...STILL_1, figure: { x: 6, z: 6 } })).toBe(false);
  });
});

describe("what the boxes leave out on the race track", () => {
  it("only the half of the car the wall does not hide, seen from the other side", () => {
    // Camera 2 looks from +x; the car's -x half stands inside the wall's copy.
    // The figure stands far down the track, at the right edge of the frame.
    const c2 = { ...spec.cameras[1], canvasAspect: 16 / 9, figure: { x: 0, z: -10 } };
    const got = lookCuts(spec, c2, SQUARE);
    expectClearOfPerson(got, "camera 2");
    expect(got.objects).toHaveLength(1);
    expect(got.cuts).toHaveLength(1);
    // Fewer parts show than from still 1's camera, and the point is on one
    // of the +x half.
    expect(got.objects[0].shapes).toBeLessThan(lookCuts(spec, STILL_1, SQUARE).objects[0].shapes);
    for (const c of got.cuts) {
      const o = spec.objects[c.object];
      const x = o.position[0] + (o.repeat?.offset[0] ?? 0) * c.copy;
      expect(x, `object ${c.object} copy ${c.copy}`).toBeGreaterThanOrEqual(-0.2);
    }
  });

  it("the grandstands: their seats are hidden by the stands' own base from the track", () => {
    // The figure at the foot of the stands, at the right edge of the frame.
    const camera = { position: [-10, 1.6, 0] as Vec3, target: [-35, 5, 0] as Vec3, fovDeg: 50, canvasAspect: 16 / 9, figure: { x: -18, z: -4 } };
    const got = lookCuts(spec, camera, SQUARE);
    expect(got.people).toHaveLength(1);
    expect(got.people[0].u0).toBeGreaterThan(0.8);
    expect(got.cuts).toEqual([]);
    expect(got.objects).toEqual([]);
  });

  it("the kerbs: stones laid end to end down a straight are scenery, however many are in view", () => {
    const camera = { position: [-9, 1.6, 10] as Vec3, target: [-12.4, 0, -10] as Vec3, fovDeg: 50, canvasAspect: 16 / 9, figure: { x: -18, z: -10 } };
    const got = lookCuts(spec, camera, SQUARE);
    expect(got.people).toHaveLength(1);
    expect(got.cuts).toEqual([]);
    expect(got.objects).toEqual([]);
  });
});

describe("what counts as an object", () => {
  // The figure far down the left of the frame, small and clear of every prop below.
  const cam: ShotCamera = { position: [0, 1.6, 8], target: [0, 1, 0], fovDeg: 50, canvasAspect: 16 / 9, figure: { x: -9, z: -30 } };
  // A tall set: nothing below stands most of its height.
  const scene = (objects: SetObject[], height = 12): LookSet => ({ objects, bounds: { height } });
  const still = SQUARE;

  it("a prop, not structure: nothing longer than LOOK_PROP_MAX_M on a side, and never a plane", () => {
    expect(LOOK_PROP_MAX_M).toBe(6);
    expect(lookCuts(scene([box({ position: [0, 1, 0], size: [2, 1, 1] })]), cam, still).cuts).toHaveLength(1);
    expect(lookCuts(scene([box({ position: [0, 1, 0], size: [6.5, 1, 1] })]), cam, still).cuts).toEqual([]);
    expect(lookCuts(scene([box({ shape: "plane", position: [0, 0.5, 0], size: [2, 0.01, 2], rotation: [60, 0, 0] })]), cam, still).cuts).toEqual([]);
  });

  it("a small room's walls, floor and ceiling are structure, not one object with the sofa against them", () => {
    // Found in review (2026-09-12): every piece of a 5 m room is under 6 m on
    // a side, the pieces touch the furniture, and the whole room came out as
    // one object filling the frame — the still again, which the look must
    // never be. A wall is broad two ways (LOOK_SLAB_MIN_M); in a low room it
    // is under that, but stands the room's height (LOOK_TALL_SHARE).
    expect(LOOK_SLAB_MIN_M).toBe(3);
    expect(LOOK_TALL_SHARE).toBe(0.8);
    const room = (height: number) => [
      box({ position: [0, height / 2, -2.5], size: [5, height, 0.15] }),
      box({ position: [-2.5, height / 2, 0], size: [0.15, height, 5] }),
      box({ position: [2.5, height / 2, 0], size: [0.15, height, 5] }),
      box({ position: [0, 0.05, 0], size: [5, 0.1, 5] }),
      box({ position: [0, height - 0.05, 0], size: [5, 0.1, 5] }),
    ];
    const sofa = box({ position: [-0.6, 0.45, -2.0], size: [2.2, 0.9, 0.9] });
    // Inside the room, the figure at its right, clear of the sofa.
    const inside: ShotCamera = { position: [0, 1.5, 2], target: [0, 1, -2], fovDeg: 50, canvasAspect: 16 / 9, figure: { x: 1.2, z: -1.4 } };
    for (const height of [3, 2.4]) {
      const got = lookCuts(scene([...room(height), sofa], height), inside, still);
      expectClearOfPerson(got, `${height} m room`);
      expect(got.objects, `${height} m room`).toHaveLength(1);
      expect(got.cuts.length, `${height} m room`).toBeGreaterThan(0);
      for (const b of got.cuts) expect(b.object, `${height} m room`).toBe(5);
      // The room alone: nothing to cut.
      expect(lookCuts(scene(room(height), height), inside, still).cuts, `${height} m room, bare`).toEqual([]);
    }
    // The same slab rule never takes a car (under 2 m wide) or a bed.
    expect(lookCuts(scene([box({ position: [0, 0.6, 0], size: [1.9, 1.2, 4.5] })]), cam, still).cuts.length).toBeGreaterThan(0);
    expect(lookCuts(scene([box({ position: [0, 0.3, 0], size: [2.1, 0.6, 1.6] })]), cam, still).cuts.length).toBeGreaterThan(0);
  });

  it("only in front of the camera; how far off does not matter, only how big on screen — a long lens fills the frame from 45 m", () => {
    const behind = box({ position: [0, 1, 12], size: [2, 1, 1] });
    expect(lookCuts(scene([behind]), cam, still).cuts).toEqual([]);
    // A car 45 m off, the figure beside it: a speck at 24 mm, most of the frame at 135 mm.
    const car = box({ position: [0, 0.75, 8 - 45], size: [4.4, 1.5, 2] });
    const beside = { x: -3, z: 8 - 45 };
    expect(lookCuts(scene([car]), { ...cam, figure: beside }, still).cuts).toEqual([]);
    const tele = lookCuts(scene([car]), { ...cam, fovDeg: fovForLens(135), figure: beside }, still);
    expectClearOfPerson(tele, "135 mm");
    expect(tele.cuts).toHaveLength(1);
    expect(tele.objects[0].share).toBeGreaterThan(0.1);
  });

  it("not behind structure, as the stage draws it: outside faces only", () => {
    const prop = box({ position: [0, 1, 0], size: [1, 1, 1] });
    // A tall, narrow wall (structure: 7 m tall) between the camera and the
    // prop, clear of the line to the figure.
    const wall = box({ position: [0, 3.5, 3], size: [2, 7, 0.3] });
    const walled = lookCuts(scene([prop, wall]), cam, still);
    expect(walled.people).toHaveLength(1);
    expect(walled.cuts).toEqual([]);
    // A camera standing inside a big box sees out of it.
    const room = box({ position: [0, 2, 4], size: [12, 8, 12] });
    expect(lookCuts(scene([prop, room]), cam, still).cuts).toHaveLength(1);
  });

  it("shapes that touch are one object, cut in one request: the box round every part that shows, the point on the largest", () => {
    const body = box({ position: [0, 0.6, 0], size: [2, 0.8, 4.4] });
    const posts = box({ position: [-0.7, 1.15, -1.9], size: [0.08, 0.4, 0.2], repeat: { count: 2, offset: [1.4, 0, 0] } });
    const wing = box({ position: [0, 1.4, -1.9], size: [2.2, 0.08, 0.45] });
    const tailLight = box({ position: [0, 0.8, -2.21], size: [0.3, 0.1, 0.02] });
    // The figure at the left edge of the frame, clear of the car.
    const side: ShotCamera = { ...cam, position: [6, 1.6, 3], target: [0, 0.8, 0], figure: { x: -16, z: 2 } };
    const got = lookCuts(scene([body, posts, wing, tailLight]), side, still);
    expect(got.objects).toHaveLength(1);
    expect(got.objects[0].shapes).toBe(5);
    expect(got.cuts).toHaveLength(1);
    const [cut] = got.cuts;
    expect(cut.object).toBe(0);
    expectPointInBox(cut, "wing on posts");
    // The box takes in the thin wing above the body, and the point is on the body, under the wing.
    const project = sketchProjector(side);
    const wingTop = project([0, 1.44, -1.9])!;
    expect(cut.box.y_min).toBeLessThan(wingTop.v * 1024);
    expect(cut.point.y).toBeGreaterThan(wingTop.v * 1024);
    // The parts' own boxes are all inside the cut's.
    const whole = got.objects[0].box;
    expect(cut.box.x_min).toBeLessThanOrEqual(whole.u0 * 1024);
    expect(cut.box.x_max).toBeGreaterThanOrEqual(whole.u1 * 1024);
    expect(cut.box.y_min).toBeLessThanOrEqual(whole.v0 * 1024);
    expect(cut.box.y_max).toBeGreaterThanOrEqual(whole.v1 * 1024);
  });

  it("shapes apart are objects apart, a cut each; the largest LOOK_MAX_GROUPS on screen are kept, none under LOOK_MIN_SHARE", () => {
    expect(LOOK_MAX_GROUPS).toBe(3);
    expect(LOOK_MIN_SHARE).toBe(0.01);
    const props = [-3, -1, 1, 3].map((x, i) => box({ position: [x, 0.5, 0], size: [1, 0.4 + i * 0.3, 1] }));
    const got = lookCuts(scene(props), cam, still);
    expect(got.objects).toHaveLength(3);
    expect(got.cuts.map((c) => c.object).sort()).toEqual([1, 2, 3]);
    for (const c of got.cuts) expectPointInBox(c, "three apart");
    for (let i = 1; i < got.objects.length; i++) expect(got.objects[i].share).toBeLessThanOrEqual(got.objects[i - 1].share);
    // A pebble is not an object.
    expect(lookCuts(scene([box({ position: [0, 0.05, 0], size: [0.1, 0.1, 0.1] })]), cam, still).cuts).toEqual([]);
  });

  it("a run of props longer than LOOK_GROUP_MAX_M is scenery — repeated, or a chain of touching props", () => {
    expect(LOOK_GROUP_MAX_M).toBe(12);
    const barrier = (count: number) => box({ position: [-4, 0.5, 2], size: [1, 1, 2], repeat: { count, offset: [0, 0, -2] } });
    expect(lookCuts(scene([barrier(3)]), cam, still).cuts.length).toBeGreaterThan(0);
    expect(lookCuts(scene([barrier(8)]), cam, still).cuts).toEqual([]);
    const chain = Array.from({ length: 7 }, (_, i) => box({ position: [-4, 0.5, 2 - 2 * i], size: [1, 1, 2] }));
    expect(lookCuts(scene(chain), cam, still).cuts).toEqual([]);
  });

  it("a run beside a car is scenery on its own: the car keeps its boxes", () => {
    // Found in review (2026-09-12): the run was decided after grouping, so a
    // car touching a line of kerb stones was thrown away with the line.
    const body = box({ position: [0, 0.6, 0], size: [2, 0.8, 4.4] });
    const kerb = (count: number, from: number) => box({ position: [1.2, 0.06, from], size: [0.4, 0.12, 1], repeat: { count, offset: [0, 0, 1] } });
    const beside = lookCuts(scene([body, kerb(20, -9)]), cam, still);
    expect(beside.objects).toHaveLength(1);
    expect(beside.objects[0].shapes).toBe(1);
    expect(beside.cuts.map((c) => c.object)).toEqual([0]);
    // A short line of them, touching, is part of the car.
    expect(lookCuts(scene([body, kerb(3, -1)]), cam, still).objects[0].shapes).toBe(4);
  });

  it("no camera or no still: nothing to cut", () => {
    const prop = box({ position: [0, 1, 0], size: [2, 1, 1] });
    expect(lookCuts(scene([prop]), { ...cam, canvasAspect: Number.NaN }, still).cuts).toEqual([]);
    expect(lookCuts(scene([prop]), cam, { width: 0, height: 1024 }).cuts).toEqual([]);
  });
});

describe("the money", () => {
  it("is fal's compute-second price times the seconds, a cut is capped by the wait, and a look is at most LOOK_MAX_GROUPS cuts", () => {
    expect(SAM2_USD_PER_COMPUTE_SECOND).toBe(0.0008);
    // 7 s × $0.0008 = $0.0056 measured; 30 s × $0.0008 = $0.024 at worst.
    expect(LOOK_CUT_MEASURED_USD).toBeCloseTo(0.0056, 10);
    expect(SAM2_TIMEOUT_MS).toBe(30_000);
    expect(LOOK_CUT_WORST_USD).toBeCloseTo(0.024, 10);
    // 3 × $0.0056 = $0.0168; 3 × $0.024 = $0.072.
    expect(LOOK_MEASURED_USD).toBeCloseTo(0.0168, 10);
    expect(LOOK_WORST_USD).toBeCloseTo(0.072, 10);
  });
});

describe("a rig frame's band (Helios Cinema)", () => {
  // Looking straight down −Z from the origin, a 40° lens over a 3:2 render
  // cut to a 2.39 band: the band keeps the render's full width and 1.5/2.39
  // of its height.
  const camera = {
    position: [0, 0, 0] as [number, number, number],
    target: [0, 0, -10] as [number, number, number],
    fovDeg: 40,
    canvasAspect: 1,
    figure: { x: 0, z: -5 },
    frame: { render: 1.5, band: 2.39 },
  };
  const tv = Math.tan((40 * Math.PI) / 360);

  it("maps the band's own edges to 0 and 1", () => {
    const project = sketchProjector(camera);
    const d = 10;
    const top = project([0, d * tv * (1.5 / 2.39), -d])!;
    const right = project([d * tv * 1.5, 0, -d])!;
    expect(top.v).toBeCloseTo(0, 6);
    expect(top.u).toBeCloseTo(0.5, 6);
    expect(right.u).toBeCloseTo(1, 6);
  });

  it("keeps the frame through the one door, and refuses a frame out of shape", () => {
    expect(normaliseShotCamera(camera)?.frame).toEqual({ render: 1.5, band: 2.39 });
    expect(normaliseShotCamera({ ...camera, frame: { render: 1.5, band: 9 } })).toBeNull();
    const square: Partial<typeof camera> = { ...camera };
    delete square.frame;
    expect(normaliseShotCamera(square)?.frame).toBeUndefined();
  });
});

