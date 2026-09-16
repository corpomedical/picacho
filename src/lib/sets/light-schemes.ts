// Light schemes (Helios Cinema, 2026-09-15): a scheme is a light PLOT, not
// an adjective. Picking one places the set's key light — a sun, a moon, a
// window, lamps — around the figure and the camera, and the stage relights,
// so the sketch the render must match already carries the light's direction
// (set-shot-prompt.ts: "Match … the direction of its light exactly"). The
// words (rig.ts RIG_LIGHTS) only say the mood a plot can't.
//
// The plot is anchored in the WORLD when the scheme is picked: its bearing
// is worked out from where the camera stands then (schemeDefaults), and kept
// on the rig as an absolute bearing, so orbiting the camera — or a film's
// move — never drags the sun along with it. Picking the scheme again re-aims
// it to the camera as it stands.
//
// It never edits the set: litSpec draws a lit COPY of the working copy for
// the stage. The set's own lamps (points and spots) stay; its sun and its
// fills give way to the scheme's, and the sky follows the scheme's hour
// where it has one. Astra's original and the working copy are untouched,
// and "As built" is simply no scheme.
//
// Pure and relative-import only: the page and the tests read it as it is.

import type { SetLight, SetSpec, Vec3 } from "./set-spec";
import { SET_LIMITS } from "./set-spec";
import type { RigLightScheme, RigLightState } from "./rig";

const DEG = Math.PI / 180;
const wrapDeg = (d: number) => ((d % 360) + 360) % 360;

/** A bearing from the subject: 0° = +Z, 90° = +X — the way a mark faces. */
export function bearingDeg(from: { x: number; z: number }, to: { x: number; z: number }): number {
  return wrapDeg(Math.atan2(to.x - from.x, to.z - from.z) / DEG);
}

/**
 * Where a scheme's key light goes, from where the camera stands now: its
 * world bearing from the subject and its height above the horizon.
 * `cameraBearing` is the bearing from the subject to the camera.
 */
export function schemeDefaults(scheme: RigLightScheme, cameraBearing: number): RigLightState {
  const at = (offset: number, elevationDeg: number): RigLightState => ({
    scheme,
    azimuthDeg: Math.round(wrapDeg(cameraBearing + offset) * 10) / 10,
    elevationDeg,
  });
  switch (scheme) {
    case "contre-jour":
      return at(180 + 12, 5);
    case "golden-hour":
      return at(180 - 60, 9);
    case "window":
      return at(90, 18);
    case "overhead":
      return at(180, 80);
    case "practicals":
      return at(150, 25);
    case "soft-cross":
      return at(45, 25);
    case "silhouette":
      return at(180, 3);
    case "hard-noon":
      return at(150, 72);
    case "moonlight":
      return at(200, 30);
  }
}

type SchemeLook = {
  /** The key light: a sun (directional) or placed sources. */
  key: "sun" | "window" | "overhead" | "practicals" | "soft-cross";
  color: string;
  intensity: number;
  /** A hemisphere fill under it: sky colour, ground colour, strength. */
  fill: { sky: string; ground: string; intensity: number };
  /** The sky the scheme's hour draws, or null to keep the set's. */
  sky: SetSpec["sky"] | null;
};

const SCHEMES: Record<RigLightScheme, SchemeLook> = {
  "contre-jour": {
    key: "sun",
    color: "#ffb877",
    intensity: 3.2,
    fill: { sky: "#8fa0c8", ground: "#5a4a40", intensity: 0.35 },
    sky: { kind: "gradient", colors: ["#2c3150", "#8a5c58", "#e9a567"] },
  },
  "golden-hour": {
    key: "sun",
    color: "#ffc27a",
    intensity: 2.8,
    fill: { sky: "#a9b4d0", ground: "#6a5440", intensity: 0.5 },
    sky: { kind: "gradient", colors: ["#46507a", "#c98a62", "#f4c27e"] },
  },
  window: {
    key: "window",
    color: "#eef3fb",
    intensity: 70,
    fill: { sky: "#d9e2ee", ground: "#4a4540", intensity: 0.28 },
    sky: null,
  },
  overhead: {
    key: "overhead",
    color: "#ffe9c8",
    intensity: 80,
    fill: { sky: "#6a7080", ground: "#2a2826", intensity: 0.12 },
    sky: null,
  },
  practicals: {
    key: "practicals",
    color: "#ffc27a",
    intensity: 22,
    fill: { sky: "#3a4658", ground: "#241f1a", intensity: 0.16 },
    sky: { kind: "night", colors: ["#080c14", "#1b2230"] },
  },
  "soft-cross": {
    key: "soft-cross",
    color: "#f4efe8",
    intensity: 50,
    fill: { sky: "#cdd6e4", ground: "#4a4540", intensity: 0.35 },
    sky: null,
  },
  silhouette: {
    key: "sun",
    color: "#fff0d6",
    intensity: 4.5,
    fill: { sky: "#6a7288", ground: "#2a2622", intensity: 0.08 },
    sky: { kind: "gradient", colors: ["#e9c9a0", "#fbe3bf"] },
  },
  "hard-noon": {
    key: "sun",
    color: "#ffffff",
    intensity: 3.6,
    fill: { sky: "#9cc2ec", ground: "#6a6258", intensity: 0.8 },
    sky: { kind: "gradient", colors: ["#4f86cf", "#bcd7f1"] },
  },
  moonlight: {
    key: "sun",
    color: "#9fb4e0",
    intensity: 0.9,
    fill: { sky: "#1c2848", ground: "#0c0e14", intensity: 0.14 },
    sky: { kind: "night", colors: ["#070b16", "#1a2340"] },
  },
};

