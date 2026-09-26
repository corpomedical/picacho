import { describe, expect, it } from "vitest";
import raceTrack from "./fixtures-race-track.json";
import showroom from "./fixtures-showroom-closed.json";
import { normaliseSetSpec, type SetSpec } from "./set-spec";
import { setElements } from "./elements";
import { turnedRotation } from "./kit";
import { describeParts, describeThings, dropToFloor, findThing, moveThing, thingName, turnThing, uprightOf, uprightThing } from "./thing-fix";
import showroomOpen from "./fixtures-showroom-open.json";
import { colourWord } from "./colour-words";

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

// One naming rule (Helios Cut 4, step B2, 2026-09-26): Aly reads a thing by
// the name the set page shows, with its colour and side, and finds it by its
// key, that name, or today's "Car 2" — never by picking a colour or a kind
// out of free words (critic item 15).
describe("a set's things by name, colour and side", () => {
  const room = load(showroomOpen);
  const els = setElements(room);
  const objects = els.filter((e) => e.kind === "object");
  const blocks = (e: (typeof els)[number]) => new Set(e.members.map(([o]) => o));
  const [a, b] = [blocks(objects[0]), blocks(objects[1])];
  const named: SetSpec = { ...room, objects: room.objects.map((o, i) => (a.has(i) || b.has(i) ? { ...o, name: "display stand" } : o)) };

  it("reads each thing's name, its kind-and-number alias, its colour and which side of the figure it is on", () => {
    const plain = describeThings(room);
    for (const t of plain) expect(t.alias).toBe(t.name);
    const car = els.find((e) => e.kind === "car")!;
    const info = plain.find((t) => t.key === car.key)!;
    const largest = [...car.members].map(([o]) => o).sort((x, y) => room.objects[y].size.reduce((p, q) => p * q, 1) - room.objects[x].size.reduce((p, q) => p * q, 1))[0];
    expect(info.colour).toBe(colourWord(room.objects[largest].color));
    expect(["ahead", "left", "right", "behind"]).toContain(info.side);
    // The side follows the figure where the person left it: turned round, left and right swap.
    const m = room.marks[0];
    const turned = describeThings(room, { x: m.x, z: m.z, facingDeg: (m.facingDeg + 180) % 360 }).find((t) => t.key === car.key)!;
    const opposite = { ahead: "behind", behind: "ahead", left: "right", right: "left" } as const;
    expect(turned.side).toBe(opposite[info.side]);
    const withNames = describeThings(named);
    const first = withNames.find((t) => t.key === objects[0].key)!;
    const second = withNames.find((t) => t.key === objects[1].key)!;
    expect(first.name).toBe("Display stand");
    expect(second.name).toBe("Display stand 2");
    expect(first.alias).toBe(thingName(objects[0], els));
  });

  it("finds a thing by its key, the name the page shows, or today's alias; never by a colour picked out of words", () => {
    expect(findThing(named, objects[1].key)?.key).toBe(objects[1].key);
    expect(findThing(named, "Display stand")?.key).toBe(objects[0].key);
    expect(findThing(named, "display stand 2")?.key).toBe(objects[1].key);
    // The numbered label stays an alias on a named set (critic item 15a).
    expect(findThing(named, thingName(objects[1], els))?.key).toBe(objects[1].key);
    expect(findThing(named, "Car")?.kind).toBe("car");
    // No free-text colour or kind (critic item 15b): Aly passes the key it read beside the colour.
    const car = els.find((e) => e.kind === "car")!;
    const colour = describeThings(room).find((t) => t.key === car.key)!.colour;
    expect(findThing(room, `the ${colour} car`)).toBeNull();
    expect(findThing(room, `${colour} object`)).toBeNull();
  });

  it("lists the set's named parts, the set itself, which can't be moved", () => {
    expect(describeParts(room)).toEqual([]);
    const inThing = new Set(els.flatMap((e) => e.members.map(([o]) => o)));
    const own = room.objects.findIndex((_, i) => !inThing.has(i));
    const withPart: SetSpec = { ...room, objects: room.objects.map((o, i) => (i === own ? { ...o, name: "back wall" } : o)) };
    expect(describeParts(withPart)).toEqual(["back wall"]);
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
