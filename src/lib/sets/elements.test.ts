import { describe, expect, it } from "vitest";
import raceTrack from "./fixtures-race-track.json";
import showroomOpen from "./fixtures-showroom-open.json";
import showroomClosed from "./fixtures-showroom-closed.json";
import rainyMarket from "./fixtures-rainy-market.json";
import beach from "./fixtures-beach.json";
import { normaliseSetSpec, type SetSpec, type Vec3 } from "./set-spec";
import { findVehicles } from "./vehicles";
import { addKit, duplicateObject, patchObject, removeObject } from "./editor-model";
import { kitObjects } from "./kit";
import {
  ALIKE_DEPTH_RATIO,
  ALIKE_HEIGHT_M,
  ELEMENT_KEY_RE,
  ELEMENT_NAMING_SENTENCE,
  ELEMENT_PHOTOS_MAX,
  ELEMENT_SHEETS_PER_STILL,
  FIGURE_KEY,
  copyToElement,
  elementPlaces,
  planSheets,
  planShotSheets,
  resolvePhotos,
  setElements,
  type ElementPhoto,
  type HeldPhotos,
} from "./elements";

// The set's things (the per-thing reference photos, R1, 2026-09-21): which
// blocks make one car or one object, the key a photo keeps, how a photo
// finds its thing after the set changes, and which things' sheets ride a
// still, named by where they stand. The numbers are the five fixtures' own.

const load = (raw: unknown): SetSpec => {
  const n = normaliseSetSpec(raw);
  if (!n.ok) throw new Error("fixture");
  return n.spec;
};
const race = load(raceTrack);
const open = load(showroomOpen);
const cameraOf = (spec: SetSpec, id: string) => {
  const c = spec.cameras.find((x) => x.id === id)!;
  return { position: c.position, target: c.target, fovDeg: c.fovDeg, canvasAspect: 1, figure: { x: spec.marks[0].x, z: spec.marks[0].z } };
};
const photo = (anchor: string | null, over: Partial<ElementPhoto> = {}): ElementPhoto => ({
  refId: "11111111-1111-4111-8111-111111111111",
  anchor,
  slot: 1,
  at: 1,
  url: "/x.jpg",
  ...over,
});

describe("setElements", () => {
  it("makes the race track's car one thing: 25 objects, 48 copies, and none of the track", () => {
    const els = setElements(race);
    expect(els).toHaveLength(1);
    const car = els[0];
    expect(car.kind).toBe("car");
    expect(car.key).toBe("c_89e319be_0_-1");
    expect(car.key).toMatch(ELEMENT_KEY_RE);
    expect(new Set(car.members.map((m) => m[0])).size).toBe(25);
    expect(car.members).toHaveLength(48);
    expect(car.centre).toEqual([0, 0.77, -0.06]);
    expect([0, 1, 2].map((i) => Math.round((car.max[i] - car.min[i]) * 100) / 100)).toEqual([2.42, 1.54, 4.71]);
    expect(car.anchor).toEqual([0, Math.round((car.max[1] + 0.15) * 100) / 100, -0.06]);
    const inCar = new Set(car.members.map((m) => m[0]));
    expect(race.objects.length - inCar.size).toBe(24);
  });

  it("finds each fixture's things, and never a car that isn't one", () => {
    const openEls = setElements(open);
    expect(openEls).toHaveLength(6);
    expect(openEls.map((e) => e.key)).toContain("o_e7e730d5_-73_-65");
    expect(openEls.map((e) => e.key)).toContain("o_e7e730d5_-53_-65");
    expect(openEls.filter((e) => e.kind === "car")).toHaveLength(1);
    const closedEls = setElements(load(showroomClosed));
    expect(closedEls).toHaveLength(7);
    expect(closedEls.filter((e) => e.kind === "car")).toHaveLength(1);
    const market = setElements(load(rainyMarket));
    expect(market.map((e) => e.kind)).toEqual(["object", "object", "object"]);
    const sand = setElements(load(beach));
    expect(sand).toHaveLength(6);
    expect(sand.every((e) => e.kind === "object")).toBe(true);
  });

  it("numbers things per kind in the spec's order", () => {
    const els = setElements(open);
    expect(els.filter((e) => e.kind === "object").map((e) => e.ordinal)).toEqual([1, 2, 3, 4, 5]);
    expect(els.find((e) => e.kind === "car")!.ordinal).toBe(1);
  });

  it("gives the same keys after a round trip through JSON and the gatekeeper", () => {
    expect(setElements(load(JSON.parse(JSON.stringify(race)))).map((e) => e.key)).toEqual(setElements(race).map((e) => e.key));
  });

  it("reads two touching cars as one vehicle, and two apart as two cars", () => {
    const two = (gap: number) => setElements(load(JSON.parse(JSON.stringify({ ...race, objects: [...kitObjects("car", [20, 20], 0), ...kitObjects("car", [20 + gap, 20], 0)] }))));
    expect(two(2.2).map((e) => `${e.kind}/${e.tyres}`)).toEqual(["vehicle/8"]);
    expect(two(2.6).map((e) => `${e.kind}/${e.tyres}`)).toEqual(["car/4", "car/4"]);
  });

  it("maps every block copy to its thing", () => {
    const [car] = setElements(race);
    const map = copyToElement([car]);
    expect(map.size).toBe(48);
    for (const [oi, copy] of car.members) expect(map.get(`${oi}:${copy}`)).toBe(car.key);
  });

  it("works a big set out fast", () => {
    const big = { ...race, objects: Array.from({ length: 300 }, (_, i) => ({ ...race.objects[0], position: [(i % 20) * 3, 0.5, Math.floor(i / 20) * 3] as Vec3 })) };
    // The fastest of five runs: a run the machine interrupts measures the
    // machine, not the code (86 and 129 ms with three suites running at once,
    // 2026-09-22), and a slow setElements is slow every time.
    const runs = Array.from({ length: 5 }, () => {
      const t0 = performance.now();
      setElements(big);
      return performance.now() - t0;
    });
    expect(Math.min(...runs)).toBeLessThan(50);
  });

  it("keeps its limits where the plan set them", () => {
    expect(FIGURE_KEY).toBe("figure");
    expect(ELEMENT_PHOTOS_MAX).toBe(4);
    // Two until the paid proof times a render with more.
    expect(ELEMENT_SHEETS_PER_STILL).toBe(2);
  });
});

