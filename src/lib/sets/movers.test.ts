import { describe, expect, it } from "vitest";
import raceTrack from "./fixtures-race-track.json";
import { normaliseSetSpec, type SetObject, type SetSpec } from "./set-spec";
import { setElements } from "./elements";
import { MOVERS_PER_BEAT, canMove, moverAlong, moverStages, movedSpec, normaliseMovers, placementBefore, sameMovers, turnAbout } from "./movers";

// The movers (2026-09-23): a thing that MOVES during a beat. The set is the
// arrangement and is never edited — a mover says where the thing has got to
// when the beat ends, and the frame that beat is shot on is drawn from a set
// with it moved, so everything downstream (the sketch, which things are in
// frame, the sentence naming each one) is true of that moment.

const load = (raw: unknown): SetSpec => {
  const n = normaliseSetSpec(raw);
  if (!n.ok) throw new Error("fixture");
  return n.spec;
};
const race = load(raceTrack);
const car = setElements(race)[0];

const block = (over: Partial<SetObject>): SetObject => ({
  shape: "box",
  position: [0, 0.5, 0],
  rotation: [0, 0, 0],
  size: [1, 1, 1],
  color: "#888888",
  roughness: 0.6,
  metalness: 0,
  emissive: null,
  emissiveIntensity: 0,
  castShadow: true,
  repeat: null,
  material: null,
  ...over,
});

describe("a stored mover", () => {
  it("keeps a thing's key, where it ends and how far it turned, and drops anything it cannot use", () => {
    const got = normaliseMovers([
      { key: car.key, x: 3, z: -4.5, turnDeg: 400, path: [{ x: 1, z: 1 }] },
      { key: "not a key", x: 1, z: 1 },
      { key: "c_89e319be_0_-1", x: "far", z: 1 },
      { key: "o_11111111_0_0", x: 1 },
    ]);
    expect(got).toEqual([{ key: car.key, x: 3, z: -4.5, turnDeg: 40, path: [{ x: 1, z: 1 }] }]);
    expect(normaliseMovers("no")).toEqual([]);
    // A thing moves once in a beat: the first word wins.
    expect(normaliseMovers([{ key: car.key, x: 1, z: 1 }, { key: car.key, x: 9, z: 9 }])).toEqual([
      { key: car.key, x: 1, z: 1, turnDeg: 0, path: [] },
    ]);
    // No more than the ceiling, and nothing silently past it.
    const many = Array.from({ length: 6 }, (_, i) => ({ key: `o_1111111${i}_0_0`, x: i, z: 0 }));
    expect(normaliseMovers(many)).toHaveLength(MOVERS_PER_BEAT);
  });

  it("is the same mover only when it ends in the same place, turned the same, by the same way", () => {
    const one = normaliseMovers([{ key: car.key, x: 1, z: 2, turnDeg: 10, path: [{ x: 5, z: 5 }] }]);
    expect(sameMovers(one, normaliseMovers([{ key: car.key, x: 1, z: 2, turnDeg: 10, path: [{ x: 5, z: 5 }] }]))).toBe(true);
    expect(sameMovers(one, normaliseMovers([{ key: car.key, x: 1, z: 2.5, turnDeg: 10, path: [{ x: 5, z: 5 }] }]))).toBe(false);
    expect(sameMovers(one, normaliseMovers([{ key: car.key, x: 1, z: 2, turnDeg: 20, path: [{ x: 5, z: 5 }] }]))).toBe(false);
    expect(sameMovers(one, normaliseMovers([{ key: car.key, x: 1, z: 2, turnDeg: 10, path: [{ x: 6, z: 5 }] }]))).toBe(false);
    expect(sameMovers(one, normaliseMovers([{ key: car.key, x: 1, z: 2, turnDeg: 10 }]))).toBe(false);
    expect(sameMovers([], [])).toBe(true);
  });
});

