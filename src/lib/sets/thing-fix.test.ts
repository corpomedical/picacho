import { describe, expect, it } from "vitest";
import raceTrack from "./fixtures-race-track.json";
import showroom from "./fixtures-showroom-closed.json";
import { normaliseSetSpec, type SetSpec } from "./set-spec";
import { setElements } from "./elements";
import { turnedRotation } from "./kit";
import { describeThings, dropToFloor, findThing, moveThing, thingName, turnThing, uprightOf, uprightThing } from "./thing-fix";

function load(raw: unknown): SetSpec {
  const n = normaliseSetSpec(raw);
  if (!n.ok) throw new Error("fixture didn't normalise");
  return n.spec;
}
const close = (a: number[], b: number[], tol = 0.02) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

describe("a set's things, as the Producer reads them", () => {
  it("names them as the set page does and knows a car stands on its wheels", () => {
    const spec = load(raceTrack);
    const things = describeThings(spec);
    const cars = things.filter((t) => t.kind === "car");
    expect(cars.length).toBeGreaterThan(0);
    for (const c of cars) expect(c.upright).toBe("upright");
    const els = setElements(spec);
    const car = els.find((e) => e.kind === "car")!;
    expect(thingName(car, els)).toMatch(/^Car( \d+)?$/);
    expect(findThing(spec, thingName(car, els))?.key).toBe(car.key);
    expect(findThing(spec, car.key)?.key).toBe(car.key);
  });
});

describe("standing a car back on its wheels", () => {
  for (const [label, raw] of [
    ["race track", raceTrack],
    ["showroom", showroom],
  ] as const) {
    it(`finds it upside down and turns it back, facing the same way, on the floor (${label})`, () => {
      const spec = load(raw);
      const car = setElements(spec).find((e) => e.kind === "car");
      expect(car).toBeDefined();
      if (!car) return;
      // Flip it the way the bad build did: roof on the floor.
      const flipped = turnThing(spec, car, "z", 180);
      expect(flipped.ok).toBe(true);
      if (!flipped.ok) return;
      const upside = setElements(flipped.spec).find((e) => e.fingerprint === car.fingerprint)!;
      expect(uprightOf(flipped.spec, upside)).toBe("upside_down");

      const fixed = uprightThing(flipped.spec, upside);
      expect(fixed.ok).toBe(true);
      if (!fixed.ok) return;
      const back = setElements(fixed.spec).find((e) => e.fingerprint === car.fingerprint)!;
      expect(uprightOf(fixed.spec, back)).toBe("upright");
      // On the floor, where it was, as long and as wide.
      expect(Math.abs(back.min[1])).toBeLessThan(0.01);
      expect(close(back.centre.filter((_, i) => i !== 1), car.centre.filter((_, i) => i !== 1))).toBe(true);
      expect(close([back.max[0] - back.min[0], back.max[2] - back.min[2]], [car.max[0] - car.min[0], car.max[2] - car.min[2]])).toBe(true);
      // The fix is a full stop: nothing else in the set moved.
      const others = new Set(car.members.map(([o]) => o));
      fixed.spec.objects.forEach((o, i) => {
        if (!others.has(i)) expect(o).toEqual(spec.objects[i]);
      });
      // And it says so.
      expect(fixed.done).toMatch(/onto its wheels/);
    });
  }

  it("leaves a car that already stands alone, and says so", () => {
    const spec = load(raceTrack);
    const car = setElements(spec).find((e) => e.kind === "car")!;
    const r = uprightThing(spec, car);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.done).toMatch(/already/);
  });
});

describe("turning, moving and setting down a thing", () => {
  it("turns every block about the thing's centre the way the kit turns a prop", () => {
    const spec = load(raceTrack);
    const car = setElements(spec).find((e) => e.kind === "car")!;
    const r = turnThing(spec, car, "y", 90);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const oi of new Set(car.members.map(([o]) => o))) {
      const want = turnedRotation(spec.objects[oi].rotation, 90);
      const got = r.spec.objects[oi].rotation;
      // Same orientation (euler angles can differ by representation; compare via a second turn back).
      const back = turnThing(r.spec, setElements(r.spec).find((e) => e.fingerprint === car.fingerprint)!, "y", -90);
      expect(back.ok).toBe(true);
      if (back.ok) expect(close(back.spec.objects[oi].rotation.map((v) => ((v % 360) + 360) % 360), spec.objects[oi].rotation.map((v) => ((v % 360) + 360) % 360), 0.05) || close(got, want, 0.05)).toBe(true);
    }
  });

  it("moves it, and sets a floating one down by its lowest corner", () => {
    const spec = load(raceTrack);
    const car = setElements(spec).find((e) => e.kind === "car")!;
    const up = moveThing(spec, car, [1, 0.5, -2]);
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    const lifted = setElements(up.spec).find((e) => e.fingerprint === car.fingerprint)!;
    expect(lifted.min[1]).toBeCloseTo(car.min[1] + 0.5, 2);
    const down = dropToFloor(up.spec, lifted);
    expect(down.ok).toBe(true);
    if (!down.ok) return;
    const landed = setElements(down.spec).find((e) => e.fingerprint === car.fingerprint)!;
    expect(Math.abs(landed.min[1])).toBeLessThan(0.01);
    expect(down.done).toMatch(/set down on the floor/);
  });
});