describe("resolvePhotos: a photo finds its thing after the set changes", () => {
  const car = setElements(race)[0];
  const carObject = car.members[0][0];
  const structure = race.objects.findIndex((_, i) => !car.members.some((m) => m[0] === i));
  const held = (spec: SetSpec) => resolvePhotos(setElements(spec), [photo(car.key)]);

  it("keeps the exact key through small edits and edits elsewhere", () => {
    const edits = [
      patchObject(race, carObject, { position: [race.objects[carObject].position[0] + 0.05, race.objects[carObject].position[1], race.objects[carObject].position[2]] }),
      duplicateObject(race, structure),
      removeObject(race, structure),
      addKit(race, "car", [10, 10], 90),
    ];
    for (const e of edits) {
      expect(e.ok).toBe(true);
      if (!e.ok) continue;
      const r = held(e.spec);
      expect(r.held.map((h) => [h.key, h.how])).toEqual([[car.key, "exact"]]);
      expect(r.loose).toEqual([]);
    }
  });

  it("follows the car when it moves, and when it is recoloured", () => {
    const moved: SetSpec = { ...race, objects: race.objects.map((o, i) => (car.members.some((m) => m[0] === i) ? { ...o, position: [o.position[0] + 3, o.position[1], o.position[2]] as Vec3 } : o)) };
    expect(held(moved).held.map((h) => [h.key, h.how])).toEqual([["c_89e319be_30_-1", "moved"]]);
    const red: SetSpec = { ...race, objects: race.objects.map((o, i) => (car.members.some((m) => m[0] === i) ? { ...o, color: "#aa2222" } : o)) };
    const r = held(red).held;
    expect(r).toHaveLength(1);
    expect(r[0].how).toBe("changed");
    expect(r[0].key).not.toBe(car.key);
  });

  it("puts a photo on nothing when its thing left, and one from before R1 on nothing until it is put on something", () => {
    const gone: SetSpec = { ...race, objects: race.objects.filter((_, i) => !car.members.some((m) => m[0] === i)) };
    expect(held(gone).loose.map((l) => l.why)).toEqual(["gone"]);
    expect(resolvePhotos(setElements(race), [photo(null)]).loose.map((l) => l.why)).toEqual(["unassigned"]);
  });

  it("never lets a follower take a thing that holds its own photos", () => {
    const shifted = "c_89e319be_5_-1";
    const r = resolvePhotos(setElements(race), [photo(car.key), photo(shifted, { refId: "22222222-2222-4222-8222-222222222222" })]);
    expect(r.held.map((h) => h.key)).toEqual([car.key]);
    expect(r.held[0].photos).toHaveLength(1);
    expect(r.loose.map((l) => l.why)).toEqual(["taken"]);
  });

  it("sends a front and three more, keeps any fifth as extra, and the sheet follows only the photos", () => {
    const ids = ["a", "b", "c", "d", "e"].map((c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`);
    const five = ids.map((refId, i) => photo(car.key, { refId, slot: (i < 4 ? i + 1 : null) as ElementPhoto["slot"], at: i }));
    const r = resolvePhotos(setElements(race), [...five].reverse()).held[0];
    expect(r.photos.map((p) => p.refId)).toEqual(ids.slice(0, 4));
    expect(r.extra.map((p) => p.refId)).toEqual([ids[4]]);
    const same = resolvePhotos(setElements(race), five).held[0];
    expect(same.sheetHash).toBe(r.sheetHash);
    const other = resolvePhotos(setElements(race), five.slice(1)).held[0];
    expect(other.sheetHash).not.toBe(r.sheetHash);
  });
});

describe("elementPlaces", () => {
  it("sees the race track's car in the middle through c1 and c2, and hidden behind the grandstand's run through c3", () => {
    const els = setElements(race);
    for (const id of ["c1", "c2"]) {
      const [p] = elementPlaces(race, els, cameraOf(race, id));
      expect(p.seen && p.across).toBe("middle");
    }
    const [c3] = elementPlaces(race, els, cameraOf(race, "c3"));
    expect(c3).toEqual({ key: els[0].key, seen: false, why: "hidden" });
  });
});

describe("planSheets", () => {
  const els = setElements(open);
  const places = elementPlaces(open, els, cameraOf(open, "c2"));
  const plan = (budget: number, order?: string[]) =>
    planSheets({ els, places, withPhotos: els.map((e) => e.key), order, vehicles: findVehicles(open), camera: cameraOf(open, "c2"), budget });

  it("sends the largest things first, leaves a twin chair out as too alike, and one out of frame", () => {
    const { plan: p, sentences } = plan(4);
    expect(p.filter((x) => x.status === "rides").map((x) => x.key)).toEqual(["c_7318aa94_0_0", "o_cf22a19a_30_16", "o_e7e730d5_-53_-65", "o_fa79ffcc_-63_-45"]);
    expect(p.find((x) => x.key === "o_e7e730d5_-73_-65")).toEqual({ key: "o_e7e730d5_-73_-65", status: "alike", like: 3 });
    expect(p.find((x) => x.key === "o_deaec83d_64_-65")).toEqual({ key: "o_deaec83d_64_-65", status: "not-in-frame", why: "out" });
    expect(sentences).toEqual([
      "Sheet 1 is the car in the middle of the frame, nearest the camera, which is turned three-quarters toward the camera, its front toward frame left.",
      "Sheet 2 is the object at the right of the frame, 1.3 m tall.",
      "Sheet 3 is the object in the middle of the frame, third from the camera, 1.1 m tall.",
      "Sheet 4 is the object in the middle of the frame, second from the camera, 0.4 m tall.",
    ]);
  });

  it("counts every thing seen in a third for the rank, with photos or without", () => {
    // Only the chair has photos; the car and the other chairs still stand in the middle third.
    const { sentences } = planSheets({ els, places, withPhotos: ["o_e7e730d5_-53_-65"], vehicles: findVehicles(open), camera: cameraOf(open, "c2"), budget: 4 });
    expect(sentences).toEqual(["That sheet is the object in the middle of the frame, third from the camera, 1.1 m tall."]);
  });

  it("keeps to the budget, saying no room for the rest, and puts the person's order first", () => {
    const { plan: p } = plan(2);
    expect(p.filter((x) => x.status === "rides")).toHaveLength(2);
    // The twin chair is no room here, not too alike: its twin didn't ride.
    expect(p.filter((x) => x.status === "no-room").map((x) => x.key)).toEqual(["o_e7e730d5_-53_-65", "o_e7e730d5_-73_-65", "o_fa79ffcc_-63_-45"]);
    const ordered = plan(2, ["o_fa79ffcc_-63_-45"]).plan;
    expect(ordered.find((x) => x.status === "rides" && x.sheet === 1)?.key).toBe("o_fa79ffcc_-63_-45");
  });

  it("writes one rule for too alike: same third, same kind, within 0.2 m of height and 15% of distance", () => {
    expect(ALIKE_HEIGHT_M).toBe(0.2);
    expect(ALIKE_DEPTH_RATIO).toBe(1.15);
  });

  it("writes sentences the scaffold pattern knows, with no model-written words", () => {
    for (const id of ["c1", "c2", "c3"]) {
      for (const spec of [open, race, load(showroomClosed), load(rainyMarket), load(beach)]) {
        const cam = spec.cameras.find((c) => c.id === id);
        if (!cam) continue;
        const e = setElements(spec);
        const sc = { position: cam.position, target: cam.target, fovDeg: cam.fovDeg, canvasAspect: 1, figure: { x: spec.marks[0].x, z: spec.marks[0].z } };
        const { sentences } = planSheets({ els: e, places: elementPlaces(spec, e, sc), withPhotos: e.map((x) => x.key), vehicles: findVehicles(spec), camera: cam, budget: 4 });
        for (const t of sentences) {
          expect(t.match(ELEMENT_NAMING_SENTENCE), t).toEqual([t]);
          expect(t).not.toContain("#");
        }
      }
    }
  });
});

describe("planShotSheets: only a drawn sheet rides", () => {
  const els = setElements(open);
  const heldOf = (keys: readonly string[]): HeldPhotos[] =>
    keys.map((key, n) => ({ key, photos: [photo(key, { refId: `1111111${n}-1111-4111-8111-111111111111` })], extra: [], how: "exact", sheetHash: `h${n}` }));
  const all = heldOf(els.map((e) => e.key));
  const hashOf = (key: string) => all.find((h) => h.key === key)!.sheetHash;
  const shot = (over: Partial<Parameters<typeof planShotSheets>[0]> = {}) =>
    planShotSheets({
      els,
      held: all,
      sheets: all.map((h) => h.sheetHash),
      vehicles: findVehicles(open),
      shotCamera: cameraOf(open, "c2"),
      poseCamera: null,
      budget: 2,
      spec: open,
      ...over,
    });

  it("sends the planned sheets, by hash, in sheet order", () => {
    const r = shot();
    expect(r.riding).toEqual([
      { key: "c_7318aa94_0_0", hash: hashOf("c_7318aa94_0_0") },
      { key: "o_cf22a19a_30_16", hash: hashOf("o_cf22a19a_30_16") },
    ]);
    expect(r.statuses.filter((x) => x.status === "rode")).toEqual([
      { key: "c_7318aa94_0_0", status: "rode", sheet: 1 },
      { key: "o_cf22a19a_30_16", status: "rode", sheet: 2 },
    ]);
    expect(r.sentences).toHaveLength(2);
    expect(r.statuses.find((x) => x.key === "o_deaec83d_64_-65")).toEqual({ key: "o_deaec83d_64_-65", status: "out" });
  });

  it("gives a thing whose sheet is not drawn no place, and the next thing takes it, numbered again", () => {
    const r = shot({ sheets: all.filter((h) => h.key !== "c_7318aa94_0_0").map((h) => h.sheetHash) });
    expect(r.riding.map((x) => x.key)).toEqual(["o_cf22a19a_30_16", "o_e7e730d5_-53_-65"]);
    expect(r.statuses).toContainEqual({ key: "c_7318aa94_0_0", status: "no-sheet" });
    // The car still stands in the middle third, so the chair is still third from the camera.
    expect(r.sentences).toEqual([
      "Sheet 1 is the object at the right of the frame, 1.3 m tall.",
      "Sheet 2 is the object in the middle of the frame, third from the camera, 1.1 m tall.",
    ]);
  });

  it("says a thing out of the frame is out, drawn or not", () => {
    const r = shot({ sheets: [] });
    expect(r.statuses.find((x) => x.key === "o_deaec83d_64_-65")).toEqual({ key: "o_deaec83d_64_-65", status: "out" });
    expect(r.riding).toEqual([]);
  });

  it("sends none to a picture model that takes no sheets, and says so", () => {
    const r = shot({ budget: 0 });
    expect(r.riding).toEqual([]);
    expect(r.sentences).toEqual([]);
    expect(r.statuses.find((x) => x.key === "c_7318aa94_0_0")).toEqual({ key: "c_7318aa94_0_0", status: "model" });
  });

  it("with no camera sees nothing, and with no photos says nothing", () => {
    expect(shot({ shotCamera: null }).statuses.every((x) => x.status === "out")).toBe(true);
    expect(shot({ held: [] })).toEqual({ riding: [], sentences: [], statuses: [] });
  });
});
