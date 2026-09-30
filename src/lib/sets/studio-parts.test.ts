import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normaliseSetSpec, type SetObject, type SetSpec } from "./set-spec";
import { setElements } from "./elements";
import {
  STUDIO_PARTS_MAX,
  STUDIO_PART_REST,
  copyBox,
  partGoneInSaved,
  placeOnSpot,
  specPartBlocks,
  studioRoadLayout,
  studioSetParts,
  surfacesOf,
  type PlaceBox,
  type StudioPart,
} from "./studio-parts";
import { knownOf, normaliseStudioSummary, validateStudioPlan, type StudioStep } from "./studio-astra";
import race from "./fixtures-race-track.json";
import beach from "./fixtures-beach.json";
import market from "./fixtures-rainy-market.json";

// The set's own parts in Helios Studio (2026-09-30 — operator: "remove the garage and put the car on the road.").
// Live, Astra answered that the garage "isn't a separate object" and that the scene "doesn't identify the asphalt
// road's position, height, or direction": the Studio drew everything that isn't a thing as one "The place".

const specOf = (raw: unknown): SetSpec => {
  const n = normaliseSetSpec(raw);
  if (!n.ok) throw new Error("fixture");
  return n.spec;
};
const thingBlocks = (spec: SetSpec) => {
  const s = new Set<string>();
  setElements(spec).forEach((e) => e.members.forEach(([o, c]) => s.add(o + ":" + c)));
  return s;
};
const RACE = specOf(race);
const RACE_PARTS = studioSetParts(RACE, thingBlocks(RACE));
const byName = (parts: StudioPart[], name: string) => parts.find((p) => p.name === name)!;

describe("the set split into the parts a person names", () => {
  it("the race track: Track, its markings, kerbs, a barrier, the pit garage, the grandstand, buildings and a wall", () => {
    expect(RACE_PARTS.map((p) => [p.name, p.kind])).toEqual([
      ["Track", "road"],
      ["Track markings", "marking"],
      ["Barrier", "barrier"],
      ["Kerbs", "kerb"],
      ["Pit garage", "building"],
      ["Grandstand", "stand"],
      ["Building", "building"],
      ["Building 2", "building"],
      ["Wall", "wall"],
    ]);
    // A multi-block building is ONE part: the pit garage's block, its doors, its windows and its roof.
    expect([...new Set(byName(RACE_PARTS, "Pit garage").members.map(([o]) => o))]).toEqual([7, 8, 9, 10]);
    // The grandstand keeps its base, steps, both rows of seats and its columns.
    expect([...new Set(byName(RACE_PARTS, "Grandstand").members.map(([o]) => o))]).toEqual([11, 12, 13, 14, 15]);
    // A repeat stays one object, with its count: 20 red kerbs and 19 white ones are one "Kerbs".
    expect(byName(RACE_PARTS, "Kerbs").repeat).toBe(20);
    expect(byName(RACE_PARTS, "Kerbs").members).toHaveLength(39);
  });

  it("every block of the set that isn't a thing is in exactly one part, and none of a thing's is", () => {
    for (const spec of [RACE, specOf(beach), specOf(market)]) {
      const inThing = thingBlocks(spec);
      const parts = studioSetParts(spec, inThing);
      const seen = new Map<string, number>();
      for (const p of parts) for (const [o, c] of p.members) seen.set(o + ":" + c, (seen.get(o + ":" + c) ?? 0) + 1);
      spec.objects.forEach((o, oi) => {
        for (let c = 0; c < (o.repeat?.count ?? 1); c++) expect(seen.get(oi + ":" + c) ?? 0).toBe(inThing.has(oi + ":" + c) ? 0 : 1);
      });
      expect(new Set(parts.map((p) => p.key)).size).toBe(parts.length);
    }
  });

  it("uses the set's own names when it has them, and reads what they are from the words", () => {
    const named = { ...RACE, objects: RACE.objects.map((o, i) => (i === 0 ? { ...o, name: "main straight" } : i === 7 || i === 8 ? { ...o, name: "pit garages" } : o)) };
    const parts = studioSetParts(named, thingBlocks(named));
    expect(parts.find((p) => p.name === "Main straight")?.kind).toBe("road");
    const garage = parts.find((p) => p.name === "Pit garages")!;
    expect(garage.kind).toBe("building");
    expect(garage.members.map(([o]) => o)).toEqual(expect.arrayContaining([7, 8, 9, 10]));
  });

  it("never makes hundreds: past STUDIO_PARTS_MAX the smallest go into The place (rest), and specks always do", () => {
    const block = (x: number, z: number, s: number): SetObject => ({ shape: "box", position: [x, s / 2, z], rotation: [0, 0, 0], size: [s, s, s], color: "#888888", roughness: 0.7, metalness: 0, emissive: null, emissiveIntensity: 0, castShadow: true, repeat: null, material: null });
    const objects = Array.from({ length: 80 }, (_, i) => block((i % 10) * 12, Math.floor(i / 10) * 12, i < 5 ? 0.1 : 1 + (i % 7)));
    const spec = { ...RACE, title: "Yard", description: "Crates in a yard.", objects };
    const parts = studioSetParts(spec, new Set());
    expect(parts.length).toBe(STUDIO_PARTS_MAX);
    const rest = parts[parts.length - 1];
    expect(rest).toMatchObject({ name: STUDIO_PART_REST, rest: true });
    expect(parts.reduce((n, p) => n + p.members.length, 0)).toBe(80);
    for (let i = 0; i < 5; i++) expect(rest.members).toContainEqual([i, 0]);
  });

  it("a scene saved with parts keeps its deletions and takes new parts; one from before parts follows its place", () => {
    const keys = new Set(["part:track", "car"]);
    expect(partGoneInSaved("part:track", { keys, partKeys: ["part:track", "part:pit garage"], hadPlace: false })).toBe(false);
    expect(partGoneInSaved("part:pit garage", { keys, partKeys: ["part:track", "part:pit garage"], hadPlace: false })).toBe(true);
    expect(partGoneInSaved("part:new stand", { keys, partKeys: ["part:track", "part:pit garage"], hadPlace: false })).toBe(false);
    expect(partGoneInSaved("part:pit garage", { keys, partKeys: null, hadPlace: true })).toBe(false);
    expect(partGoneInSaved("part:pit garage", { keys, partKeys: null, hadPlace: false })).toBe(true);
  });
});