describe("where a thing stands through a film", () => {
  const van = { key: car.key, x: 8, z: 0, turnDeg: 90, path: [] };
  const stages = moverStages([{ movers: [van] }, { movers: [] }, { movers: [{ ...van, x: 20, turnDeg: 0 }] }]);

  it("stays where the beat that moved it left it, until a beat moves it again", () => {
    expect(stages[0]).toEqual([{ key: car.key, x: 8, z: 0, turnDeg: 90 }]);
    expect(stages[1]).toEqual([{ key: car.key, x: 8, z: 0, turnDeg: 90 }]);
    expect(stages[2]).toEqual([{ key: car.key, x: 20, z: 0, turnDeg: 0 }]);
  });

  it("opens each beat where the beat before it closed, and the first where the set was built", () => {
    const home = { x: car.centre[0], z: car.centre[2] };
    expect(placementBefore(stages, 0, car.key, home)).toEqual({ key: car.key, x: home.x, z: home.z, turnDeg: 0 });
    expect(placementBefore(stages, 1, car.key, home)).toEqual({ key: car.key, x: 8, z: 0, turnDeg: 90 });
    // Beat 3 opens where beat 1 drove it: beat 2 left it alone.
    expect(placementBefore(stages, 2, car.key, home)).toEqual({ key: car.key, x: 8, z: 0, turnDeg: 90 });
    expect(placementBefore(stages, 0, "o_00000000_0_0", { x: 2, z: 3 })).toEqual({ key: "o_00000000_0_0", x: 2, z: 3, turnDeg: 0 });
  });
});

describe("a thing on its way", () => {
  const home = { key: car.key, x: 0, z: 0, turnDeg: 0 };

  it("travels its path and turns as it goes, landing exactly where the beat's end frame is shot", () => {
    const mover = { key: car.key, x: 10, z: 0, turnDeg: 90, path: [] };
    expect(moverAlong(home, mover, 0)).toEqual({ key: car.key, x: 0, z: 0, turnDeg: 0 });
    expect(moverAlong(home, mover, 0.5)).toEqual({ key: car.key, x: 5, z: 0, turnDeg: 45 });
    expect(moverAlong(home, mover, 1)).toEqual({ key: car.key, x: 10, z: 0, turnDeg: 90 });
    // A share past either end is that end: a dropped frame never overshoots.
    expect(moverAlong(home, mover, 2)).toEqual(moverAlong(home, mover, 1));
    expect(moverAlong(home, mover, -1)).toEqual(moverAlong(home, mover, 0));
  });

  it("goes round by the points it was given, by distance", () => {
    const mover = { key: car.key, x: 4, z: 8, turnDeg: 0, path: [{ x: 0, z: 4 }, { x: 4, z: 4 }] };
    // Three legs of four metres: halfway is six metres along, the middle of
    // the second — not the straight line from where it started.
    expect(moverAlong(home, mover, 0.5)).toMatchObject({ x: 2, z: 4 });
    expect(moverAlong(home, mover, 0.25)).toMatchObject({ x: 0, z: 3 });
    expect(moverAlong(home, mover, 1)).toMatchObject({ x: 4, z: 8 });
  });

  it("turns the short way round", () => {
    const mover = { key: car.key, x: 0, z: 0, turnDeg: 10, path: [] };
    expect(moverAlong({ ...home, turnDeg: 350 }, mover, 0.5).turnDeg).toBe(0);
    expect(moverAlong({ ...home, turnDeg: 350 }, mover, 1).turnDeg).toBe(10);
  });
});

describe("a thing that may move", () => {
  it("is one that owns every copy of every block it is made of", () => {
    expect(canMove(car, race)).toBe(true);
    // A block written once and drawn twice, ten metres apart: two things,
    // and the set cannot say where one of them stands on its own.
    const row = load({ ...raceTrack, objects: [block({ repeat: { count: 2, offset: [10, 0, 0] } })] });
    const both = setElements(row);
    expect(both).toHaveLength(2);
    for (const e of both) expect(canMove(e, row)).toBe(false);
    // The same block drawn twice close enough to be ONE thing may move: both
    // copies are its own.
    const pair = load({ ...raceTrack, objects: [block({ repeat: { count: 2, offset: [0.4, 0, 0] } })] });
    const one = setElements(pair);
    expect(one).toHaveLength(1);
    expect(canMove(one[0], pair)).toBe(true);
  });
});

