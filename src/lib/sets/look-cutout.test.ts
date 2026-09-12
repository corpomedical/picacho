import { describe, expect, it } from "vitest";
import * as THREE from "three";
import raceTrack from "./fixtures-race-track.json";
import {
  LOOK_CUT_MEASURED_USD,
  LOOK_CUT_WORST_USD,
  LOOK_FIGURE_GROW,
  LOOK_GROUP_MAX_M,
  LOOK_MAX_BOXES,
  LOOK_MAX_DISTANCE_M,
  LOOK_MAX_GROUPS,
  LOOK_MIN_SHARE,
  LOOK_PROP_MAX_M,
  SAM2_USD_PER_COMPUTE_SECOND,
  lookCutoutBoxes,
  normaliseShotCamera,
  seesLookObjects,
  sketchFovDeg,
  sketchProjector,
  type FrameBox,
  type LookBox,
  type ShotCamera,
} from "./look-cutout";
import { SAM2_TIMEOUT_MS } from "../generations/providers/fal-segment";
import { normaliseSetSpec, type SetObject, type SetSpec, type Vec3 } from "./set-spec";

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
function reach(b: LookBox, r: ReturnType<typeof regionPx>): { across: number; down: number } {
  const across = Math.min(b.x_max, r.x_max) - Math.max(b.x_min, r.x_min);
  const down = Math.min(b.y_max, r.y_max) - Math.max(b.y_min, r.y_min);
  return across > 0 && down > 0 ? { across, down } : { across: 0, down: 0 };
}

/** No box sent reaches into the person's region by more than the one pixel where their edges round to the same column or row. */
function expectClearOfPerson(got: ReturnType<typeof lookCutoutBoxes>, label: string) {
  expect(got.person, label).not.toBeNull();
  const r = regionPx(got.person!);
  for (const b of got.boxes) {
    const { across, down } = reach(b, r);
    expect(Math.min(across, down), `${label}: box round object ${b.object} ${JSON.stringify(b)} into ${JSON.stringify(r)}`).toBeLessThanOrEqual(1);
  }
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
  const got = lookCutoutBoxes(spec, STILL_1, SQUARE);

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

  it("gives the car's body a box and its rear wing one of its own", () => {
    const objects = new Set(got.boxes.map((b) => b.object));
    expect(objects.has(CAR.body)).toBe(true);
    expect(objects.has(CAR.rearWing)).toBe(true);
  });

  it("gives the stray wall, the grandstands and the kerbs none: every box is round a part of the car", () => {
    for (const b of got.boxes) {
      expect(b.object, `box round object ${b.object}`).toBeGreaterThanOrEqual(CAR.first);
      expect(b.object, `box round object ${b.object}`).toBeLessThanOrEqual(CAR.last);
    }
    const objects = got.boxes.map((b) => b.object);
    for (const not of [STRAY_WALL, ...GRANDSTANDS, ...KERBS]) expect(objects).not.toContain(not);
  });

  it("grows every box well past its part, so a car drawn a little smaller or higher is still inside", () => {
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
    const sketched = {
      x_min: Math.min(...seen.map((s) => s.u)) * 1024,
      x_max: Math.max(...seen.map((s) => s.u)) * 1024,
      y_min: Math.min(...seen.map((s) => s.v)) * 1024,
      y_max: Math.max(...seen.map((s) => s.v)) * 1024,
    };
    const wing = got.boxes.find((b) => b.object === CAR.rearWing)!;
    // At least 10% of the car's height on screen past the wing, above and below.
    const carHeight = (got.objects[0].box.v1 - got.objects[0].box.v0) * 1024;
    expect(wing.y_min).toBeLessThan(sketched.y_min - 0.1 * carHeight);
    expect(wing.y_max).toBeGreaterThan(sketched.y_max + 0.1 * carHeight);
    expect(wing.x_min).toBeLessThanOrEqual(Math.max(0, sketched.x_min));
    expect(wing.x_max).toBeGreaterThan(sketched.x_max);
  });

  it("stays inside the still, in whole pixels, and under the cap", () => {
    expect(got.boxes.length).toBeGreaterThan(1);
    expect(got.boxes.length).toBeLessThanOrEqual(LOOK_MAX_BOXES);
    for (const b of got.boxes) {
      for (const n of [b.x_min, b.y_min, b.x_max, b.y_max]) expect(Number.isInteger(n)).toBe(true);
      expect(b.x_min).toBeGreaterThanOrEqual(0);
      expect(b.y_min).toBeGreaterThanOrEqual(0);
      expect(b.x_max).toBeLessThanOrEqual(1023);
      expect(b.y_max).toBeLessThanOrEqual(1023);
      expect(b.x_max).toBeGreaterThan(b.x_min);
      expect(b.y_max).toBeGreaterThan(b.y_min);
    }
  });

  it("maps the square onto a still that is not square, each axis on its own", () => {
    const wide = lookCutoutBoxes(spec, STILL_1, { width: 1536, height: 1024 });
    expect(wide.boxes.map((b) => b.object)).toEqual(got.boxes.map((b) => b.object));
    expect(wide.person).toEqual(got.person);
    for (const [i, b] of wide.boxes.entries()) {
      const sq = got.boxes[i];
      expect(Math.abs(b.x_min - sq.x_min * 1.5)).toBeLessThanOrEqual(2);
      expect(Math.abs(b.x_max - Math.min(1535, sq.x_max * 1.5))).toBeLessThanOrEqual(2);
      expect(b.y_min).toBe(sq.y_min);
      expect(b.y_max).toBe(sq.y_max);
    }
  });

  it("is the same from the same camera every time", () => {
    expect(lookCutoutBoxes(spec, STILL_1, SQUARE)).toEqual(got);
  });
});

