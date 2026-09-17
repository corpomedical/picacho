import { describe, expect, it } from "vitest";
import { normaliseSetSpec, type SetObject, type SetSpec } from "./set-spec";
import { checkSet } from "./set-check";
import raceTrack from "./fixtures-race-track.json";
import showroom from "./fixtures-showroom-open.json";
import beach from "./fixtures-beach.json";
import market from "./fixtures-rainy-market.json";

// The set check (cut 5): the wall through the car on the operator's own
// race track, and nothing on the other three.

const load = (raw: unknown): SetSpec => {
  const r = normaliseSetSpec(raw);
  if (!r.ok) throw new Error("fixture");
  return r.spec;
};
const track = load(raceTrack);

describe("checkSet", () => {
  it("finds the end wall standing through the car on the race track, and names both", () => {
    const found = checkSet(track);
    const through = found.filter((f) => f.kind === "through");
    expect(through.length).toBeGreaterThan(0);
    const wall = track.objects.findIndex((o) => o.size[0] === 4 && o.size[1] === 20 && o.size[2] === 136);
    const body = track.objects.findIndex((o) => o.color === "#c91420");
    expect(through.some((f) => f.kind === "through" && f.big === wall && f.small === body)).toBe(true);
    for (const f of through) expect(f.kind === "through" && f.share).toBeGreaterThanOrEqual(0.45);
  });

  it("finds the second stray wall too — a terminal facade repeated into the middle of the circuit — and is clean once both stand at the far sides", () => {
    const facade = track.objects.findIndex((o) => o.size[0] === 104 && o.repeat);
    expect(checkSet(track).some((f) => f.kind === "through" && f.big === facade)).toBe(true);
    const fixed: SetSpec = {
      ...track,
      objects: track.objects.map((o) =>
        o.size[0] === 4 && o.size[1] === 20 && o.size[2] === 136 && o.repeat
          ? { ...o, repeat: { count: 2, offset: [104, 0, 0] } }
          : o.size[0] === 104 && o.repeat
            ? { ...o, repeat: { count: 2, offset: [0, 0, 128] } }
            : o,
      ),
    };
    expect(checkSet(fixed).filter((f) => f.kind === "through")).toEqual([]);
  });

  it("leaves wheels in a body, seats on a tier and panes in a frame alone", () => {
    for (const raw of [showroom, beach, market]) expect(checkSet(load(raw)).filter((f) => f.kind === "through")).toEqual([]);
  });

  it("finds a camera or a mark inside a thing, and a thing sunk into the ground", () => {
    const base = load(showroom);
    const box: SetObject = { ...base.objects[0], shape: "box", position: [0, 1, 0], size: [2, 2, 2], rotation: [0, 0, 0], repeat: null };
    const spec: SetSpec = {
      ...base,
      objects: [box, { ...box, position: [10, -1, 10], size: [1, 1, 1] }],
      cameras: [{ ...base.cameras[0], position: [0, 1, 0] }],
      marks: [{ ...base.marks[0], x: 0.2, z: 0.2 }],
    };
    const found = checkSet(spec);
    expect(found).toContainEqual({ kind: "camera-inside", camera: 0, object: 0 });
    expect(found).toContainEqual({ kind: "mark-inside", mark: 0, object: 0 });
    expect(found).toContainEqual({ kind: "sunk", object: 1, depthM: 1.5 });
  });

  it("leaves two turned boxes alone when they do not touch", () => {
    // A 12 m wall turned 45° has a world box 8.8 m across, so a crate 4.2 m
    // clear of its face stood "through" it with a share of 1.00, where the
    // truth is nothing at all (found reviewing Helios, fixed 2026-09-18).
    const base = load(showroom);
    const one: SetObject = { ...base.objects[0], shape: "box", rotation: [0, 0, 0], repeat: null };
    const spec = (objects: SetObject[]): SetSpec => ({ ...base, objects, cameras: [], marks: [] });
    const wall = { ...one, size: [12, 3, 0.4] as [number, number, number], position: [0, 1.5, 0] as [number, number, number], rotation: [0, 45, 0] as [number, number, number] };
    const crate = { ...one, size: [1, 1, 1] as [number, number, number], position: [3, 0.5, 3] as [number, number, number] };
    expect(checkSet(spec([wall, crate]))).toEqual([]);
    // A grazing corner is still nothing: the truth is under two per cent.
    expect(checkSet(spec([{ ...wall, rotation: [0, 30, 0] }, { ...crate, rotation: [0, 45, 0] }]))).toEqual([]);
    // And a wall thick enough to bury the crate still says so.
    const thick = { ...wall, size: [12, 4, 3] as [number, number, number], position: [0, 2, 0] as [number, number, number] };
    expect(checkSet(spec([thick, { ...crate, position: [0, 2, 0] as [number, number, number], rotation: [0, 45, 0] as [number, number, number] }]))).toContainEqual({
      kind: "through",
      big: 0,
      small: 1,
      share: 1,
    });
  });

  it("does not call a ball resting on the ground sunk, whatever it is turned by", () => {
    const base = load(showroom);
    const one: SetObject = { ...base.objects[0], shape: "sphere", size: [2, 2, 2], position: [0, 1, 0], rotation: [0, 0, 0], repeat: null };
    const spec = (objects: SetObject[]): SetSpec => ({ ...base, objects, cameras: [], marks: [] });
    for (const rotation of [[0, 0, 0], [0, 45, 0], [0, 0, 45], [45, 0, 0], [12, 30, 7]] as [number, number, number][]) {
      expect(checkSet(spec([{ ...one, rotation }])), String(rotation)).toEqual([]);
    }
    // A box on its corner really is through the floor, and still says so.
    expect(checkSet(spec([{ ...one, shape: "box", rotation: [0, 0, 45] }]))).toContainEqual({ kind: "sunk", object: 0, depthM: 0.4 });
    // A box half under the ground too.
    expect(checkSet(spec([{ ...one, shape: "box", position: [0, 0, 0] }]))).toContainEqual({ kind: "sunk", object: 0, depthM: 1 });
    // A ball buried whole is a mistake, and is still found.
    expect(checkSet(spec([{ ...one, position: [0, -2.4, 0] }]))).toContainEqual({ kind: "sunk", object: 0, depthM: 3.4 });
  });

  it("reads a dune as the shape it is, as the marks do", () => {
    // The beach's dunes are half-buried balls, which is how a dune is built:
    // three "sunk" findings and two marks "inside" one, while marks.ts —
    // the rule the normaliser itself applies — says every mark is clear.
    expect(checkSet(load(beach))).toEqual([]);
  });

  it("never reads a sheet as a finding, on either side", () => {
    const base = load(showroom);
    const sheet: SetObject = { ...base.objects[0], shape: "plane", position: [0, 0.01, 0], size: [200, 0.01, 200], rotation: [0, 0, 0], repeat: null };
    const spec: SetSpec = { ...base, objects: [sheet, { ...sheet, shape: "box", position: [0, 0.5, 0], size: [1, 1, 1] }] };
    expect(checkSet(spec)).toEqual([]);
  });
});
