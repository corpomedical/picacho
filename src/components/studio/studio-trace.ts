// Helios Studio's own path tracer, made to look like Blender Cycles
// (2026-09-29, operator: "something of our own without paying a monthly
// fee" → "Lets go with A. Build it better."). Everything runs on the
// person's own device: three-gpu-pathtracer (MIT) traces, Open Image Denoise
// (Intel's network, Apache-2.0 weights in public/studio/oidn) cleans the
// grain through oidn-web (MIT, WebGPU), and nothing is sent anywhere.
//
// This file holds the parts that are plain numbers — the quality presets,
// the size, the time estimate, and the light dome (the sky baked into an
// equirectangular picture the tracer importance-samples, with the sun as a
// small bright disc of the right size and strength) — so they run in node
// tests, plus the one call into the denoiser. The engine (studio-engine.ts)
// draws the sky, reads the pictures back and shows the result.

export type TraceKind = "still" | "animation";
export type TraceQuality = "draft" | "final" | "custom";

/** Samples per pixel: Draft is quick and still clean after the denoiser; Final is what a finished picture uses. */
export const TRACE_PRESETS: Record<TraceKind, { draft: number; final: number }> = {
  still: { draft: 32, final: 256 },
  animation: { draft: 8, final: 32 },
};
export const TRACE_MAX_SAMPLES: Record<TraceKind, number> = { still: 4096, animation: 512 };
/** The shot camera's format at half, full or double size. */
export const TRACE_SCALES = [0.5, 1, 2] as const;

export function traceSamples(kind: TraceKind, quality: TraceQuality, custom: number): number {
  if (quality === "custom") return Math.max(1, Math.min(TRACE_MAX_SAMPLES[kind], Math.round(custom) || 1));
  return TRACE_PRESETS[kind][quality];
}

/** The output size for a scale of the format's own size, kept even (video encoders want even sides). */
export function traceSize(base: readonly [number, number], scale: number): [number, number] {
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return [even(base[0]), even(base[1])];
}

/** Where the device's measured speed is kept between renders (milliseconds per sample per megapixel). */
export const TRACE_SPEED_KEY = "helios.pt.speed";

/** Seconds for a render at a measured speed; null until this device has been timed. */
export function traceEstimate(msPerSampleMp: number | null, samples: number, w: number, h: number, frames = 1, denoiseSeconds = 0): number | null {
  if (!msPerSampleMp || !Number.isFinite(msPerSampleMp) || msPerSampleMp <= 0) return null;
  const perFrame = (msPerSampleMp * samples * (w * h)) / 1e6 / 1000 + denoiseSeconds;
  return perFrame * frames;
}

/** Past this a render is slow enough to say so and suggest Draft or half size. */
export const TRACE_SLOW_SECONDS: Record<TraceKind, number> = { still: 600, animation: 3600 };

