import { describe, expect, it } from "vitest";
import { normaliseSetSpec, type SetSpec } from "./set-spec";
import { oversizedSeating } from "./human-scale";
import raceTrack from "./fixtures-race-track.json";

// The ruler's second line: the hint must fire on the one documented failure
// — the photo-built sitting room whose sofa cushions topped out at 0.84 m —
// and stay quiet on honest rooms, lone table tops, and the race track.

const room = (objects: { shape: string; size: number[]; position: number[] }[]): SetSpec =>
  ({
    objects: objects.map((o) => ({ shape: o.shape, size: o.size, position: o.position })),
  }) as unknown as SetSpec;

describe("oversizedSeating", () => {
  it("fires on the documented failure: sofa cushions hip-high on a person", () => {
    // The Cream Corner Sitting Room's own numbers (2026-09-15): three seat
    // slabs whose tops land at 0.84 m.
    expect(
      oversizedSeating(
        room([
          { shape: "box", size: [1.17, 0.16, 1.15], position: [0, 0.76, 0] },
          { shape: "box", size: [1.32, 0.16, 1.96], position: [1.5, 0.76, 0] },
          { shape: "box", size: [1.29, 0.16, 1.12], position: [3, 0.76, 0] },
        ]),
      ),
    ).toBe(true);
  });

  it("stays quiet on a sofa built at human scale", () => {
    expect(
      oversizedSeating(
        room([
          { shape: "box", size: [1.2, 0.16, 1.0], position: [0, 0.37, 0] },
          { shape: "box", size: [1.2, 0.16, 1.0], position: [1.3, 0.37, 0] },
          { shape: "box", size: [1.8, 0.04, 0.9], position: [0, 0.4, 1.6] },
        ]),
      ),
    ).toBe(false);
  });

  it("forgives one tall slab — a dining table's top is not a seat", () => {
    expect(
      oversizedSeating(room([{ shape: "box", size: [1.8, 0.05, 0.9], position: [0, 0.73, 0] }])),
    ).toBe(false);
  });

  it("ignores beds (too thick), shelves (too high) and small props", () => {
    expect(
      oversizedSeating(
        room([
          { shape: "box", size: [2.0, 0.5, 1.6], position: [0, 0.35, 0] },
          { shape: "box", size: [1.8, 0.03, 0.3], position: [0, 1.8, -2] },
          { shape: "box", size: [0.4, 0.1, 0.4], position: [1, 0.9, 1] },
          { shape: "box", size: [1.8, 0.03, 0.3], position: [0, 2.2, -2] },
        ]),
      ),
    ).toBe(false);
  });

  it("stays quiet on the race track", () => {
    const n = normaliseSetSpec(raceTrack);
    if (!n.ok) throw new Error("fixture invalid");
    expect(oversizedSeating(n.spec)).toBe(false);
  });
});