const light = (l: Partial<SetLight> & Pick<SetLight, "kind" | "color" | "intensity">): SetLight => ({
  position: [0, 0, 0],
  target: [0, 0, 0],
  groundColor: null,
  angleDeg: 35,
  distance: 0,
  size: null,
  ...l,
});

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const along = (from: { x: number; z: number }, bearing: number, dist: number, y: number): Vec3 => [
  r3(from.x + Math.sin(bearing * DEG) * dist),
  r3(y),
  r3(from.z + Math.cos(bearing * DEG) * dist),
];

/** The scheme's own lights, placed round the subject (at the mark). */
export function schemeLights(state: RigLightState, spec: Pick<SetSpec, "bounds">, mark: { x: number; z: number }): SetLight[] {
  const look = SCHEMES[state.scheme];
  const subject: Vec3 = [mark.x, 1.2, mark.z];
  const out: SetLight[] = [
    light({ kind: "hemisphere", color: look.fill.sky, groundColor: look.fill.ground, intensity: look.fill.intensity, position: [0, 10, 0] }),
  ];
  const a = state.azimuthDeg;
  switch (look.key) {
    case "sun": {
      // Far enough out that its shadow camera spans the set (build-scene.ts).
      const reach = Math.max(spec.bounds.x, spec.bounds.z, 20);
      const up = Math.sin(state.elevationDeg * DEG);
      const flat = Math.cos(state.elevationDeg * DEG);
      out.push(
        light({
          kind: "sun",
          color: look.color,
          intensity: look.intensity,
          position: along(mark, a, reach * flat, subject[1] + reach * up),
          target: subject,
        }),
      );
      break;
    }
    case "window": {
      const dist = 3;
      const y = 1.4 + dist * Math.tan(state.elevationDeg * DEG);
      out.push(light({ kind: "spot", color: look.color, intensity: look.intensity, position: along(mark, a, dist, y), target: subject, angleDeg: 55, distance: 14 }));
      break;
    }
    case "overhead": {
      out.push(
        light({
          kind: "spot",
          color: look.color,
          intensity: look.intensity,
          position: along(mark, a, 0.4, 3.4),
          target: [mark.x, 0, mark.z],
          angleDeg: 32,
          distance: 9,
        }),
      );
      break;
    }
    case "practicals": {
      for (const [turn, dist, y, k] of [
        [0, 2.2, 1.6, 1],
        [125, 2.6, 1.3, 0.7],
        [-115, 2.0, 1.9, 0.8],
      ] as const) {
        out.push(light({ kind: "point", color: look.color, intensity: r3(look.intensity * k), position: along(mark, a + turn, dist, y), distance: 7 }));
      }
      break;
    }
    case "soft-cross": {
      for (const turn of [0, -90]) {
        out.push(
          light({
            kind: "spot",
            color: look.color,
            intensity: look.intensity,
            position: along(mark, a + turn, 2.8, 2.2),
            target: subject,
            angleDeg: 55,
            distance: 12,
          }),
        );
      }
      break;
    }
  }
  return out;
}

/**
 * The set as the stage draws it under a scheme: the set's own lamps kept
 * (points and spots, up to what the scheme leaves room for), its sun and
 * fills replaced by the scheme's, and the sky at the scheme's hour when it
 * has one. `state` null draws the set as built. Never mutates `spec`.
 */
export function litSpec(spec: SetSpec, state: RigLightState | null, mark: { x: number; z: number }): SetSpec {
  if (!state) return spec;
  const look = SCHEMES[state.scheme];
  const own = schemeLights(state, spec, mark);
  const lamps = spec.lights.filter((l) => l.kind === "point" || l.kind === "spot" || l.kind === "area").slice(0, Math.max(0, SET_LIMITS.maxLights - own.length));
  return {
    ...spec,
    lights: [...lamps, ...own],
    sky: look.sky ? { kind: look.sky.kind, colors: [...look.sky.colors] } : spec.sky,
    // A night scheme under a day fog would glow: the fog takes the sky's last colour.
    fog: spec.fog && look.sky ? { ...spec.fog, color: look.sky.colors[look.sky.colors.length - 1] } : spec.fog,
  };
}

/** The key light's bearing and height after a drag on the plot, kept in range. */
export function moveKeyLight(state: RigLightState, azimuthDeg: number, elevationDeg: number): RigLightState {
  return {
    scheme: state.scheme,
    azimuthDeg: Math.round(wrapDeg(azimuthDeg) * 10) / 10,
    elevationDeg: Math.round(Math.min(89, Math.max(1, elevationDeg)) * 10) / 10,
  };
}

/** Whether the scheme's key is a sun or moon (its height matters) rather than placed lamps. */
export function schemeHasSun(scheme: RigLightScheme): boolean {
  return SCHEMES[scheme].key === "sun";
}