/** "40 s", "3 min", "1 h 5 min" — the same words the Cycles window uses. */
export function traceDuration(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

// ---------------- the light dome ----------------

/** The dome's size: 2048 × 1024 texels, a texel is about 0.18° across. */
export const ENV_W = 2048;
export const ENV_H = 1024;
/** Blender's default sun: 0.526° across, the real sun's size. */
export const SUN_DIAMETER_DEG = 0.526;
/** The tracer keeps the dome in half floats (largest 65,504); the sun disc widens until it stays well under that. */
export const SUN_MAX_RADIANCE = 20000;

/** The direction of texel (i, j), row 0 at the bottom — three's equirect layout (u = atan(z, x), v = asin(y)). */
export function envDir(i: number, j: number, w: number, h: number): [number, number, number] {
  const phi = ((i + 0.5) / w - 0.5) * 2 * Math.PI;
  const th = ((j + 0.5) / h - 0.5) * Math.PI;
  return [Math.cos(th) * Math.cos(phi), Math.sin(th), Math.cos(th) * Math.sin(phi)];
}

/** The solid angle a texel of row j covers. */
export function envTexelSolidAngle(j: number, w: number, h: number): number {
  const th = ((j + 0.5) / h - 0.5) * Math.PI;
  return ((2 * Math.PI) / w) * (Math.PI / h) * Math.cos(th);
}

type Rgb = [number, number, number];

/** Light landing on a surface facing straight up (Σ L · cos · dω over the upper half). */
export function envUpIrradiance(data: Float32Array, w: number, h: number): Rgb {
  const out: Rgb = [0, 0, 0];
  for (let j = h / 2; j < h; j++) {
    const th = ((j + 0.5) / h - 0.5) * Math.PI, dw = envTexelSolidAngle(j, w, h) * Math.sin(th);
    for (let i = 0; i < w; i++) {
      const k = (j * w + i) * 4;
      out[0] += data[k] * dw; out[1] += data[k + 1] * dw; out[2] += data[k + 2] * dw;
    }
  }
  return out;
}

export const luminance = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Fills the dome: `upper` above the horizon and `lower` below, as radiance. Adds to what is there. */
export function envAddSplit(data: Float32Array, w: number, h: number, upper: Rgb, lower: Rgb, from: "upper" | "lower" | "both" = "both"): void {
  for (let j = 0; j < h; j++) {
    const up = j >= h / 2;
    if ((up && from === "lower") || (!up && from === "upper")) continue;
    const c = up ? upper : lower;
    for (let i = 0; i < w; i++) {
      const k = (j * w + i) * 4;
      data[k] += c[0]; data[k + 1] += c[1]; data[k + 2] += c[2]; data[k + 3] = 1;
    }
  }
}

/**
 * Paints the sun into the dome: a disc around `dir` whose light on a surface
 * facing it equals `irradiance` (the viewport sun's colour × strength), so a
 * traced frame is lit as brightly as the viewport. The disc starts at
 * `diameterDeg` and widens only as far as the half-float dome needs.
 * Returns the diameter used and the texels painted.
 */
export function envAddSun(data: Float32Array, w: number, h: number, dir: readonly number[], irradiance: Rgb, diameterDeg = SUN_DIAMETER_DEG, maxRadiance = SUN_MAX_RADIANCE): { diameterDeg: number; texels: number } {
  const n = Math.hypot(dir[0], dir[1], dir[2]) || 1, d = [dir[0] / n, dir[1] / n, dir[2] / n];
  const peak = Math.max(irradiance[0], irradiance[1], irradiance[2]);
  if (peak <= 0) return { diameterDeg: 0, texels: 0 };
  const lat = Math.asin(Math.max(-1, Math.min(1, d[1])));
  let radius = ((diameterDeg / 2) * Math.PI) / 180;
  for (let tries = 0; tries < 40; tries++) {
    const cosR = Math.cos(radius), hits: number[] = [];
    let omega = 0, best = -2, bestK = -1, bestW = 0;
    const j0 = Math.max(0, Math.floor(((lat - radius) / Math.PI + 0.5) * h) - 1), j1 = Math.min(h - 1, Math.ceil(((lat + radius) / Math.PI + 0.5) * h) + 1);
    for (let j = j0; j <= j1; j++) {
      const dw = envTexelSolidAngle(j, w, h);
      for (let i = 0; i < w; i++) {
        const v = envDir(i, j, w, h), c = v[0] * d[0] + v[1] * d[1] + v[2] * d[2];
        if (c > best) { best = c; bestK = j * w + i; bestW = dw; }
        if (c >= cosR) { hits.push(j * w + i, dw); omega += dw; }
      }
    }
    if (!hits.length && bestK >= 0) { hits.push(bestK, bestW); omega = bestW; }
    if (peak / omega > maxRadiance && tries < 39) { radius *= 1.2; continue; }
    const L: Rgb = [irradiance[0] / omega, irradiance[1] / omega, irradiance[2] / omega];
    for (let x = 0; x < hits.length; x += 2) {
      const k = hits[x] * 4;
      data[k] += L[0]; data[k + 1] += L[1]; data[k + 2] += L[2]; data[k + 3] = 1;
    }
    return { diameterDeg: (radius * 2 * 180) / Math.PI, texels: hits.length / 2 };
  }
  return { diameterDeg: 0, texels: 0 };
}

// ---------------- sun and sky from one model (physical sky) ----------------

/** The Studio's physical sky settings (studio-engine.ts sets the viewport's Sky.js to these). */
export const STUDIO_SKY = { turbidity: 5, rayleigh: 1.6, mieCoefficient: 0.005 } as const;
/** The sun's light at the zenith, straight on: the viewport's midday sun strength. */
export const SUN_ZENITH_IRRADIANCE = 3;
/** Clear-sky diffuse light on a roof as a share of the sun's direct-normal light (ASHRAE's clear-sky C, 0.06–0.14; a touch more for a hazier sky). */
export const SKY_DIFFUSE_SHARE = 0.15;

/**
 * How much of the sun's light gets through the air at an elevation, per colour: Sky.js's own Preetham terms
 * (Rayleigh + Mie extinction over the optical path), so the traced sun turns warm and dims as it sinks exactly as
 * the viewport's physical sky does.
 */
export function skyTransmittance(elevationRad: number, sky: { turbidity: number; rayleigh: number; mieCoefficient: number } = STUDIO_SKY): Rgb {
  const totalRayleigh = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
  const mieConst = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
  const c = 0.2 * sky.turbidity * 10e-18;
  const zenith = Math.acos(Math.max(0, Math.sin(Math.max(elevationRad, 0))));
  const inverse = 1 / (Math.cos(zenith) + 0.15 * Math.pow(93.885 - (zenith * 180) / Math.PI, -1.253));
  const sR = 8.4e3 * inverse, sM = 1.25e3 * inverse;
  return [0, 1, 2].map((k) => Math.exp(-(totalRayleigh[k] * sky.rayleigh * sR + 0.434 * c * mieConst[k] * sky.mieCoefficient * sM))) as Rgb;
}

/** The sun's direct-normal light (colour × strength) at an elevation: white and SUN_ZENITH_IRRADIANCE overhead, orange and weaker low down. */
export function physicalSunIrradiance(elevationRad: number): Rgb {
  const t = skyTransmittance(elevationRad), t0 = skyTransmittance(Math.PI / 2);
  return [0, 1, 2].map((k) => (SUN_ZENITH_IRRADIANCE * t[k]) / t0[k]) as Rgb;
}

// ---------------- metering ----------------

/** Where the metered picture's brightest 2 % lands (scene light, before AgX): bright, but short of white. */
export const METER_HIGHLIGHT = 0.6;

/**
 * A camera's exposure for a picture: the log-average luminance brought to mid-grey (0.18), but never so far that
 * the brightest 2 % (a sunlit wall, the sky) passes METER_HIGHLIGHT — a dark foreground under a bright wall would
 * otherwise wash the wall out. Kept within −3…+4 EV.
 */
export function meterExposure(rgba: Float32Array): number {
  const BINS = 240, LO = -14; // log2 luminance −14…+10 in tenths
  const hist = new Uint32Array(BINS);
  let sum = 0, n = 0;
  for (let k = 0; k < rgba.length; k += 4) {
    const l = 0.2126 * rgba[k] + 0.7152 * rgba[k + 1] + 0.0722 * rgba[k + 2];
    if (!Number.isFinite(l)) continue;
    const g = Math.log2(Math.max(l, 1e-4));
    sum += g; n++;
    hist[Math.min(BINS - 1, Math.max(0, Math.floor((g - LO) * 10)))]++;
  }
  if (!n) return 1;
  let seen = 0, top = LO;
  for (let b = 0; b < BINS; b++) { seen += hist[b]; if (seen >= n * 0.98) { top = LO + (b + 1) / 10; break; } }
  const byAverage = 0.18 / 2 ** (sum / n), byHighlights = METER_HIGHLIGHT / 2 ** top;
  return Math.min(16, Math.max(1 / 8, Math.min(byAverage, byHighlights)));
}

// ---------------- the denoiser ----------------

/** Open Image Denoise's ray-tracing network for HDR colour with albedo and normal guides (Intel, Apache-2.0). */
export const OIDN_WEIGHTS_URL = "/studio/oidn/rt_hdr_alb_nrm.tza";

type Unet = { tileExecute: (o: Record<string, unknown>) => () => void };
let unetLoad: Promise<Unet | null> | null = null;

/** The denoiser, loaded once; null when this browser has no WebGPU or the network doesn't start. */
export function loadOidn(url = OIDN_WEIGHTS_URL): Promise<Unet | null> {
  if (unetLoad) return unetLoad;
  const gpu = typeof navigator !== "undefined" ? (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu : undefined;
  if (!gpu) return (unetLoad = Promise.resolve(null));
  unetLoad = (async () => {
    try {
      if (!(await gpu.requestAdapter())) return null;
      const { initUNetFromURL } = await import("oidn-web");
      return (await initUNetFromURL(url, undefined, { aux: true, hdr: true })) as unknown as Unet;
    } catch (e) {
      console.warn("Helios Studio: Open Image Denoise didn't start", e);
      return null;
    }
  })();
  return unetLoad;
}

/**
 * The brightest colour value handed to the denoiser: the largest half float, the precision its network runs in on
 * most graphics cards. Far past white, so nothing a picture shows is changed by it.
 */
export const OIDN_MAX_INPUT = 65504;
/** How long a denoise may take before it is given up (a lost graphics card never calls back). */
export const OIDN_TIMEOUT_MS = 180_000;

/**
 * A colour value as the denoiser must get it: not a number, infinite or below zero is 0, and nothing passes
 * OIDN_MAX_INPUT (Open Image Denoise's own input rule; oidn-web 0.4.0 doesn't apply it). oidn-web exposes each
 * tile by the average log brightness of ITS pixels (process.ts avgLogLum), so one NaN, infinite or negative pixel
 * makes that whole tile's exposure NaN or 0 and the tile comes back black: the live 2026-10-01 still (1280 x 720,
 * Final 256, photographed sky) lost the top-left 384 x 336 — exactly one of its 384-pixel tiles.
 */
export const oidnColorValue = (v: number) => (v > 0 ? (v < OIDN_MAX_INPUT ? v : OIDN_MAX_INPUT) : 0);
/** Albedo (0-1) x 255 for oidn-web (it divides by 255); not a number is 0. */
export const oidnAlbedoValue = (v: number) => (v > 0 ? (v < 1 ? v : 1) * 255 : 0);
/** A normal (-1...1) x 255 for oidn-web; not a number is 0. */
export const oidnNormalValue = (v: number) => (v > -1 ? (v < 1 ? v : 1) : v <= -1 ? -1 : 0) * 255;

/** The denoise came back with blank patches, or didn't come back: the caller cleans the picture another way. */
export class OidnFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OidnFailed";
  }
}

