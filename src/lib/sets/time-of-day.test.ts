import { describe, expect, it } from "vitest";
import { DEFAULT_SET_RIG, normaliseSetRig } from "./rig";
import { normaliseSetSpec } from "./set-spec";
import { compassWord, lookAt, stagedSpec, sunAt, sunLight, timeApplies, timeLabel, timedSpec } from "./time-of-day";
import { schemeDefaults } from "./light-schemes";
import { nearestKelvin } from "./light-kelvin";
import showroom from "./fixtures-showroom-open.json";
import market from "./fixtures-rainy-market.json";

// Time of day (the light department, cut 3, 2026-09-17): an hour on the
// rig moves the sun, and the stage draws a timed copy of the set.

const load = (raw: unknown) => {
  const r = normaliseSetSpec(raw);
  if (!r.ok) throw new Error("fixture");
  return r.spec;
};
const room = load(showroom);
const night = load(market);
const mark = { x: 1, z: -2 };

describe("the sun's path", () => {
  it("rises in the east, stands highest and whitest in the south at noon, and sets in the west", () => {
    const dawn = sunAt(6.25);
    const noon = sunAt(12);
    const dusk = sunAt(17.5);
    expect(compassWord(dawn.azimuthDeg)).toBe("east");
    expect(compassWord(noon.azimuthDeg)).toBe("south");
    expect(compassWord(dusk.azimuthDeg)).toBe("west");
    expect(noon.elevationDeg).toBe(52);
    expect(dawn.elevationDeg).toBeLessThan(10);
    expect(noon.kelvin).toBe(5600);
    expect(dawn.kelvin).toBeLessThan(3000);
    expect(noon.intensity).toBeGreaterThan(dawn.intensity);
    expect(dawn.night).toBe(false);
  });

  it("is a moon at night", () => {
    for (const h of [5, 5.75, 18.5, 22]) {
      const s = sunAt(h);
      expect(s.night, String(h)).toBe(true);
      expect(s.intensity).toBeLessThan(1);
      expect(lookAt(h).sky.kind).toBe("night");
    }
    expect(lookAt(12).sky.kind).toBe("gradient");
    expect(lookAt(17.5).sky.colors).toHaveLength(3);
  });

  it("stands round the subject as a set light whose position gives its direction", () => {
    const l = sunLight(12, mark);
    expect(l.kind).toBe("sun");
    expect(l.target).toEqual([1, 0, -2]);
    expect(l.position[1]).toBeGreaterThan(40);
    // South of the mark: a bearing of 180° is -Z (0° = +Z, as a mark faces).
    expect(l.position[2]).toBeLessThan(mark.z);
    expect(Math.abs(l.position[0] - mark.x)).toBeLessThan(1);
    // Daylight white: 5,600 K on the blackbody line, read back as itself.
    expect(nearestKelvin(l.color)).toBe(5600);
    expect(sunLight(21, mark).color).toBe("#9fb4e0");
  });
});

describe("the set at an hour", () => {
  it("keeps the lamps, replaces the sun and the fills, and takes the hour's sky and fog", () => {
    const at = timedSpec(room, 17.5, mark);
    expect(room.lights.map((l) => l.kind)).toEqual(["sun", "hemisphere", "spot", "spot"]);
    expect(at.lights.map((l) => l.kind)).toEqual(["spot", "spot", "sun", "hemisphere"]);
    expect(at.sky).toEqual(lookAt(17.5).sky);
    expect(at.lights[2].color).not.toBe(room.lights[0].color);
    const foggy = timedSpec({ ...room, fog: { color: "#ffffff", near: 10, far: 100 } }, 21, mark);
    expect(foggy.fog?.color).toBe("#1a2340");
    expect(foggy.fog?.near).toBe(10);
    expect(timedSpec(room, null, mark)).toBe(room);
    // Never mutates.
    expect(room.lights[0].kind).toBe("sun");
  });

  it("gives a night set a day", () => {
    const noon = timedSpec(night, 12, mark);
    expect(noon.sky.kind).toBe("gradient");
    expect(noon.lights.filter((l) => l.kind === "point")).toHaveLength(3);
    expect(noon.lights.find((l) => l.kind === "sun")?.intensity).toBeGreaterThan(3);
  });
});

describe("with the rig's scheme", () => {
  it("waits under a plot whose key is a sun, and draws after a lamp plot", () => {
    const sunPlot = { ...DEFAULT_SET_RIG, time: 12, light: schemeDefaults("golden-hour", 0) };
    expect(timeApplies(sunPlot)).toBe(false);
    expect(stagedSpec(room, sunPlot, mark).sky).toEqual({ kind: "gradient", colors: ["#46507a", "#c98a62", "#f4c27e"] });
    const lampPlot = { ...DEFAULT_SET_RIG, time: 12, light: schemeDefaults("window", 0) };
    expect(timeApplies(lampPlot)).toBe(true);
    const staged = stagedSpec(room, lampPlot, mark);
    expect(staged.sky).toEqual(lookAt(12).sky);
    expect(staged.lights.some((l) => l.kind === "sun")).toBe(true);
    expect(timeApplies({ ...DEFAULT_SET_RIG, time: null })).toBe(false);
    expect(stagedSpec(room, { light: null, time: null }, mark)).toBe(room);
  });

  it("is saved on the rig in quarter hours between five and ten at night, or not at all", () => {
    expect(DEFAULT_SET_RIG.time).toBeNull();
    expect(normaliseSetRig({ time: 16.6 }).time).toBe(16.5);
    expect(normaliseSetRig({ time: 3 }).time).toBe(5);
    expect(normaliseSetRig({ time: 25 }).time).toBe(22);
    expect(normaliseSetRig({ time: "noon" }).time).toBeNull();
    expect(normaliseSetRig({}).time).toBeNull();
  });
});

describe("the readout", () => {
  it("names the hour and the compass point", () => {
    expect(timeLabel(16.75)).toBe("16:45");
    expect(timeLabel(5)).toBe("05:00");
    expect(compassWord(0)).toBe("north");
    expect(compassWord(225)).toBe("south-west");
    expect(compassWord(359)).toBe("north");
  });
});
