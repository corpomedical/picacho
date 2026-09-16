// Time of day (the light department, cut 3, 2026-09-17), HELD BY THE STAGE:
// an hour on the rig moves the SUN — where it stands, how warm it is, how
// strong — and with it the sky, the fill and the fog, so the stage and the
// sketch the picture model is shown carry the hour's light by construction.
// The full stage's physical sky (build-scene.ts) follows the sun's height
// on its own; the basic stage's dome takes the hour's colours.
//
// Like a light scheme (light-schemes.ts), it never edits the set: the
// stage draws a timed COPY of what the scheme left — the set's lamps stay,
// its sun and fills give way. A scheme whose key IS a sun (contre-jour,
// golden hour, silhouette, hard noon, moonlight) already places the sun,
// so under one the hour waits: the panel says so.
//
// The sun's path is a plain one — a mid latitude at an equinox: up in the
// east at six, highest in the south at noon, down in the west at six, and
// the night in between under a moon. A place's real latitude and date are
// not something Astra writes, and a plot the person can read beats a
// calendar they cannot.

import type { SetLight, SetSpec } from "./set-spec";
import { SET_LIMITS } from "./set-spec";
import type { SetRig } from "./rig";
import { litSpec, schemeHasSun } from "./light-schemes";
import { kelvinToHex } from "./light-kelvin";

export const TIME_MIN = 5;
export const TIME_MAX = 22;
export const TIME_STEP = 0.25;
export const SUNRISE = 6;
export const SUNSET = 18;
/** How high the sun gets at noon, degrees (a mid latitude at an equinox). */
export const NOON_ELEVATION_DEG = 52;

const DEG = Math.PI / 180;
const r1 = (v: number) => Math.round(v * 10) / 10;

export type SunAt = {
  /** World bearing from the subject, degrees: 0 = +Z, 90 = +X (as a mark faces); the sun is in the east at 90, the south at 180, the west at 270. */
  azimuthDeg: number;
  /** Above the horizon; negative at night. */
  elevationDeg: number;
  kelvin: number;
  intensity: number;
  night: boolean;
};

/** Where the sun is at an hour, and what light it gives. */
export function sunAt(hour: number): SunAt {
  const h = Math.min(TIME_MAX, Math.max(TIME_MIN, hour));
  const day = (h - SUNRISE) / (SUNSET - SUNRISE);
  const elevationDeg = r1(NOON_ELEVATION_DEG * Math.sin(Math.PI * Math.min(1, Math.max(0, day))));
  const night = h < SUNRISE || h > SUNSET;
  // East at sunrise, south at noon, west at sunset; the moon takes the sun's place at night, low in the south.
  const azimuthDeg = night ? 200 : r1(90 + 180 * day);
  if (night) return { azimuthDeg, elevationDeg: 25, kelvin: 4100, intensity: 0.6, night };
  // Warm on the horizon, daylight-white overhead.
  const up = Math.min(1, elevationDeg / 35);
  const kelvin = Math.round((2000 + 3600 * Math.pow(up, 0.6)) / 100) * 100;
  const intensity = r1(1.2 + 2.4 * Math.sin(elevationDeg * DEG));
  return { azimuthDeg, elevationDeg: Math.max(2, elevationDeg), kelvin, intensity, night };
}

type Look = { sky: SetSpec["sky"]; fill: { sky: string; ground: string; intensity: number } };

/** The sky and the fill an hour draws: night, dusk or dawn, golden, day. */
export function lookAt(hour: number): Look {
  const sun = sunAt(hour);
  if (sun.night) return { sky: { kind: "night", colors: ["#070b16", "#1a2340"] }, fill: { sky: "#1c2848", ground: "#0c0e14", intensity: 0.14 } };
  if (sun.elevationDeg < 8) return { sky: { kind: "gradient", colors: ["#2c3150", "#8a5c58", "#e9a567"] }, fill: { sky: "#8fa0c8", ground: "#5a4a40", intensity: 0.35 } };
  if (sun.elevationDeg < 22) return { sky: { kind: "gradient", colors: ["#46507a", "#c98a62", "#f4c27e"] }, fill: { sky: "#a9b4d0", ground: "#6a5440", intensity: 0.5 } };
  return { sky: { kind: "gradient", colors: ["#4f86cf", "#bcd7f1"] }, fill: { sky: "#9cc2ec", ground: "#6a6258", intensity: 0.8 } };
}

/** The sun as a set light, standing round the subject: its position gives its direction (build-scene.ts re-places it). */
export function sunLight(hour: number, mark: { x: number; z: number }): SetLight {
  const sun = sunAt(hour);
  const d = 60;
  const az = sun.azimuthDeg * DEG;
  const el = sun.elevationDeg * DEG;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return {
    kind: "sun",
    color: sun.night ? "#9fb4e0" : kelvinToHex(sun.kelvin),
    intensity: sun.intensity,
    position: [r3(mark.x + Math.sin(az) * Math.cos(el) * d), r3(Math.sin(el) * d), r3(mark.z + Math.cos(az) * Math.cos(el) * d)],
    target: [r3(mark.x), 0, r3(mark.z)],
    groundColor: null,
    angleDeg: 30,
    distance: 0,
    size: null,
  };
}

/**
 * The set at an hour: the lamps kept (points, spots, areas — up to what the
 * sun and its fill leave room for), the sun and the fills replaced, the sky
 * and the fog's colour at the hour. Never mutates `spec`.
 */
export function timedSpec(spec: SetSpec, hour: number | null, mark: { x: number; z: number }): SetSpec {
  if (hour === null) return spec;
  const look = lookAt(hour);
  const own: SetLight[] = [
    sunLight(hour, mark),
    { kind: "hemisphere", color: look.fill.sky, intensity: look.fill.intensity, position: [0, 0, 0], target: [0, 0, 0], groundColor: look.fill.ground, angleDeg: 35, distance: 0, size: null },
  ];
  const lamps = spec.lights.filter((l) => l.kind === "point" || l.kind === "spot" || l.kind === "area").slice(0, Math.max(0, SET_LIMITS.maxLights - own.length));
  return {
    ...spec,
    lights: [...lamps, ...own],
    sky: { kind: look.sky.kind, colors: [...look.sky.colors] },
    fog: spec.fog ? { ...spec.fog, color: look.sky.colors[look.sky.colors.length - 1] } : spec.fog,
  };
}

/** Whether the rig's hour is drawn: not under a scheme whose key is a sun. */
export function timeApplies(rig: Pick<SetRig, "light" | "time">): boolean {
  return rig.time !== null && !(rig.light && schemeHasSun(rig.light.scheme));
}

/** The set as the stage draws it under the rig: the scheme's plot, then the hour where it applies. */
export function stagedSpec(spec: SetSpec, rig: Pick<SetRig, "light" | "time">, mark: { x: number; z: number }): SetSpec {
  const lit = litSpec(spec, rig.light, mark);
  return timeApplies(rig) ? timedSpec(lit, rig.time, mark) : lit;
}

/** "16:45" for 16.75. */
export function timeLabel(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** The compass word for a bearing the sun stands at, for the readout. */
export function compassWord(azimuthDeg: number): "north" | "north-east" | "east" | "south-east" | "south" | "south-west" | "west" | "north-west" {
  const words = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"] as const;
  return words[Math.round((((azimuthDeg % 360) + 360) % 360) / 45) % 8];
}
