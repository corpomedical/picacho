import { describe, expect, it } from "vitest";
import { bearingDeg, litSpec, moveKeyLight, schemeDefaults, schemeHasSun, schemeLights } from "./light-schemes";
import { RIG_LIGHTS } from "./rig";
import { SET_LIMITS, type SetLight, type SetSpec } from "./set-spec";

// A scheme is a light plot: it places the key light round the figure, keeps
// the set's own lamps, and never touches the set itself.

const lamp = (x: number): SetLight => ({
  kind: "point",
  color: "#ffd49a",
  intensity: 30,
  position: [x, 3, 0],
  target: [0, 0, 0],
  groundColor: null,
  angleDeg: 35,
  distance: 12,
});
const spec = {
  bounds: { x: 30, z: 30, height: 10 },
  sky: { kind: "gradient", colors: ["#618bb6", "#cedce5"] },
  fog: { color: "#cedce5", near: 20, far: 90 },
  lights: [
    { ...lamp(0), kind: "sun", intensity: 2.5, position: [10, 20, 10] },
    { ...lamp(0), kind: "hemisphere", intensity: 1, groundColor: "#333333" },
    lamp(-4),
    lamp(4),
  ],
} as unknown as SetSpec;
const mark = { x: 2, z: -3 };

describe("bearings", () => {
  it("reads 0° along +Z and 90° along +X, the way a mark faces", () => {
    expect(bearingDeg({ x: 0, z: 0 }, { x: 0, z: 5 })).toBeCloseTo(0, 6);
    expect(bearingDeg({ x: 0, z: 0 }, { x: 5, z: 0 })).toBeCloseTo(90, 6);
    expect(bearingDeg({ x: 0, z: 0 }, { x: 0, z: -5 })).toBeCloseTo(180, 6);
  });
});

describe("schemeDefaults: from where the camera stands", () => {
  it("puts contre-jour's sun behind the figure, low", () => {
    const d = schemeDefaults("contre-jour", 30);
    expect(Math.abs(((d.azimuthDeg - (30 + 180)) + 540) % 360 - 180)).toBeLessThanOrEqual(15);
    expect(d.elevationDeg).toBeLessThan(10);
  });

  it("has a default for every scheme", () => {
    for (const l of RIG_LIGHTS) {
      const d = schemeDefaults(l.id, 0);
      expect(d.scheme).toBe(l.id);
      expect(d.azimuthDeg).toBeGreaterThanOrEqual(0);
      expect(d.azimuthDeg).toBeLessThan(360);
    }
  });
});

describe("litSpec", () => {
  it("draws the set as built when there is no scheme", () => {
    expect(litSpec(spec, null, mark)).toBe(spec);
  });

  it("keeps the set's lamps, replaces its sun and fills, and never mutates the set", () => {
    const before = JSON.stringify(spec);
    const lit = litSpec(spec, schemeDefaults("contre-jour", 0), mark);
    expect(JSON.stringify(spec)).toBe(before);
    expect(lit.lights.filter((l) => l.kind === "point")).toHaveLength(2);
    expect(lit.lights.filter((l) => l.kind === "sun")).toHaveLength(1);
    expect(lit.lights.filter((l) => l.kind === "hemisphere")).toHaveLength(1);
    expect(lit.lights.find((l) => l.kind === "sun")!.color).not.toBe("#ffd49a");
  });

  it("puts a sun where its bearing and height say, aimed at the figure", () => {
    const lit = litSpec(spec, { scheme: "golden-hour", azimuthDeg: 90, elevationDeg: 30 }, mark);
    const sun = lit.lights.find((l) => l.kind === "sun")!;
    const dx = sun.position[0] - sun.target[0];
    const dy = sun.position[1] - sun.target[1];
    const dz = sun.position[2] - sun.target[2];
    expect(Math.atan2(dx, dz) * (180 / Math.PI)).toBeCloseTo(90, 3);
    expect(Math.atan2(dy, Math.hypot(dx, dz)) * (180 / Math.PI)).toBeCloseTo(30, 3);
    expect(sun.target[0]).toBe(mark.x);
    expect(sun.target[2]).toBe(mark.z);
  });

  it("gives the hour its sky, and a night its fog", () => {
    const night = litSpec(spec, schemeDefaults("moonlight", 0), mark);
    expect(night.sky.kind).toBe("night");
    expect(night.fog!.color).toBe(night.sky.colors[night.sky.colors.length - 1]);
    // A window lights the room it is in: the sky stays the set's.
    expect(litSpec(spec, schemeDefaults("window", 0), mark).sky).toEqual(spec.sky);
  });

  it("never holds more lights than a set may", () => {
    const crowded = { ...spec, lights: Array.from({ length: 8 }, (_, i) => lamp(i)) } as SetSpec;
    for (const l of RIG_LIGHTS) {
      expect(litSpec(crowded, schemeDefaults(l.id, 0), mark).lights.length).toBeLessThanOrEqual(SET_LIMITS.maxLights);
    }
  });

  it("places lamps, not suns, for the placed schemes", () => {
    expect(schemeLights(schemeDefaults("practicals", 0), spec, mark).filter((l) => l.kind === "point")).toHaveLength(3);
    expect(schemeLights(schemeDefaults("soft-cross", 0), spec, mark).filter((l) => l.kind === "spot")).toHaveLength(2);
    expect(schemeHasSun("window")).toBe(false);
    expect(schemeHasSun("moonlight")).toBe(true);
  });
});

describe("moveKeyLight", () => {
  it("wraps the bearing and keeps the light above the horizon", () => {
    expect(moveKeyLight({ scheme: "contre-jour", azimuthDeg: 0, elevationDeg: 5 }, -90, -4)).toEqual({
      scheme: "contre-jour",
      azimuthDeg: 270,
      elevationDeg: 1,
    });
  });
});
