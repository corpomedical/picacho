import { describe, expect, it } from "vitest";
import race from "./fixtures-race-track.json";
import beach from "./fixtures-beach.json";
import market from "./fixtures-rainy-market.json";
import open from "./fixtures-showroom-open.json";
import closed from "./fixtures-showroom-closed.json";
import { trimRepeatsOnMarks } from "./marks";
import { normaliseSetSpec, parseSetSpecText, type SetObject } from "./set-spec";

// Stage 8 (2026-09-29): the builder's repeat one step too far. The race
// track's 4 × 20 × 136 m wall is repeated with an offset of 50 in a set 100
// wide, so its second copy stands at x −4…0 — through the track, over the
// "Trackside apron" mark and half the car. It came from Astra's answer, not
// from the fixture: the fixture is the operator's first set as it was saved.
const WALL = (o: SetObject) => o.shape === "box" && o.size[0] === 4 && o.size[1] === 20 && o.size[2] === 136;

describe("a repeat whose last copy lands on a mark", () => {
  it("is cut back when Astra's answer comes in (a build or an edit), and noted", () => {
    const fresh = parseSetSpecText(JSON.stringify(race));
    if (!fresh.ok) throw new Error("race");
    const wall = fresh.spec.objects.find(WALL)!;
    expect(wall.repeat).toBeNull();
    expect(wall.position).toEqual([-52, 10, 0]);
    expect(fresh.notes).toContain("repeat_on_mark_trimmed");
    // With the stray wall gone, the apron mark is on open floor again and stays where Astra put it.
    expect(fresh.spec.marks.find((m) => m.label === "Trackside apron")).toMatchObject({ x: -3, z: 3.5 });
  });

  it("leaves every set already saved as it reads back, byte for byte", () => {
    const saved = normaliseSetSpec(race);
    if (!saved.ok) throw new Error("race");
    expect(saved.spec.objects.find(WALL)!.repeat).toEqual({ count: 2, offset: [50, 0, 0] });
    expect(saved.notes).not.toContain("repeat_on_mark_trimmed");
  });

  it("touches no other fixture, fresh or saved", () => {
    for (const set of [beach, market, open, closed]) {
      const a = parseSetSpecText(JSON.stringify(set)), b = normaliseSetSpec(set);
      if (!a.ok || !b.ok) throw new Error("fixture");
      expect(a.notes).not.toContain("repeat_on_mark_trimmed");
      expect(a.spec.objects).toEqual(b.spec.objects);
    }
  });

  it("keeps a copy in the middle of a row, and a thing whose first copy is on the mark (the mark steps off instead)", () => {
    const post = (repeat: SetObject["repeat"], x = -4): SetObject =>
      ({ shape: "box", size: [0.3, 2.5, 0.3], position: [x, 1.25, 0], rotation: [0, 0, 0], color: "#888888", repeat }) as SetObject;
    const row = [post({ count: 5, offset: [2, 0, 0] })];
    expect(trimRepeatsOnMarks(row, [{ x: -2, z: 0 }])).toBe(0);
    expect(row[0].repeat).toEqual({ count: 5, offset: [2, 0, 0] });
    const first = [post({ count: 2, offset: [2, 0, 0] })];
    expect(trimRepeatsOnMarks(first, [{ x: -4, z: 0 }])).toBe(0);
    const last = [post({ count: 3, offset: [2, 0, 0] })];
    expect(trimRepeatsOnMarks(last, [{ x: 0, z: 0 }])).toBe(1);
    expect(last[0].repeat).toEqual({ count: 2, offset: [2, 0, 0] });
    // Something low you stand on (a kerb) never counts.
    const kerb = [{ ...post({ count: 2, offset: [2, 0, 0] }), size: [0.9, 0.12, 3], position: [-4, 0.06, 0] } as SetObject];
    expect(trimRepeatsOnMarks(kerb, [{ x: -2, z: 0 }])).toBe(0);
  });
});