describe("never the person", () => {
  it("still 1: the region covers where GPT Image actually drew the person, and no box reaches into it", () => {
    const got = lookCutoutBoxes(spec, STILL_1, SQUARE);
    expect(LOOK_FIGURE_GROW).toBe(0.4);
    const r = regionPx(got.person!);
    expect(r.x_min).toBeLessThanOrEqual(STILL_1_PERSON.x_min);
    expect(r.y_min).toBeLessThanOrEqual(STILL_1_PERSON.y_min);
    expect(r.x_max).toBeGreaterThanOrEqual(STILL_1_PERSON.x_max);
    expect(r.y_max).toBeGreaterThanOrEqual(STILL_1_PERSON.y_max);
    expectClearOfPerson(got, "still 1");
    // Before the fence, three boxes ran through the person: 22 and 26 to the
    // right edge, 23 to x 950.
    for (const b of got.boxes) expect(b.x_max, `object ${b.object}`).toBeLessThanOrEqual(r.x_min + 1);
  });

  it("wherever the figure stands by the car — behind it, beside it on the camera's side, in front of its nose — no box reaches the person, and some of the car is still cut", () => {
    for (const [label, x, z] of [
      ["the fixture's first mark, behind the car", 1.5, 0],
      ["beside the car, on the camera's side", -1.5, 1.2],
      ["in front of the nose", -0.6, 2.6],
    ] as const) {
      const got = lookCutoutBoxes(spec, { ...STILL_1, figure: { x, z } }, SQUARE);
      expectClearOfPerson(got, label);
      expect(got.boxes.length, label).toBeGreaterThan(0);
      for (const b of got.boxes) expect(b.object, label).toBeGreaterThanOrEqual(CAR.first);
    }
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
    const got = lookCutoutBoxes({ objects: [...chair, ...table] }, camera, SQUARE);
    expectClearOfPerson(got, "seated");
    expect(got.objects).toHaveLength(1);
    expect(new Set(got.boxes.map((b) => b.object))).toEqual(new Set([4, 5]));
  });

  it("a still whose sketch did not show the figure has nothing to cut: nobody can say where its person is", () => {
    for (const [label, figure] of [
      ["behind the camera", { x: -4.31, z: 4.23 }],
      ["out of frame", { x: 6, z: 6 }],
      // In frame (its middle lands at about 0.65, 0.34), but inside the pit
      // building, which the stage draws from the outside: none of it shows.
      ["hidden inside the pit building", { x: 25, z: -20 }],
    ] as const) {
      const got = lookCutoutBoxes(spec, { ...STILL_1, figure }, SQUARE);
      expect(got.person, label).toBeNull();
      expect(got.boxes, label).toEqual([]);
    }
  });
});