describe("a road as Astra reads it", () => {
  it("the track runs away from the camera (Blender +Y), 25 m wide and 120 m long", () => {
    expect(studioRoadLayout(specPartBlocks(RACE, byName(RACE_PARTS, "Track")))).toEqual({ along: [0, 1], width: 25, length: 120 });
  });

  it("a road in pieces gives each piece's centre line, turned ones included", () => {
    const blocks = [
      { c: [0, 0.01, 0] as [number, number, number], lenX: 8, lenZ: 40, ax: [1, 0] as [number, number], top: 0.02 },
      { c: [20, 0.01, -20] as [number, number, number], lenX: 40, lenZ: 8, ax: [1, 0] as [number, number], top: 0.02 },
    ];
    const r = studioRoadLayout(blocks)!;
    expect(r.width).toBe(8);
    expect(r.segs).toEqual([
      [0, -20, 0, 20, 8],
      [0, 20, 40, 20, 8],
    ]);
  });

  it("the summary keeps what a part is, its top and a road's direction, and drops what isn't one", () => {
    const s = normaliseStudioSummary({
      objects: [
        { id: "o1", name: "Track", kind: "mesh", at: [0, 0, 0], size: [25, 120, 0], set: "road", top: 0.017, along: [0, 3], width: 25, segs: [[0, -60, 0, 60, 25]] },
        { id: "o2", name: "Pit garage", kind: "mesh", at: [29, 0, 0], size: [31, 120, 8], set: "building", top: 8.2, along: [0, 0] },
        { id: "o3", name: "Car 1", kind: "mesh", at: [0, 0, 0], size: [2, 4.6, 1.5], set: "spaceship", top: 1 },
      ],
    });
    expect(s.objects[0]).toMatchObject({ set: "road", top: 0, along: [0, 1], width: 25 });
    expect(s.objects[0].segs).toBeUndefined();
    expect(s.objects[1]).toMatchObject({ set: "building", top: 8.2 });
    expect(s.objects[1].along).toBeUndefined();
    expect(s.objects[2].set).toBeUndefined();
    expect(s.objects[2].top).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// "remove the garage and put the car on the road", with a stand-in for the model
// ---------------------------------------------------------------------------

/** The scene summary the Studio sends for the race track as it opens: its parts, Car 1, the stand-in and the camera. */
function raceSummary() {
  const els = setElements(RACE);
  const car = els.find((e) => e.kind === "car")!;
  const objects: Record<string, unknown>[] = RACE_PARTS.map((p, i) => {
    const blocks = specPartBlocks(RACE, p);
    return {
      id: `o${i + 1}`,
      name: p.name,
      kind: "mesh",
      at: [(p.min[0] + p.max[0]) / 2, -(p.min[2] + p.max[2]) / 2, p.min[1]],
      size: [p.max[0] - p.min[0], p.max[2] - p.min[2], p.max[1] - p.min[1]],
      turn: 0,
      set: p.kind,
      top: Math.max(...blocks.map((b) => b.top)),
      ...(p.kind === "road" ? studioRoadLayout(blocks) : {}),
    };
  });
  objects.push({ id: "o20", name: "Car 1", kind: "mesh", at: [car.centre[0], -car.centre[2], 0], size: [car.max[0] - car.min[0], car.max[2] - car.min[2], car.max[1] - car.min[1]], turn: 0, keys: 1 });
  objects.push({ id: "o21", name: "Stand-in", kind: "mesh", at: [0, 0, 0], size: [0.5, 0.3, 1.75], turn: 0, pose: "standing" });
  objects.push({ id: "o22", name: "Shot camera", kind: "camera", at: [9, -13, 4.2], size: [0, 0, 0], turn: 35 });
  return { summary: normaliseStudioSummary({ frame: 1, camera: "o22", objects }), car };
}

/** What a model does with it: the garage by its name and kind, the road by its kind, the car by its name. */
function fakeModel(summary: ReturnType<typeof normaliseStudioSummary>) {
  const garage = summary.objects.find((o) => o.set === "building" && /garage/i.test(o.name))!;
  const road = summary.objects.find((o) => o.set === "road")!;
  const car = summary.objects.find((o) => !o.set && /car/i.test(o.name))!;
  const step = (o: Record<string, unknown>) => ({ say: "", op: "", targets: [], kind: "", name: "", mode: "", x: null, y: null, z: null, of: "", side: "", value: null, value2: null, color: "", metallic: null, roughness: null, emission: "", points: [], near: "", ...o });
  return {
    reply: `I'll delete the ${garage.name} and park ${car.name} on the ${road.name}, lined up with it.`,
    question: "",
    options: [],
    steps: [step({ say: `Delete the ${garage.name}`, op: "delete", targets: [garage.id] }), step({ say: `Park ${car.name} on the ${road.name}`, op: "place_on", targets: [car.id], of: road.id, kind: "along" })],
  };
}

describe('"remove the garage and put the car on the road" on the race track', () => {
  const { summary, car } = raceSummary();
  const plan = validateStudioPlan(JSON.parse(JSON.stringify(fakeModel(summary))), knownOf(summary));

  it("the summary says which part is the garage and which is the road, with the road's top, direction and width", () => {
    expect(summary.objects.find((o) => o.name === "Pit garage")).toMatchObject({ set: "building" });
    expect(summary.objects.find((o) => o.name === "Track")).toMatchObject({ set: "road", top: 0, along: [0, 1], width: 25 });
    expect(summary.omitted).toBe(0);
  });

  it("plans a delete of the garage part and Car 1 placed on the track, along it", () => {
    const garageId = summary.objects.find((o) => o.name === "Pit garage")!.id;
    const trackId = summary.objects.find((o) => o.name === "Track")!.id;
    expect(plan.steps.map((s) => s.op)).toEqual(["delete", "place_on"]);
    expect(plan.steps[0]).toMatchObject({ op: "delete", targets: [garageId] });
    expect(plan.steps[1]).toMatchObject({ op: "place_on", targets: ["o20"], of: trackId, align: "along", near: null, nearAt: null });
  });

  it("the spot the Studio works out is on the track's top, inside its edges, along it, and clear of the walls", () => {
    const step = plan.steps[1] as Extract<StudioStep, { op: "place_on" }>;
    const track = RACE_PARTS[+step.of.slice(1) - 1];
    expect(track.name).toBe("Track");
    const gone = new Set(["Pit garage", "Track"]);
    const obstacles: PlaceBox[] = RACE_PARTS.filter((p) => !gone.has(p.name)).flatMap((p) => p.members.map(([o, c]) => copyBox(RACE.objects[o], c)));
    obstacles.push({ min: [-0.3, 0, -0.2], max: [0.3, 1.75, 0.2] }); // the stand-in on the starting grid
    const foot = { len: car.max[2] - car.min[2], wid: car.max[0] - car.min[0], h: car.max[1] - car.min[1], dir: [0, 1] as [number, number] };
    const spot = placeOnSpot({ surfaces: surfacesOf(specPartBlocks(RACE, track)), foot, align: "along", near: [car.centre[0], car.centre[2]], obstacles })!;
    expect(spot).not.toBeNull();
    expect(spot.at[1]).toBeCloseTo(0.017, 3);
    expect(Math.abs(spot.dir[1])).toBe(1); // down the track (three's z, Blender's Y)
    expect(spot.box.min[0]).toBeGreaterThanOrEqual(-12.5);
    expect(spot.box.max[0]).toBeLessThanOrEqual(12.5);
    const hit = obstacles.filter((o) => o.max[1] > spot.box.min[1] + 0.05 && o.min[1] < spot.box.max[1] && o.max[0] > spot.box.min[0] + 0.02 && o.min[0] < spot.box.max[0] - 0.02 && o.max[2] > spot.box.min[2] + 0.02 && o.min[2] < spot.box.max[2] - 0.02);
    expect(hit).toEqual([]);
    // The set's wall at x −4…0 stood where the car was; the car is now just beside it, on the open side.
    expect(spot.box.min[0]).toBeGreaterThanOrEqual(0);
    expect(Math.hypot(spot.at[0] - car.centre[0], spot.at[2] - car.centre[2])).toBeLessThan(4);
  });

  it("no room: a surface smaller than the thing gives no spot, and a turn across is honoured", () => {
    const small = [{ c: [0, 0] as [number, number], u: [0, 1] as [number, number], len: 3, wid: 1.5, top: 1 }];
    expect(placeOnSpot({ surfaces: small, foot: { len: 4.6, wid: 2, h: 1.4, dir: [0, 1] }, align: "along", near: [0, 0], obstacles: [] })).toBeNull();
    const wide = [{ c: [0, 0] as [number, number], u: [0, 1] as [number, number], len: 30, wid: 10, top: 0 }];
    expect(placeOnSpot({ surfaces: wide, foot: { len: 4.6, wid: 2, h: 1.4, dir: [0, 1] }, align: "across", near: [0, 0], obstacles: [] })!.dir.map(Math.abs)).toEqual([1, 0]);
  });
});

describe("place_on as Astra may send it", () => {
  const known = { ids: new Map([["o1", "Track"], ["o2", "Car 1"], ["o3", "Shot camera"], ["o4", "Stand-in"]]), camera: "o3" };
  const step = (o: Record<string, unknown>) => validateStudioPlan({ reply: "", question: "", options: [], steps: [{ say: "Park it", op: "place_on", targets: ["o2"], of: "o1", kind: "along", near: "", x: null, y: null, ...o }] }, known).steps[0];
  it("checks what it goes on, what it is near and how it is turned", () => {
    expect(step({})).toMatchObject({ op: "place_on", targets: ["o2"], of: "o1", align: "along", near: null, nearAt: null });
    expect(step({ near: "o4" })).toMatchObject({ near: "o4" });
    expect(step({ near: "camera", kind: "" })).toMatchObject({ near: "o3", align: null });
    expect(step({ near: "o99", x: 3, y: -2 })).toMatchObject({ near: null, nearAt: { x: 3, y: -2, z: null } });
    expect(step({ of: "" }).op).toBe("note");
    expect(step({ of: "o77" })).toMatchObject({ op: "note" });
    expect(step({ of: "camera" })).toMatchObject({ op: "note" });
  });
});

describe("the engine builds the parts and keeps them (source)", () => {
  const engine = readFileSync(join(__dirname, "../../components/studio/studio-engine.ts"), "utf8");
  it("makes one object per part under Set, never one \"The place\", and saves which parts it knew", () => {
    expect(engine).toContain("const SET_PARTS = studioSetParts(SPEC, inThing);");
    expect(engine).toContain('const it = addItem(g, p.name, "mesh", "Set"); it.saveKey = p.key;');
    expect(engine).not.toContain('addItem(placeGroup, "The place"');
    expect(engine).toContain("partKeys: SET_PARTS.map((p) => p.key)");
    expect(engine).toContain("if (oldPlace) migratePlace(oldPlace);");
  });
  it("the walls, the wall warning and the words read every part", () => {
    expect(engine).toContain("for (const p of setParts()) {");
    expect(engine).toContain("const partObjs = new Set(setParts().map((p) => p.obj));");
    expect(engine).not.toMatch(/[^.\w]place\.(obj|hidden|saveKey)/);
  });
});
