import { describe, expect, it } from "vitest";
import race from "./fixtures-race-track.json";
import beach from "./fixtures-beach.json";
import market from "./fixtures-rainy-market.json";
import open from "./fixtures-showroom-open.json";
import closed from "./fixtures-showroom-closed.json";
import { parseAstraSetText } from "./answer-guard";
import { normaliseSetSpec, type SetObject } from "./set-spec";

// Stage 9 ("Protect cars too"): the race track's stray wall, held to its car
// with no mark under it. Its marks are moved off the wall first, so only the
// car can catch it.
const WALL = (o: SetObject) => o.shape === "box" && o.size[0] === 4 && o.size[1] === 20 && o.size[2] === 136;
const OPEN_FLOOR_MARKS = [{ id: "m1", label: "Grid", x: 8, z: 10, facingDeg: 0 }];
const raceNoMarks = () => ({ ...race, marks: OPEN_FLOOR_MARKS });

describe("a repeat whose last copy blocks one of the set's things", () => {
  it("is cut back when a new answer's stray copy stands through the car and no mark is under it", () => {
    const out = parseAstraSetText(JSON.stringify(raceNoMarks()));
    if (!out.ok) throw new Error("race");
    expect(out.spec.objects.find(WALL)!.repeat).toBeNull();
    expect(out.notes).toContain("repeat_on_cast_trimmed");
    expect(out.notes).not.toContain("repeat_on_mark_trimmed");
  });

  it("leaves every saved set as it reads back, and an edit that hands the same repeat back", () => {
    const saved = normaliseSetSpec(raceNoMarks());
    if (!saved.ok) throw new Error("race");
    expect(saved.spec.objects.find(WALL)!.repeat).toEqual({ count: 2, offset: [50, 0, 0] });
    const echo = parseAstraSetText(JSON.stringify(saved.spec), saved.spec);
    if (!echo.ok) throw new Error("echo");
    expect(echo.spec.objects.find(WALL)!.repeat).toEqual({ count: 2, offset: [50, 0, 0] });
    expect(echo.notes).not.toContain("repeat_on_cast_trimmed");
  });

  it("keeps the rows of every other set: fences, pillars, stands, seats and dunes", () => {
    for (const set of [beach, market, open, closed]) {
      const a = parseAstraSetText(JSON.stringify(set)), b = normaliseSetSpec(set);
      if (!a.ok || !b.ok) throw new Error("fixture");
      expect(a.notes).not.toContain("repeat_on_cast_trimmed");
      expect(a.spec.objects).toEqual(b.spec.objects);
    }
  });

  it("keeps a row whose middle copy meets the car, and a row whose first copy already does; cuts one whose last copy walks into it", () => {
    const pillar = (x: number, count: number): SetObject => ({ shape: "box", size: [0.4, 6, 0.4], position: [x, 3, -6], rotation: [0, 0, 0], color: "#777777", repeat: { count, offset: [0, 0, 3] } }) as unknown as SetObject;
    const withPillars = (p: SetObject) => ({ ...raceNoMarks(), objects: [...race.objects.filter((o) => !(o.size[0] === 4 && o.size[1] === 20)), p] });
    const find = (spec: { objects: SetObject[] }) => spec.objects.find((o) => o.size[1] === 6 && o.size[0] === 0.4)!;
    // copies at z −6, −3, 0 (the car spans z −2.3…2.3 at x 0): the last one walks into it.
    const last = parseAstraSetText(JSON.stringify(withPillars(pillar(0, 3))));
    if (!last.ok) throw new Error("last");
    expect(find(last.spec).repeat).toEqual({ count: 2, offset: [0, 0, 3] });
    // copies at z −6, −3, 0, 3, 6: the middle one meets it, the last does not.
    const middle = parseAstraSetText(JSON.stringify(withPillars(pillar(0, 5))));
    if (!middle.ok) throw new Error("middle");
    expect(find(middle.spec).repeat).toEqual({ count: 5, offset: [0, 0, 3] });
  });
});
