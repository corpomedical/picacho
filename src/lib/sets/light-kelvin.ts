// Colour temperature (the light department, cut 3, 2026-09-17). A light's
// colour stays a "#rrggbb" in the set — Astra writes colours, and every set
// so far has them — so Kelvin is a way of choosing one, not new data: the
// Build editor's Kelvin row writes the blackbody colour for a temperature,
// and reads a colour back as the temperature nearest to it. Blackbody
// colours follow Tanner Helland's fit of the CIE locus, the one every
// colour picker uses; good to a few per cent from 1,000 to 40,000 K.

export const KELVIN_MIN = 1800;
export const KELVIN_MAX = 10000;
export const KELVIN_STEP = 100;
/** Daylight: the temperature the stage's white is. */
export const KELVIN_DAYLIGHT = 5600;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The blackbody colour at a temperature, each channel 0–255. */
export function kelvinToRgb(kelvin: number): [number, number, number] {
  const t = clamp(kelvin, 1000, 40000) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [Math.round(clamp(r, 0, 255)), Math.round(clamp(g, 0, 255)), Math.round(clamp(b, 0, 255))];
}

export function kelvinToHex(kelvin: number): string {
  return "#" + kelvinToRgb(kelvin).map((c) => c.toString(16).padStart(2, "0")).join("");
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * The temperature whose colour is nearest to `hex`, by the colour's hue
 * (its channels as shares of their sum, so a dim warm and a bright warm
 * read the same). A colour off the blackbody line — a blue neon, a green
 * gel — still gets its nearest, which is what a Kelvin row can show.
 */
export function nearestKelvin(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return KELVIN_DAYLIGHT;
  const sum = rgb[0] + rgb[1] + rgb[2] || 1;
  const want = rgb.map((c) => c / sum);
  let best = KELVIN_DAYLIGHT;
  let bestD = Infinity;
  for (let k = KELVIN_MIN; k <= KELVIN_MAX; k += KELVIN_STEP) {
    const c = kelvinToRgb(k);
    const s = c[0] + c[1] + c[2] || 1;
    const d = (c[0] / s - want[0]) ** 2 + (c[1] / s - want[1]) ** 2 + (c[2] / s - want[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}
