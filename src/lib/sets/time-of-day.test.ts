import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SET_RIG, normaliseSetRig } from "./rig";
import { SET_LIMITS, normaliseSetSpec } from "./set-spec";
import { TIME_OF_DAY_SENTENCE, compassWord, hourWords, lookAt, stagedSpec, sunAt, sunLight, timeApplies, timeLabel, timedSpec } from "./time-of-day";
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

describe("an hour over a lamp plot", () => {
  it("keeps the plot's own key light, not only the set's lamps", () => {
    // The hour's sun and fill take two of the set's light slots, and
    // timedSpec keeps as many of the rest as fit. The plot's own lights are
    // first, so what its words describe is what the stage draws (found
    // reviewing Helios, 2026-09-17: a window plot lost its window at 12:00).
    const lamps = Array.from({ length: SET_LIMITS.maxLights }, (_, i) => ({
      kind: "point" as const,
      color: "#ffffff",
      intensity: 1,
      position: [i, 2, 0] as [number, number, number],
      target: [0, 0, 0] as [number, number, number],
      groundColor: null,
      angleDeg: 30,
      distance: 0,
      size: null,
    }));
    const set = { ...room, lights: lamps };
    const staged = stagedSpec(set, { light: { scheme: "window", azimuthDeg: 90, elevationDeg: 20 }, time: 12 }, { x: 0, z: 0 });
    // The window's own light — a spot in the plot's own colour — survives the hour.
    const lit = stagedSpec(set, { light: { scheme: "window", azimuthDeg: 90, elevationDeg: 20 }, time: null }, { x: 0, z: 0 });
    const key = lit.lights.find((l) => l.kind === "spot");
    expect(key).toBeDefined();
    expect(staged.lights.some((l) => l.kind === "spot" && l.color === key!.color)).toBe(true);
    // And the hour's own sun and fill are there too.
    expect(staged.lights.some((l) => l.kind === "sun")).toBe(true);
  });
});

describe("the hour in a shot's words", () => {
  it("says the hour the stage drew, with the sun's own height and colour", () => {
    expect(hourWords(12)).toBe("Time of day: 12:00 — the sun 52° above the horizon, its light about 5600 K.");
    expect(hourWords(21)).toBe("Time of day: 21:00 — night: no sun, a low moon, the place lit by its own lamps.");
    expect(hourWords(null)).toBe("");
    // Never a second table: the numbers are sunAt's, the clock is timeLabel's.
    const sun = sunAt(16.25);
    expect(hourWords(16.25)).toContain(`${Math.round(sun.elevationDeg)}° above the horizon`);
    expect(hourWords(16.25)).toContain(`${sun.kelvin} K`);
    expect(hourWords(16.25)).toContain(timeLabel(16.25));
  });

  it("is one sentence, which the scaffold stripper takes out whole", () => {
    for (const h of [5, 6.25, 12, 16.75, 21, 22]) {
      const said = hourWords(h);
      expect(said.replace(TIME_OF_DAY_SENTENCE, "").trim(), String(h)).toBe("");
    }
  });
});

// The shot is described at the hour the stage drew it, by the stage's own
// rule — read as source, since actions.ts is "use server" and the page needs
// a browser (found reviewing Helios, fixed 2026-09-18).
describe("what sends the hour", () => {
  const actions = readFileSync(join(__dirname, "actions.ts"), "utf8");
  const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");

  it("a still is described at the rig's hour, when the stage draws it", () => {
    expect(actions).toContain("hour: hourWords(timeApplies(rig) ? rig.time : null),");
    // The one rule: the words are on exactly when the stage draws the hour.
    expect(actions).not.toContain("rig.time !== null ? hourWords(");
  });

  it("a film beat is described at the beat's hour, the one its stage was rebuilt at", () => {
    const render = view.slice(view.indexOf("  async function renderFilm("), view.indexOf("\n  }\n", view.indexOf("  async function renderFilm(")));
    expect(render).toContain("rig: { ...rigRef.current, time: staged.time },");
  });
});
