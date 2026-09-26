import { describe, expect, it } from "vitest";
import {
  normaliseSetLayout,
  normaliseSetSpec,
  parseSetSpecText,
  SET_LIMITS,
  specInstanceCount,
  specKeyText,
  specNames,
  specTextForGate,
  withoutNames,
  type SetSpec,
} from "./set-spec";
import { createHash } from "node:crypto";
import beach from "./fixtures-beach.json";
import raceTrack from "./fixtures-race-track.json";
import showroomClosed from "./fixtures-showroom-closed.json";
import showroomOpen from "./fixtures-showroom-open.json";
import { LENSES_MM, fovForLens, nearestLens } from "./build-scene";
import { RIG_FORMAT_ORDER, RIG_SENSOR_ORDER, sensorHeightMm } from "./rig";
import { normaliseShotCamera } from "./look-cutout";
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
      pose: "stand",
      gaze: null,
    });
    // The eye-line (cut D) rides the arrangement; a thing it names must exist.
    expect(normaliseSetLayout({ markId: "m2", gaze: { at: "camera" } }, spec)?.gaze).toEqual({ at: "camera" });
    expect(normaliseSetLayout({ markId: "m2", gaze: { at: "object", index: 99 } }, spec)?.gaze).toBeNull();
  });

  it("falls back to the first mark for an unknown id", () => {
    expect(normaliseSetLayout({ markId: "evil" }, spec)?.markId).toBe("m1");
  });

  it("bounds a placed camera like a model's", () => {
    const l = normaliseSetLayout({ camera: { position: [99, 99, 99], target: [0, 1, 0], fovDeg: 1 } }, spec);
    expect(l?.camera?.position).toEqual([15, 10, 15]);
    expect(l?.camera?.fovDeg).toBe(SET_LIMITS.minLayoutFovDeg);
  });

  it("keeps every lens on the stage through a save, the long ones included", () => {
    // A saved 85 or 135 mm used to come back from a reload at Astra's 20°
    // floor, about a 68 mm view, with the 85 mm chip still lit.
    for (const mm of LENSES_MM) {
      const fovDeg = fovForLens(mm);
      const l = normaliseSetLayout({ camera: { position: [0, 1.6, 6], target: [0, 1.4, 0], fovDeg } }, spec);
      expect(l?.camera?.fovDeg, `${mm} mm`).toBe(fovDeg);
      expect(nearestLens(l?.camera?.fovDeg ?? 0), `${mm} mm`).toBe(mm);
    }
    // Astra's own cameras keep the floor its instructions quote.
    expect(SET_LIMITS.minLayoutFovDeg).toBeLessThan(SET_LIMITS.minFovDeg);
  });

  it("keeps every lens on every SENSOR too, and lets each one's still be a look", () => {
    // The floor was 10°, which is the 135 mm chip on full frame — a number
    // in degrees named for one sensor while the ring picks millimetres on
    // six. Nine lens-and-sensor pairs fell under it: a 135 mm on Super 35 is
    // 7.92°, so it came back from a reload as an 85 mm, and its still could
    // never be a look, because a camera under the floor is refused rather
    // than clamped (found reviewing Helios, fixed 2026-09-18).
    for (const sensor of RIG_SENSOR_ORDER) {
      for (const format of RIG_FORMAT_ORDER) {
        const h = sensorHeightMm(sensor, format);
        for (const mm of LENSES_MM) {
          const where = `${mm} mm on ${sensor}/${format}`;
          // As the stage hands it over: api.pose() rounds to two decimals.
          const fovDeg = Math.round(fovForLens(mm, h) * 100) / 100;
          const l = normaliseSetLayout({ camera: { position: [0, 1.6, 6], target: [0, 1.4, 0], fovDeg } }, spec);
          expect(l?.camera?.fovDeg, where).toBe(fovDeg);
          expect(nearestLens(l?.camera?.fovDeg ?? 0, h), where).toBe(mm);
          // And the frame it was shot from is a camera, so the still can be a look.
          expect(
            normaliseShotCamera({ position: [0, 1.6, 6], target: [0, 1.4, 0], fovDeg, canvasAspect: 1, figure: { x: 0, z: 0 } }),
            where,
          ).not.toBeNull();
        }
      }
    }
    // The two floors: what a camera KEEPS, and the longest lens a match may
    // solve to and name — which is still the 135 mm chip on full frame.
    expect(SET_LIMITS.minLayoutFovDeg).toBeLessThan(SET_LIMITS.minMatchFovDeg);
    expect(SET_LIMITS.minMatchFovDeg).toBeLessThanOrEqual(fovForLens(Math.max(...LENSES_MM)));
  });

  it("refuses what is not an arrangement", () => {
    expect(normaliseSetLayout("x", spec)).toBeNull();
    expect(normaliseSetLayout(null, spec)).toBeNull();
  });
});

