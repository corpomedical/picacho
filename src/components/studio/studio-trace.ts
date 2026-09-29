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
 * Denoises linear HDR colour (RGBA floats) guided by albedo (0–1) and a
 * normal (−1…1), all the same size and row order. oidn-web 0.4.0 divides its
 * albedo and normal inputs by 255 (it expects bytes), so they are handed in
 * as floats already × 255: the network sees real 0–1 albedo and real −1…1
 * normals, not bytes squeezed into 0–1. The version is pinned for this.
 */
export function oidnDenoise(unet: Unet, color: Float32Array, albedo01: Float32Array, normal: Float32Array, w: number, h: number): Promise<Float32Array> {
  // oidn-web 0.4.0 cuts square tiles and reads past the picture's edge when a side is shorter than a tile (640 × 360
  // came back all NaN; 256 × 256 and 1280 × 720 were fine): the picture goes in as a square, edges repeated, and the
  // result is cut back out.
  const s = oidnSide(w, h), c = oidnPad(color, w, h, s, (v) => v), a = oidnPad(albedo01, w, h, s, (v) => Math.min(1, Math.max(0, v)) * 255), n = oidnPad(normal, w, h, s, (v) => Math.min(1, Math.max(-1, v)) * 255);
  return new Promise((resolve, reject) => {
    try {
      unet.tileExecute({
        color: { data: c, width: s, height: s },
        albedo: { data: a, width: s, height: s },
        normal: { data: n, width: s, height: s },
        done: (out: { data: Float32Array }) => resolve(oidnCrop(out.data, s, w, h)),
      });
    } catch (e) {
      reject(e);
    }
  });
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
