import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { describeOpenSides, measureClosure } from "./closure";
import { normaliseSetSpec, type SetSpec } from "./set-spec";
import rainyMarket from "./fixtures-rainy-market.json";
import showroomOpen from "./fixtures-showroom-open.json";
import showroomClosed from "./fixtures-showroom-closed.json";
import beach from "./fixtures-beach.json";

// The closure measure, on real Astra sets whose verdicts are known: blind
// judges agreed direction for direction on the first two kinds of case
// (2026-09-11), and the beach was checked by eye against its panorama.

const spec = (raw: unknown): SetSpec => {
  const r = normaliseSetSpec(raw);
  if (!r.ok) throw new Error("fixture");
  return r.spec;
};

const box = (position: [number, number, number], size: [number, number, number]) => ({
  shape: "box",
  position,
  rotation: [0, 0, 0],
  size,
  color: "#888888",
  roughness: 0.8,
  metalness: 0,
  emissive: null,
  emissiveIntensity: 0,
  castShadow: false,
  repeat: null,
});

const room = (withFrontWall: boolean) =>
  spec({
    bounds: { x: 10, z: 10, height: 4 },
    objects: [
      box([0, 2, -5], [10, 4, 0.2]),
      box([-5, 2, 0], [0.2, 4, 10]),
      box([5, 2, 0], [0.2, 4, 10]),
      ...(withFrontWall ? [box([0, 2, 5], [10, 4, 0.2])] : []),
      box([0, 4, 0], [10, 0.2, 10]),
    ],
    marks: [{ label: "", x: 0, z: 0, facingDeg: 0 }],
  });

describe("measureClosure", () => {
  it("finds a closed room closed", () => {
    expect(measureClosure(THREE, room(true)).openBearings).toEqual([]);
  });

  it("finds the missing fourth wall, and only there", () => {
    const r = measureClosure(THREE, room(false));
    expect(r.openBearings).toContain(0);
    expect(r.openBearings).not.toContain(180);
    expect(r.openSides).toEqual(["+Z"]);
    expect(describeOpenSides(room(false), r.openSides)).toEqual(["the +Z side (around z = 5)"]);
  });

  it("the production showroom: no wall where its cameras stood", () => {
    const s = spec(showroomOpen);
    const r = measureClosure(THREE, s);
    expect(r.openBearings).toContain(0);
    expect(r.openSides).toContain("+Z");
    expect(describeOpenSides(s, r.openSides)).toContain("the +Z side (around z = 10)");
  });

  it("the same brief built on the no-fourth-wall rule: closed", () => {
    expect(measureClosure(THREE, spec(showroomClosed)).openBearings).toEqual([]);
  });

  it("the first probe's street: open at the end the camera looks down", () => {
    const r = measureClosure(THREE, spec(rainyMarket));
    expect(r.perMark[0].openBearings).toContain(0);
  });

  it("the beach: sea dead ahead and dunes inland read closed; the shore both ways, and past the sea's edges, open", () => {
    const r = measureClosure(THREE, spec(beach));
    expect(r.perMark[0].openBearings).not.toContain(0);
    expect(r.perMark[0].openBearings).not.toContain(180);
    expect(r.perMark[0].openBearings).toContain(45);
    // The modelled sea is 200 m wide: just either side of dead ahead the
    // shallowest probe passes its edges, so +Z is named too.
    expect(r.openSides).toEqual(["+Z", "+X", "-X"]);
  });

  it("opens a bearing on 2 of its 5 rays, not 1", () => {
    const withGap = (from: number, to: number) =>
      spec({
        bounds: { x: 10, z: 10, height: 4 },
        objects: [
          box([0, 2, -5], [10, 4, 0.2]),
          box([-5, 2, 0], [0.2, 4, 10]),
          box([5, 2, 0], [0.2, 4, 10]),
          box([(-5 + from) / 2, 2, 5], [from + 5, 4, 0.2]),
          box([(to + 5) / 2, 2, 5], [5 - to, 4, 0.2]),
          box([0, 4, 0], [10, 0.2, 10]),
        ],
        marks: [{ label: "", x: 0, z: 0, facingDeg: 0 }],
      });
    // From the centre the fan crosses the +Z wall at x = 5·tan(-8°, -4°, 0°, 4°, 8°):
    // -0.70, -0.35, 0, 0.35, 0.70. A gap from -0.1 to 0.5 lets two through.
    expect(measureClosure(THREE, withGap(-0.1, 0.5)).openBearings).toEqual([0]);
    expect(measureClosure(THREE, withGap(-0.1, 0.2)).openBearings).toEqual([]);
  });

  it("a sea modelled edge to edge reads closed on large sets too", () => {
    // The largest planes the normaliser allows (200 m, centred up to 200 m
    // out) reach 300 m; the probe must not look past that.
    for (const size of [150, 200]) {
      const sea = [-200, 0, 200].flatMap((x) =>
        [-200, 0, 200].map((z) => ({ ...box([x, 0.02, z], [200, 0.01, 200]), shape: "plane", color: "#2d5f7a" })),
      );
      const s = spec({ bounds: { x: size, z: size, height: 20 }, objects: sea, marks: [{ label: "", x: 0, z: 0, facingDeg: 0 }] });
      expect(measureClosure(THREE, s).openBearings, `bounds ${size}`).toEqual([]);
    }
  });

  it("is quick enough to run on every build", () => {
    const s = spec(showroomOpen);
    const t0 = Date.now();
    measureClosure(THREE, s);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