describe("which stills can lend a look", () => {
  it("still 1 can, whatever size the still", () => {
    expect(seesLookObjects(spec, STILL_1)).toBe(true);
    for (const still of [SQUARE, { width: 1536, height: 1024 }, { width: 390, height: 844 }]) {
      expect(lookCutoutBoxes(spec, STILL_1, still).boxes.length).toBe(lookCutoutBoxes(spec, STILL_1, SQUARE).boxes.length);
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
    expect(lookCutoutBoxes(spec, stands, SQUARE).person).not.toBeNull();
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
    const got = lookCutoutBoxes(spec, c2, SQUARE);
    expectClearOfPerson(got, "camera 2");
    expect(got.objects).toHaveLength(1);
    expect(got.boxes.some((b) => b.object === CAR.rearWing)).toBe(true);
    for (const b of got.boxes) {
      const o = spec.objects[b.object];
      const x = o.position[0] + (o.repeat?.offset[0] ?? 0) * b.copy;
      expect(x, `object ${b.object} copy ${b.copy}`).toBeGreaterThanOrEqual(-0.2);
    }
  });

  it("the grandstands: their seats are hidden by the stands' own base from the track", () => {
    // The figure at the foot of the stands, at the right edge of the frame.
    const camera = { position: [-10, 1.6, 0] as Vec3, target: [-35, 5, 0] as Vec3, fovDeg: 50, canvasAspect: 16 / 9, figure: { x: -18, z: -4 } };
    const got = lookCutoutBoxes(spec, camera, SQUARE);
    expect(got.person).not.toBeNull();
    expect(got.person!.u0).toBeGreaterThan(0.8);
    expect(got.boxes).toEqual([]);
    expect(got.objects).toEqual([]);
  });

  it("the kerbs: stones laid end to end down a straight are scenery, however many are in view", () => {
    const camera = { position: [-9, 1.6, 10] as Vec3, target: [-12.4, 0, -10] as Vec3, fovDeg: 50, canvasAspect: 16 / 9, figure: { x: -18, z: -10 } };
    const got = lookCutoutBoxes(spec, camera, SQUARE);
    expect(got.person).not.toBeNull();
    expect(got.boxes).toEqual([]);
    expect(got.objects).toEqual([]);
  });
});

describe("what counts as an object", () => {
  // The figure far down the left of the frame, small and clear of every prop below.
  const cam: ShotCamera = { position: [0, 1.6, 8], target: [0, 1, 0], fovDeg: 50, canvasAspect: 16 / 9, figure: { x: -9, z: -30 } };
  const scene = (objects: SetObject[]): Pick<SetSpec, "objects"> => ({ objects });
  const still = SQUARE;

  it("a prop, not structure: nothing longer than LOOK_PROP_MAX_M on a side, and never a plane", () => {
    expect(LOOK_PROP_MAX_M).toBe(6);
    expect(lookCutoutBoxes(scene([box({ position: [0, 1, 0], size: [2, 1, 1] })]), cam, still).boxes).toHaveLength(1);
    expect(lookCutoutBoxes(scene([box({ position: [0, 1, 0], size: [6.5, 1, 1] })]), cam, still).boxes).toEqual([]);
    expect(lookCutoutBoxes(scene([box({ shape: "plane", position: [0, 0.5, 0], size: [2, 0.01, 2], rotation: [60, 0, 0] })]), cam, still).boxes).toEqual([]);
  });

  it("only in front of the camera and within LOOK_MAX_DISTANCE_M", () => {
    expect(LOOK_MAX_DISTANCE_M).toBe(40);
    const behind = box({ position: [0, 1, 12], size: [2, 1, 1] });
    const far = box({ position: [0, 1, 8 - 41], size: [4, 4, 4] });
    const near = box({ position: [0, 1, 8 - 39], size: [4, 4, 4] });
    expect(lookCutoutBoxes(scene([behind]), cam, still).boxes).toEqual([]);
    expect(lookCutoutBoxes(scene([far]), cam, still).boxes).toEqual([]);
    expect(lookCutoutBoxes(scene([near]), cam, still).boxes).toHaveLength(1);
  });

  it("not behind structure, as the stage draws it: outside faces only", () => {
    const prop = box({ position: [0, 1, 0], size: [1, 1, 1] });
    // A tall, narrow wall (structure: 7 m tall) between the camera and the
    // prop, clear of the line to the figure.
    const wall = box({ position: [0, 3.5, 3], size: [2, 7, 0.3] });
    const walled = lookCutoutBoxes(scene([prop, wall]), cam, still);
    expect(walled.person).not.toBeNull();
    expect(walled.boxes).toEqual([]);
    // A camera standing inside a big box sees out of it.
    const room = box({ position: [0, 2, 4], size: [12, 8, 12] });
    expect(lookCutoutBoxes(scene([prop, room]), cam, still).boxes).toHaveLength(1);
  });

  it("shapes that touch are one object, with a box for each part that shows — a thin wing on its posts included", () => {
    const body = box({ position: [0, 0.6, 0], size: [2, 0.8, 4.4] });
    const posts = box({ position: [-0.7, 1.15, -1.9], size: [0.08, 0.4, 0.2], repeat: { count: 2, offset: [1.4, 0, 0] } });
    const wing = box({ position: [0, 1.4, -1.9], size: [2.2, 0.08, 0.45] });
    const tailLight = box({ position: [0, 0.8, -2.21], size: [0.3, 0.1, 0.02] });
    const side: ShotCamera = { ...cam, position: [6, 1.6, 3], target: [0, 0.8, 0], figure: { x: -16, z: -2 } };
    const got = lookCutoutBoxes(scene([body, posts, wing, tailLight]), side, still);
    expect(got.objects).toHaveLength(1);
    expect(got.objects[0].shapes).toBe(5);
    const objects = got.boxes.map((b) => b.object);
    expect(objects).toContain(0);
    expect(objects).toContain(2);
    // The tail light lies inside what the body's box already covers on screen.
    expect(objects).not.toContain(3);
  });

  it("shapes apart are objects apart; the largest LOOK_MAX_GROUPS on screen are kept, none under LOOK_MIN_SHARE", () => {
    expect(LOOK_MAX_GROUPS).toBe(3);
    expect(LOOK_MIN_SHARE).toBe(0.01);
    const props = [-3, -1, 1, 3].map((x, i) => box({ position: [x, 0.5, 0], size: [1, 0.4 + i * 0.3, 1] }));
    const got = lookCutoutBoxes(scene(props), cam, still);
    expect(got.objects).toHaveLength(3);
    expect(got.boxes.map((b) => b.object).sort()).toEqual([1, 2, 3]);
    for (let i = 1; i < got.objects.length; i++) expect(got.objects[i].share).toBeLessThanOrEqual(got.objects[i - 1].share);
    // A pebble is not an object.
    expect(lookCutoutBoxes(scene([box({ position: [0, 0.05, 0], size: [0.1, 0.1, 0.1] })]), cam, still).boxes).toEqual([]);
  });

  it("a run of props longer than LOOK_GROUP_MAX_M is scenery", () => {
    expect(LOOK_GROUP_MAX_M).toBe(12);
    const barrier = (count: number) => box({ position: [-4, 0.5, 2], size: [1, 1, 2], repeat: { count, offset: [0, 0, -2] } });
    expect(lookCutoutBoxes(scene([barrier(3)]), cam, still).boxes.length).toBeGreaterThan(0);
    expect(lookCutoutBoxes(scene([barrier(8)]), cam, still).boxes).toEqual([]);
  });

  it("no camera or no still: nothing to cut", () => {
    const prop = box({ position: [0, 1, 0], size: [2, 1, 1] });
    expect(lookCutoutBoxes(scene([prop]), { ...cam, canvasAspect: Number.NaN }, still).boxes).toEqual([]);
    expect(lookCutoutBoxes(scene([prop]), cam, { width: 0, height: 1024 }).boxes).toEqual([]);
  });
});

describe("the money", () => {
  it("is fal's compute-second price times the seconds, and a cut is capped by the wait", () => {
    expect(SAM2_USD_PER_COMPUTE_SECOND).toBe(0.0008);
    // 3 s × $0.0008 = $0.0024 measured; 30 s × $0.0008 = $0.024 at worst.
    expect(LOOK_CUT_MEASURED_USD).toBeCloseTo(0.0024, 10);
    expect(SAM2_TIMEOUT_MS).toBe(30_000);
    expect(LOOK_CUT_WORST_USD).toBeCloseTo(0.024, 10);
  });
});