describe("the material word", () => {
  // Canvas page J, cut 1 (2026-09-17): a word per object and one for the
  // ground; anything else is null, and the stage infers one.
  const minimal = { objects: [{ shape: "box", size: [1, 1, 1] }] };

  it("is kept when it is one of ours, and null otherwise", () => {
    const said = normaliseSetSpec({ ...minimal, objects: [{ shape: "box", size: [1, 1, 1], material: "brick" }], ground: { material: "grass" } });
    if (!said.ok) throw new Error("spec");
    expect(said.spec.objects[0].material).toBe("brick");
    expect(said.spec.ground.material).toBe("grass");

    const invented = normaliseSetSpec({ ...minimal, objects: [{ shape: "box", size: [1, 1, 1], material: "unobtainium" }], ground: { material: 7 } });
    if (!invented.ok) throw new Error("spec");
    expect(invented.spec.objects[0].material).toBeNull();
    expect(invented.spec.ground.material).toBeNull();

    const unsaid = normaliseSetSpec(minimal);
    if (!unsaid.ok) throw new Error("spec");
    expect(unsaid.spec.objects[0].material).toBeNull();
    expect(unsaid.spec.ground.material).toBeNull();
  });
});

describe("an area light", () => {
  // The light department (cut 3): a soft rectangle facing its target.
  const minimal = { objects: [{ shape: "box", size: [1, 1, 1] }] };
  it("keeps its size, clamped, and every other kind has none", () => {
    const r = normaliseSetSpec({ ...minimal, lights: [{ kind: "area", size: [2, 40], intensity: 12 }, { kind: "spot", size: [2, 2] }] });
    if (!r.ok) throw new Error("spec");
    expect(r.spec.lights[0].kind).toBe("area");
    expect(r.spec.lights[0].size).toEqual([2, 30]);
    expect(r.spec.lights[0].intensity).toBe(12);
    expect(r.spec.lights[1].size).toBeNull();
    const bare = normaliseSetSpec({ ...minimal, lights: [{ kind: "area" }] });
    if (!bare.ok) throw new Error("spec");
    expect(bare.spec.lights[0].size).toEqual([1, 1]);
  });
});

describe("the layout's pose (cut 5)", () => {
  it("is one of the stand-in's, standing by default", () => {
    const r = normaliseSetSpec({ objects: [{ shape: "box", size: [1, 1, 1] }], marks: [{ x: 3, z: 3, facingDeg: 0 }] });
    if (!r.ok) throw new Error("spec");
    expect(normaliseSetLayout({ markId: "m1" }, r.spec)?.pose).toBe("stand");
    expect(normaliseSetLayout({ markId: "m1", pose: "sit" }, r.spec)?.pose).toBe("sit");
    expect(normaliseSetLayout({ markId: "m1", pose: "fly" }, r.spec)?.pose).toBe("stand");
  });
});

