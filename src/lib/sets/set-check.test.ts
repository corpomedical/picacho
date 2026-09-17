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

  it("never reads a sheet as a finding, on either side", () => {
    const base = load(showroom);
    const sheet: SetObject = { ...base.objects[0], shape: "plane", position: [0, 0.01, 0], size: [200, 0.01, 200], rotation: [0, 0, 0], repeat: null };
    const spec: SetSpec = { ...base, objects: [sheet, { ...sheet, shape: "box", position: [0, 0.5, 0], size: [1, 1, 1] }] };
    expect(checkSet(spec)).toEqual([]);
  });
});