/**
 * Denoises linear HDR colour (RGBA floats) guided by albedo (0–1) and a
 * normal (−1…1), all the same size and row order. oidn-web 0.4.0 divides its
 * albedo and normal inputs by 255 (it expects bytes), so they are handed in
 * as floats already × 255: the network sees real 0–1 albedo and real −1…1
 * normals, not bytes squeezed into 0–1. The version is pinned for this.
 *
 * Every input value is made safe first (oidnColorValue and its siblings), and
 * the result is checked patch by patch (oidnBlankPatches): where the input has
 * light and the result is blank, or the network never answers, it rejects
 * with OidnFailed, so a broken tile is never shown as the picture.
 */
export function oidnDenoise(unet: Unet, color: Float32Array, albedo01: Float32Array, normal: Float32Array, w: number, h: number, timeoutMs = OIDN_TIMEOUT_MS): Promise<Float32Array> {
  // oidn-web 0.4.0 cuts square tiles and reads past the picture's edge when a side is shorter than a tile (640 × 360
  // came back all NaN; 256 × 256 and 1280 × 720 were fine): the picture goes in as a square, edges repeated, and the
  // result is cut back out.
  const s = oidnSide(w, h), c = oidnPad(color, w, h, s, oidnColorValue), a = oidnPad(albedo01, w, h, s, oidnAlbedoValue), n = oidnPad(normal, w, h, s, oidnNormalValue);
  return new Promise((resolve, reject) => {
    let abort: (() => void) | null = null, over = false;
    const timer = setTimeout(() => { over = true; abort?.(); reject(new OidnFailed(`Open Image Denoise didn't finish in ${Math.round(timeoutMs / 1000)} s`)); }, timeoutMs);
    try {
      abort = unet.tileExecute({
        color: { data: c, width: s, height: s },
        albedo: { data: a, width: s, height: s },
        normal: { data: n, width: s, height: s },
        done: (out: { data: Float32Array }) => {
          if (over) return;
          clearTimeout(timer);
          if (!out?.data || out.data.length < s * s * 4) return reject(new OidnFailed("Open Image Denoise answered with a picture of the wrong size"));
          const res = oidnCrop(out.data, s, w, h), blank = oidnBlankPatches(color, res, w, h);
          if (blank.length) return reject(new OidnFailed(`Open Image Denoise left ${blank.length} blank patch${blank.length === 1 ? "" : "es"}, the first at x ${blank[0].x}, row ${blank[0].y}`));
          resolve(res);
        },
      });
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

/** The patch size a denoised picture is checked in: well under oidn-web's smallest tile (256 px). */
export const OIDN_CHECK_PATCH = 32;

/** A pixel with light in it: its red + green + blue finite and above zero. */
const lit = (d: Float32Array, k: number) => { const v = d[k] + d[k + 1] + d[k + 2]; return v > 0 && v < Infinity; };

/**
 * The patches (OIDN_CHECK_PATCH square, in the pictures' own row order) where the input has light — at least a
 * tenth of its pixels lit — and the denoised picture is blank: under 1 % of its pixels lit (black, or not a
 * number). That is what a tile the denoiser lost looks like; a dark corner of a real picture is dark in its input
 * too, so it is never taken for one. Each patch's first pixel; empty when the result is whole.
 */
export function oidnBlankPatches(input: Float32Array, output: Float32Array, w: number, h: number, patch = OIDN_CHECK_PATCH): { x: number; y: number }[] {
  const bad: { x: number; y: number }[] = [];
  for (let y0 = 0; y0 < h; y0 += patch) {
    for (let x0 = 0; x0 < w; x0 += patch) {
      let total = 0, litIn = 0, litOut = 0;
      for (let y = y0; y < Math.min(h, y0 + patch); y++) {
        for (let x = x0; x < Math.min(w, x0 + patch); x++) {
          const k = (y * w + x) * 4;
          total++;
          if (lit(input, k)) litIn++;
          if (lit(output, k)) litOut++;
        }
      }
      if (litIn >= total * 0.1 && litOut < total * 0.01) bad.push({ x: x0, y: y0 });
    }
  }
  return bad;
}

/** The square the denoiser is given: the longer side, rounded up to 16. */
export const oidnSide = (w: number, h: number) => Math.ceil(Math.max(w, h) / 16) * 16;

/** RGBA pixels (row 0 first) copied into an s × s square, the last row and column repeated, each value through `f`. */
export function oidnPad(src: Float32Array, w: number, h: number, s: number, f: (v: number) => number): Float32Array {
  const out = new Float32Array(s * s * 4);
  for (let y = 0; y < s; y++) {
    const sy = Math.min(y, h - 1);
    for (let x = 0; x < s; x++) {
      const i = (sy * w + Math.min(x, w - 1)) * 4, o = (y * s + x) * 4;
      out[o] = f(src[i]); out[o + 1] = f(src[i + 1]); out[o + 2] = f(src[i + 2]); out[o + 3] = 1;
    }
  }
  return out;
}

/** The w × h picture back out of the square, alpha 1. */
export function oidnCrop(src: Float32Array, s: number, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    out.set(src.subarray(y * s * 4, (y * s + w) * 4), y * w * 4);
    for (let x = 0; x < w; x++) out[(y * w + x) * 4 + 3] = 1;
  }
  return out;
}