// Names on objects (Helios Cut 4, step B1, 2026-09-26). A name is shown on
// screen and read by the chat and Aly, and never part of anything that
// moves money or keys. Every set saved before names must load exactly as
// it did: its JSON is what a film's key and the page's copy are made of.
describe("an object's name", () => {
  const sha = (spec: SetSpec) => createHash("sha256").update(JSON.stringify(spec)).digest("hex").slice(0, 16);

  it("leaves every set saved before names byte for byte as it was (the five fixtures, hashed before B1)", () => {
    const before: [unknown, number, string][] = [
      [beach, 10100, "eeee568a1584b930"],
      [raceTrack, 12971, "ff0d09addf335a75"],
      [rainyMarket, 11534, "6657b677787152c3"],
      [showroomClosed, 13078, "2d752e2d736d1d67"],
      [showroomOpen, 11627, "56412d8b749e7a44"],
    ];
    for (const [fixture, length, hash] of before) {
      const spec = ok(fixture);
      expect(JSON.stringify(spec)).toHaveLength(length);
      expect(sha(spec)).toBe(hash);
      expect(JSON.stringify(spec)).not.toContain('"name"');
      expect(spec.objects.every((o) => !("name" in o))).toBe(true);
      // The key text of an unnamed set is its JSON.
      expect(specKeyText(spec)).toBe(JSON.stringify(spec));
      expect(withoutNames(spec)).toBe(spec);
    }
  });

  it("is cleaned and capped like a label, kept as written, and left out when blank — never null or empty", () => {
    const s = ok({
      objects: [
        box({ name: "  Red\u202e sports   car " }),
        box({ name: "n".repeat(100) }),
        box({ name: "   " }),
        box({ name: null }),
        box({ name: 42 }),
        box({ name: "The grandstand" }),
      ],
    });
    expect(s.objects[0].name).toBe("Red sports car");
    expect(s.objects[1].name).toBe("n".repeat(SET_LIMITS.nameChars));
    expect(SET_LIMITS.nameChars).toBe(32);
    for (const i of [2, 3, 4]) expect("name" in s.objects[i]).toBe(false);
    // No word is taken off (an article is the naming pass's not to write, in any language).
    expect(s.objects[5].name).toBe("The grandstand");
    // Last among the object's keys, and read back unchanged.
    expect(Object.keys(s.objects[0]).at(-1)).toBe("name");
    expect(JSON.stringify(ok(JSON.parse(JSON.stringify(s))))).toBe(JSON.stringify(s));
  });

  it("never moves the set's key: specKeyText and withoutNames take every name off", () => {
    const plain = ok(raceTrack);
    const named = ok({ ...plain, objects: plain.objects.map((o, i) => (i % 3 === 0 ? { ...o, name: `thing ${i}` } : o)) });
    expect(JSON.stringify(named)).not.toBe(JSON.stringify(plain));
    expect(specKeyText(named)).toBe(specKeyText(plain));
    expect(JSON.stringify(withoutNames(named))).toBe(JSON.stringify(plain));
    // The named copy itself is left as it was.
    expect(named.objects[0].name).toBe("thing 0");
  });

  it("is read by the gate with every other word a person will read: each name once, sorted, after the rest", () => {
    const s = ok({
      title: "T",
      description: "D",
      objects: [box({ name: "red sports car" }), box({ name: "grandstand" }), box({ name: "red sports car" }), box()],
      marks: [{ label: "M", x: 0, z: 0, facingDeg: 0 }],
      cameras: [{ label: "C", position: [0, 2, 5], target: [0, 1, 0], fovDeg: 40 }],
    });
    expect(specNames(s)).toEqual(["grandstand", "red sports car"]);
    expect(specTextForGate(s).split("\n")).toEqual(["T", "D", "C", "M", "grandstand", "red sports car"]);
    // A set without names reads exactly as before.
    const plain = ok({ ...s, objects: s.objects.map((o) => ({ ...o, name: undefined })) });
    expect(specTextForGate(plain)).toBe("T\nD\nC\nM");
  });
});