describe("the set with its movers moved", () => {
  it("drives the thing's blocks there and leaves everything else where it was", () => {
    const to = { key: car.key, x: car.centre[0] + 6, z: car.centre[2] - 2, turnDeg: 0 };
    const moved = movedSpec(race, [car], [to]);
    expect(moved).not.toBe(race);
    expect(race.objects[0].position).toEqual(load(raceTrack).objects[0].position);
    const mine = new Set(car.members.map(([oi]) => oi));
    for (const [i, o] of moved.objects.entries()) {
      if (!mine.has(i)) {
        expect(o, `object ${i}`).toBe(race.objects[i]);
        continue;
      }
      expect(o.position[0]).toBeCloseTo(race.objects[i].position[0] + 6, 3);
      expect(o.position[2]).toBeCloseTo(race.objects[i].position[2] - 2, 3);
      expect(o.position[1]).toBe(race.objects[i].position[1]);
    }
    // And the thing is where it was driven: its middle is the mover's.
    const after = setElements(moved)[0];
    expect(after.centre[0]).toBeCloseTo(to.x, 2);
    expect(after.centre[2]).toBeCloseTo(to.z, 2);
  });

  it("turns it about its own middle, taking its rows of copies round with it", () => {
    const quarter = movedSpec(race, [car], [{ key: car.key, x: car.centre[0], z: car.centre[2], turnDeg: 90 }]);
    const after = setElements(quarter)[0];
    // A car is longer than it is wide: a quarter turn swaps the two.
    const span = (e: typeof car, i: 0 | 2) => e.max[i] - e.min[i];
    expect(span(after, 0)).toBeCloseTo(span(car, 2), 1);
    expect(span(after, 2)).toBeCloseTo(span(car, 0), 1);
    expect(after.centre[0]).toBeCloseTo(car.centre[0], 2);
    expect(after.centre[2]).toBeCloseTo(car.centre[2], 2);
    // Every block of it turned with the thing, not on the spot.
    const oi = car.members[0][0];
    expect(quarter.objects[oi].rotation[1]).toBeCloseTo(race.objects[oi].rotation[1] + 90, 3);
    const rowed = car.members.map(([o]) => o).find((o) => race.objects[o].repeat);
    if (rowed !== undefined) {
      const was = race.objects[rowed].repeat!.offset;
      const now = quarter.objects[rowed].repeat!.offset;
      expect([now[0], now[2]]).toEqual([turnAbout({ x: was[0], z: was[2] }, { x: 0, z: 0 }, 90).x, turnAbout({ x: was[0], z: was[2] }, { x: 0, z: 0 }, 90).z]);
    }
  });

  it("leaves the set alone when nothing moves, or when what moved cannot", () => {
    expect(movedSpec(race, [car], [])).toBe(race);
    expect(movedSpec(race, [car], [{ key: "o_00000000_0_0", x: 1, z: 1, turnDeg: 0 }])).toBe(race);
    const row = load({ ...raceTrack, objects: [block({ repeat: { count: 2, offset: [10, 0, 0] } })] });
    const [first] = setElements(row);
    expect(movedSpec(row, setElements(row), [{ key: first.key, x: 5, z: 5, turnDeg: 0 }])).toBe(row);
  });
});

describe("turnAbout", () => {
  it("turns a point round another on the ground, and leaves it alone at zero", () => {
    expect(turnAbout({ x: 1, z: 0 }, { x: 0, z: 0 }, 90)).toEqual({ x: 0, z: -1 });
    expect(turnAbout({ x: 1, z: 0 }, { x: 0, z: 0 }, 180)).toEqual({ x: -1, z: 0 });
    expect(turnAbout({ x: 2, z: 3 }, { x: 2, z: 3 }, 45)).toEqual({ x: 2, z: 3 });
    expect(turnAbout({ x: 4, z: 5 }, { x: 0, z: 0 }, 0)).toEqual({ x: 4, z: 5 });
    // A turn keeps the distance it had.
    const p = turnAbout({ x: 3, z: 4 }, { x: 1, z: 1 }, 37);
    expect(Math.hypot(p.x - 1, p.z - 1)).toBeCloseTo(Math.hypot(2, 3), 3);
  });
});
