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
  photoThingsChanged,
  planShotSheets,
  resolvePhotos,
  capitalised,
  largestBlockOf,
  setElements,
  setOwnBlocks,
  setParts,
  thingLabelText,
  thingLabels,
  thingNameOf,
  thingRowText,
  type ThingWords,
  type ElementPhoto,
  type HeldPhotos,
} from "./elements";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

// Helios Cut 4, step A7: after an Astra change, a note names each thing
// the change touched that its own photos draw in stills.
describe("photoThingsChanged: an edit that meets a thing drawn from its own photos", () => {
  const els = setElements(race);
  const car = els[0];
  const onCar = (i: number) => car.members.some((m) => m[0] === i);
  const photos = [photo(car.key)];
  const recolour = (spec: SetSpec): SetSpec => ({ ...spec, objects: spec.objects.map((o, i) => (onCar(i) ? { ...o, color: "#aa2222" } : o)) });

  it("names the car when its blocks change colour, under the key its photos found after", () => {
    const red = recolour(race);
    const after = setElements(red);
    const keys = photoThingsChanged(els, after, photos);
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toBe(car.key);
    expect(keys).toEqual(resolvePhotos(after, photos).held.map((h) => h.key));
  });

  it("says nothing for a car with no photos, a car only moved, or a change elsewhere", () => {
    expect(photoThingsChanged(els, setElements(recolour(race)), [])).toEqual([]);
    const moved: SetSpec = { ...race, objects: race.objects.map((o, i) => (onCar(i) ? { ...o, position: [o.position[0] + 3, o.position[1], o.position[2]] as Vec3 } : o)) };
    expect(photoThingsChanged(els, setElements(moved), photos)).toEqual([]);
    const structure = race.objects.findIndex((_, i) => !onCar(i));
    const elsewhere: SetSpec = { ...race, objects: race.objects.map((o, i) => (i === structure ? { ...o, color: "#123456" } : o)) };
    expect(photoThingsChanged(els, setElements(elsewhere), photos)).toEqual([]);
  });

  it("reads the blocks, not their order: a rewrite that reorders the objects says nothing", () => {
    const reordered: SetSpec = { ...race, objects: [...race.objects].reverse() };
    expect(photoThingsChanged(els, setElements(reordered), photos)).toEqual([]);
    expect(photoThingsChanged(els, setElements(recolour(reordered)), photos)).toHaveLength(1);
  });

  it("says nothing when the photos were on nothing before", () => {
    const gone: SetSpec = { ...race, objects: race.objects.filter((_, i) => !onCar(i)) };
    expect(photoThingsChanged(setElements(gone), els, photos)).toEqual([]);
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

// Names on things (Helios Cut 4, step B1, 2026-09-26): a thing's key and
// the photos on it are made of its blocks' shapes, sizes, colours and
// materials, never their names, so naming a set moves no photo and no
// sheet; a thing's name is the one most of its blocks carry.
describe("names on things", () => {
  const named = (spec: SetSpec): SetSpec => ({ ...spec, objects: spec.objects.map((o, i) => ({ ...o, name: `block ${i}` })) });

  it("leave every thing's key, members and fingerprint as they were, on all five fixtures", () => {
    for (const spec of [race, load(showroomOpen), load(showroomClosed), load(rainyMarket), load(beach)]) {
      expect(JSON.stringify(setElements(named(spec)))).toBe(JSON.stringify(setElements(spec)));
    }
  });

  it("never enter a block's signature (pinned as source)", () => {
    const src = readFileSync(join(__dirname, "elements.ts"), "utf8");
    expect(src).toContain('const signature = (o: SetObject) => `${o.shape}|${o.size.map(cm).join(",")}|${o.color}|${o.material ?? ""}|${o.emissive ?? ""}`;');
  });

  it("are the name most of a thing's blocks carry, counted per copy; a tie goes to the largest block's; none is null", () => {
    const car = setElements(race).find((e) => e.kind === "car")!;
    const blocks = [...new Set(car.members.map(([o]) => o))];
    expect(thingNameOf(car, race)).toBeNull();
    const withNames = (pick: (oi: number, n: number) => string | undefined): SetSpec => ({
      ...race,
      objects: race.objects.map((o, i) => {
        const at = blocks.indexOf(i);
        const name = at >= 0 ? pick(i, at) : undefined;
        return name === undefined ? o : { ...o, name };
      }),
    });
    // Most blocks: the car.
    expect(thingNameOf(car, withNames((_, n) => (n === 0 ? "wheel" : "red sports car")))).toBe("red sports car");
    // Blocks without a name don't vote.
    expect(thingNameOf(car, withNames((_, n) => (n === 0 ? "wheel" : undefined)))).toBe("wheel");
    // Counted per copy: a repeated block counts as often as it is drawn.
    const repeated = car.members.find(([o], _, all) => all.filter(([p]) => p === o).length > 1)?.[0];
    if (repeated !== undefined) {
      const copies = car.members.filter(([o]) => o === repeated).length;
      const others = blocks.filter((o) => o !== repeated).slice(0, copies - 1);
      expect(thingNameOf(car, withNames((oi) => (oi === repeated ? "tyres" : others.includes(oi) ? "body" : undefined)))).toBe("tyres");
    }
    // A tie: the largest block's name.
    const volume = (oi: number) => race.objects[oi].size[0] * race.objects[oi].size[1] * race.objects[oi].size[2];
    const single = blocks.filter((o) => car.members.filter(([p]) => p === o).length === 1).sort((a, b) => volume(b) - volume(a));
    const [big, small] = [single[0], single[single.length - 1]];
    expect(thingNameOf(car, withNames((oi) => (oi === big ? "body" : oi === small ? "mirror" : undefined)))).toBe("body");
  });
});

// One naming rule (Helios Cut 4, step B2, 2026-09-26): every place that
// names a thing reads labelOf — its name when the set gives it one, else
// "Car", "Car 2" — and lists add an unnamed thing's colour.
describe("one naming rule", () => {
  const W: ThingWords = { car: "Car", carN: "Car {n}", vehicle: "Vehicle", vehicleN: "Vehicle {n}", object: "Object", objectN: "Object {n}", namedN: "{name} {n}" };
  const COLOURS = Object.fromEntries(["red", "orange", "yellow", "olive", "green", "teal", "cyan", "blue", "navy", "purple", "pink", "brown", "black", "white", "grey"].map((c) => [c, c])) as Parameters<typeof thingRowText>[2];
  const showroom = load(showroomOpen);
  const els = setElements(showroom);
  const named = (spec: SetSpec, pick: (oi: number) => string | undefined): SetSpec => ({
    ...spec,
    objects: spec.objects.map((o, i) => {
      const name = pick(i);
      return name === undefined ? o : { ...o, name };
    }),
  });

  it("keeps today's names on a set without any, and adds each thing's colour, from its largest block", () => {
    const labels = thingLabels(showroom, els);
    expect(labels.map((l) => l.key)).toEqual(els.map((e) => e.key));
    for (const [i, l] of labels.entries()) {
      const e = els[i];
      const several = els.filter((x) => x.kind === e.kind).length > 1;
      const kind = e.kind === "car" ? "Car" : e.kind === "vehicle" ? "Vehicle" : "Object";
      expect(thingLabelText(l, W)).toBe(several ? `${kind} ${e.ordinal}` : kind);
      expect(l.name).toBeNull();
      expect(l.sameNameIndex).toBe(0);
      expect(l.largest).toBe(largestBlockOf(e, showroom.objects));
      expect(thingRowText(l, W, COLOURS)).toBe(`${thingLabelText(l, W)} · ${l.colour}`);
    }
  });

  it("calls a named thing by its name, capitalised, and numbers a second thing of the same name", () => {
    // Two things of one kind (the showroom's objects; no fixture has two cars).
    const cars = els.filter((e) => e.kind === "object");
    expect(cars.length).toBeGreaterThan(1);
    const blocksOf = (e: (typeof els)[number]) => new Set(e.members.map(([o]) => o));
    const [a, b] = [blocksOf(cars[0]), blocksOf(cars[1])];
    const spec = named(showroom, (i) => (a.has(i) ? "red sports car" : b.has(i) ? "Red Sports Car" : undefined));
    const labels = thingLabels(spec, els);
    const la = labels.find((l) => l.key === cars[0].key)!;
    const lb = labels.find((l) => l.key === cars[1].key)!;
    expect(thingLabelText(la, W)).toBe("Red sports car");
    expect(thingLabelText(lb, W)).toBe("Red Sports Car 2");
    // A named thing's row is its name alone.
    expect(thingRowText(la, W, COLOURS)).toBe("Red sports car");
    // The grouping never moves: the same things, the same keys.
    expect(setElements(spec).map((e) => e.key)).toEqual(els.map((e) => e.key));
    // A name is filled in one pass: "{n}" or "$&" in it stays as written.
    const odd = thingLabels(named(showroom, (i) => (a.has(i) || b.has(i) ? "car {n} $&" : undefined)), els);
    expect(thingLabelText(odd.find((l) => l.key === cars[1].key)!, W)).toBe("Car {n} $& 2");
    // Unnamed things beside them keep their kind and number.
    const other = labels.find((l) => l.name === null)!;
    expect(thingLabelText(other, W)).toMatch(/^(Car|Object \d+)$/);
  });

  it("capitalises the first letter only, in any script", () => {
    expect(capitalised("grandstand")).toBe("Grandstand");
    expect(capitalised("éclairage")).toBe("Éclairage");
    expect(capitalised("pit wall")).toBe("Pit wall");
    expect(capitalised("")).toBe("");
  });

  it("lists as parts only the set's own blocks with a name, grouped by it (ignoring case), and the largest of each", () => {
    const own = setOwnBlocks(race, setElements(race));
    const inThing = new Set(setElements(race).flatMap((e) => e.members.map(([o]) => o)));
    expect(own.length + inThing.size).toBe(race.objects.length);
    expect(own.some((i) => inThing.has(i))).toBe(false);
    expect(setParts(race, setElements(race))).toEqual([]);
    const [s1, s2, s3] = own;
    const car = [...inThing][0];
    const spec = named(race, (i) => (i === s1 || i === s2 ? (i === s1 ? "Grandstand" : "grandstand") : i === s3 ? "pit wall" : i === car ? "red sports car" : undefined));
    const parts = setParts(spec, setElements(spec));
    expect(parts.map((p) => p.name)).toEqual(["Grandstand", "pit wall"]);
    expect(parts[0].objects).toEqual([s1, s2]);
    const vol = (i: number) => race.objects[i].size.reduce((x, y) => x * y, 1);
    expect(parts[0].largest).toBe(vol(s2) > vol(s1) ? s2 : s1);
    // A thing's block with a name is never a part.
    expect(parts.some((p) => p.objects.includes(car))).toBe(false);
  });
});
