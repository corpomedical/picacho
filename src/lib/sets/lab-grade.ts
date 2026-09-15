// THE LAB (Helios, 2026-09-15; drawn as the "Helios Lab" page and approved
// with "Build it"). The proof of the rig's looks (rig.ts, THE PROOF) showed
// what words cannot carry: asked for grain, a camcorder's smear, an
// anamorphic flare or a black-and-white print, GPT Image mostly drew a clean
// colour frame anyway. So those looks are HELD BY THE LAB: made here, on the
// finished pixels, after the still is cut to its frame lines — the film
// stock, the lens's character and Silver Print. A lab look always lands, is
// the same every time (the grain is a fixed seed) and costs nothing but a
// few passes over the picture: with decoding and encoding (lab.ts develop),
// 0.34 s for 35 mm and 0.78 s for 16 mm + vintage + black and white on a
// 1536 × 643 still, measured 2026-09-15; the print stays the size of an
// ungraded still (1.4–2.6 MB against 2.3 MB).
//
// What each look does, tuned by eye at full size on the proof stills:
//   35 mm      fine grain strongest in the midtones, a highlight shoulder, a little warmth
//   16 mm      softer detail, coarse grain, milky lifted blacks, less colour, a faint vignette
//   home video resolution roughly halved, chroma smeared and dragged right, washed colour, scanlines
//   vintage    a glow round the highlights, lower contrast, warm, dark soft corners
//   halation   a red-orange bloom just outside the brightest lights and backlit edges
//   anamorphic a thin blue flare streak from the brightest small lights (oval bokeh cannot be
//              made after a render, and is not claimed)
//   silver     a panchromatic black and white, rich blacks, silver highlights
// Digital and the clean prime are the model's own clean render: nothing to do.
//
// Pure pixel maths over RGB floats (lab.ts decodes, develops and encodes).
// Relative imports only: the tests load it as it is.

import type { RigLens, RigStock } from "./rig";

/** What the lab makes of one still (rig.ts labLooksOf); every field optional. */
export type LabLooks = { stock?: RigStock | null; lens?: RigLens | null; silver?: boolean };

export type Picture = { width: number; height: number; rgb: Float32Array };

const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export function fromBytes(width: number, height: number, bytes: Uint8Array): Picture {
  const rgb = new Float32Array(width * height * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = bytes[i] / 255;
  return { width, height, rgb };
}

export function toBytes(p: Picture): Uint8Array {
  const out = new Uint8Array(p.rgb.length);
  for (let i = 0; i < p.rgb.length; i++) out[i] = Math.round(clamp(p.rgb[i]) * 255);
  return out;
}

/** A fixed-seed generator: the same still gets the same grain every time. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One channel, box-blurred along rows then columns (radius in pixels; 0 skips a direction). */
function boxBlur(src: Float32Array, w: number, h: number, rx: number, ry: number): Float32Array {
  let a = src;
  if (rx > 0) {
    const out = new Float32Array(a.length);
    const n = 2 * rx + 1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let k = -rx; k <= rx; k++) sum += a[row + Math.min(w - 1, Math.max(0, k))];
      for (let x = 0; x < w; x++) {
        out[row + x] = sum / n;
        sum += a[row + Math.min(w - 1, x + rx + 1)] - a[row + Math.max(0, x - rx)];
      }
    }
    a = out;
  }
  if (ry > 0) {
    const out = new Float32Array(a.length);
    const n = 2 * ry + 1;
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -ry; k <= ry; k++) sum += a[Math.min(h - 1, Math.max(0, k)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = sum / n;
        sum += a[Math.min(h - 1, y + ry + 1) * w + x] - a[Math.max(0, y - ry) * w + x];
      }
    }
    a = out;
  }
  return a;
}

/**
 * Near-gaussian blur: three box passes whose widths are chosen for the sigma
 * (Kutskir's boxes-for-gauss), so a small sigma stays small — a width-1 box
 * is no pass at all.
 */
function blur(src: Float32Array, w: number, h: number, sx: number, sy: number): Float32Array {
  const radii = (s: number): number[] => {
    if (s <= 0) return [0, 0, 0];
    const ideal = Math.sqrt((12 * s * s) / 3 + 1);
    let wl = Math.floor(ideal);
    if (wl % 2 === 0) wl--;
    const wu = wl + 2;
    const m = Math.round((12 * s * s - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4));
    return [0, 1, 2].map((i) => ((i < m ? wl : wu) - 1) / 2);
  };
  const rx = radii(sx), ry = radii(sy);
  let a = src;
  for (let i = 0; i < 3; i++) if (rx[i] > 0 || ry[i] > 0) a = boxBlur(a, w, h, rx[i], ry[i]);
  return a;
}

function channel(p: Picture, c: number): Float32Array {
  const n = p.width * p.height;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = p.rgb[i * 3 + c];
  return out;
}

function lumaPlane(p: Picture): Float32Array {
  const n = p.width * p.height;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = luma(p.rgb[i * 3], p.rgb[i * 3 + 1], p.rgb[i * 3 + 2]);
  return out;
}

/** Pixels brighter than `from` (soft knee), as a 0–1 mask; `peak` reads each pixel's brightest channel instead of its luma. */
function highlights(p: Picture, from: number, peak = false): Float32Array {
  const y = lumaPlane(p);
  if (peak) for (let i = 0; i < y.length; i++) y[i] = Math.max(p.rgb[i * 3], p.rgb[i * 3 + 1], p.rgb[i * 3 + 2]);
  for (let i = 0; i < y.length; i++) y[i] = clamp((y[i] - from) / (1 - from));
  return y;
}

/** Add light: screen `glow` (one plane) tinted `tint` over the picture. */
function screenGlow(p: Picture, glow: Float32Array, tint: [number, number, number], amount: number) {
  for (let i = 0; i < glow.length; i++) {
    const g = glow[i] * amount;
    for (let c = 0; c < 3; c++) {
      const v = p.rgb[i * 3 + c];
      p.rgb[i * 3 + c] = 1 - (1 - v) * (1 - clamp(g * tint[c]));
    }
  }
}

/** Darken toward the corners: 1 at the centre, `edge` at the far corners. */
function vignette(p: Picture, edge: number) {
  const { width: w, height: h } = p;
  const cx = w / 2, cy = h / 2, rmax = Math.hypot(cx, cy);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy) / rmax;
      const f = 1 - (1 - edge) * Math.pow(Math.max(0, (d - 0.35) / 0.65), 1.8);
      const i = (y * w + x) * 3;
      p.rgb[i] *= f;
      p.rgb[i + 1] *= f;
      p.rgb[i + 2] *= f;
    }
  }
}

/** Per-pixel tone and colour: contrast round mid-grey, lifted blacks, a highlight shoulder, channel gains, saturation. */
function tone(p: Picture, o: { contrast?: number; lift?: number; shoulder?: number; gains?: [number, number, number]; saturation?: number }) {
  const k = o.contrast ?? 1, lift = o.lift ?? 0, sh = o.shoulder ?? 0, sat = o.saturation ?? 1;
  const [gr, gg, gb] = o.gains ?? [1, 1, 1];
  for (let i = 0; i < p.rgb.length; i += 3) {
    let r = p.rgb[i] * gr, g = p.rgb[i + 1] * gg, b = p.rgb[i + 2] * gb;
    const y = luma(r, g, b);
    r = y + (r - y) * sat;
    g = y + (g - y) * sat;
    b = y + (b - y) * sat;
    const f = (v: number) => {
      let t = 0.5 + (v - 0.5) * k;
      // A soft shoulder: highlights roll off instead of clipping.
      if (sh > 0 && t > 1 - sh) t = 1 - sh + sh * Math.tanh((t - (1 - sh)) / sh);
      return lift + t * (1 - lift);
    };
    p.rgb[i] = f(r);
    p.rgb[i + 1] = f(g);
    p.rgb[i + 2] = f(b);
  }
}

/** Monochrome grain, strongest in the midtones; `size` > 1 makes it coarser. */
function grain(p: Picture, amount: number, size: number, seed: number) {
  const { width: w, height: h } = p;
  const rand = mulberry32(seed);
  const gw = Math.ceil(w / size), gh = Math.ceil(h / size);
  let field: Float32Array = new Float32Array(gw * gh);
  for (let i = 0; i < field.length; i++) {
    // Sum of uniforms ≈ gaussian, zero mean, unit-ish spread.
    field[i] = (rand() + rand() + rand() + rand() - 2) * 1.2;
  }
  if (size > 1) field = blur(field, gw, gh, 0.6, 0.6);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = field[Math.min(gh - 1, Math.floor(y / size)) * gw + Math.min(gw - 1, Math.floor(x / size))];
      const i = (y * w + x) * 3;
      const l = luma(p.rgb[i], p.rgb[i + 1], p.rgb[i + 2]);
      const weight = amount * (0.35 + 2.6 * l * (1 - l));
      for (let c = 0; c < 3; c++) p.rgb[i + c] += n * weight;
    }
  }
}

function silverPrint(p: Picture) {
  for (let i = 0; i < p.rgb.length; i += 3) {
    // A panchromatic mix: skin and red paint read as light greys, sky a little darker.
    const v = 0.36 * p.rgb[i] + 0.52 * p.rgb[i + 1] + 0.12 * p.rgb[i + 2];
    p.rgb[i] = p.rgb[i + 1] = p.rgb[i + 2] = v;
  }
  tone(p, { contrast: 1.22, shoulder: 0.12 });
  // Silver: the faintest cool cast in the highlights only.
  for (let i = 0; i < p.rgb.length; i += 3) {
    const v = p.rgb[i];
    const s = Math.max(0, v - 0.6) * 0.04;
    p.rgb[i] = v - s;
    p.rgb[i + 2] = v + s;
  }
}

function homeVideo(p: Picture) {
  const { width: w, height: h } = p;
  // Soft analogue detail: the picture's resolution roughly halved, horizontally more than vertically.
  for (let c = 0; c < 3; c++) {
    const plane = blur(channel(p, c), w, h, 1.6, 0.9);
    for (let i = 0; i < plane.length; i++) p.rgb[i * 3 + c] = plane[i];
  }
  // Colour bleed: chroma smeared and dragged right, luma kept.
  const n = w * h;
  const Y = new Float32Array(n), Cb = new Float32Array(n), Cr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = p.rgb[i * 3], g = p.rgb[i * 3 + 1], b = p.rgb[i * 3 + 2];
    Y[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    Cb[i] = b - Y[i];
    Cr[i] = r - Y[i];
  }
  const shift = 4;
  const cb = blur(Cb, w, h, 5, 0), cr = blur(Cr, w, h, 5, 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, j = y * w + Math.max(0, x - shift);
      const yy = Y[i], bb = cb[j] + yy, rr = cr[j] + yy;
      const gg = (yy - 0.299 * rr - 0.114 * bb) / 0.587;
      p.rgb[i * 3] = rr;
      p.rgb[i * 3 + 1] = gg;
      p.rgb[i * 3 + 2] = bb;
    }
  }
  // Washed colour, lifted blacks, a little noise, and scanlines.
  tone(p, { contrast: 0.86, lift: 0.05, saturation: 0.78, gains: [1.02, 1, 0.97] });
  grain(p, 0.018, 1, 7);
  for (let y = 0; y < h; y++) {
    if (y % 3 !== 0) continue;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      p.rgb[i] *= 0.9;
      p.rgb[i + 1] *= 0.9;
      p.rgb[i + 2] *= 0.9;
    }
  }
}

function anamorphicFlare(p: Picture) {
  const { width: w, height: h } = p;
  // Only the brightest small lights throw a streak: the top of the range, less its broad surroundings.
  const hi = highlights(p, 0.9);
  const broad = blur(hi, w, h, 18, 18);
  for (let i = 0; i < hi.length; i++) hi[i] = clamp(hi[i] - broad[i] * 0.85);
  const streak = blur(hi, w, h, w * 0.12, 0.8);
  let peak = 0;
  for (let i = 0; i < streak.length; i++) peak = Math.max(peak, streak[i]);
  if (peak > 0) for (let i = 0; i < streak.length; i++) streak[i] /= peak;
  screenGlow(p, streak, [0.35, 0.62, 1], 0.6);
  // The wide-screen feel: a faint cool lift in the blacks.
  tone(p, { gains: [0.99, 1, 1.02], lift: 0.01 });
}

/**
 * Grade one picture with the rig's lab looks, in the order light meets them:
 * the lens (glow, halation, flare), the print (black and white), the stock
 * (tone, grain, the camcorder). Returns a new picture; the input is untouched.
 */
export function labGrade(input: Picture, looks: LabLooks): Picture {
  const p: Picture = { width: input.width, height: input.height, rgb: new Float32Array(input.rgb) };
  const { width: w, height: h } = p;
  switch (looks.lens) {
    case "vintage": {
      const glow = blur(highlights(p, 0.62), w, h, 14, 14);
      screenGlow(p, glow, [1, 0.92, 0.78], 0.55);
      tone(p, { contrast: 0.86, lift: 0.02, gains: [1.05, 1, 0.9], shoulder: 0.1 });
      vignette(p, 0.62);
      break;
    }
    case "halation": {
      // The red-orange bloom film carries round its brightest lights: strongest
      // just outside them, falling off over a dozen pixels.
      const hi = highlights(p, 0.78, true);
      const near = blur(hi, w, h, 4, 4), far = blur(hi, w, h, 14, 14);
      const halo = new Float32Array(hi.length);
      for (let i = 0; i < hi.length; i++) halo[i] = clamp(far[i] * 2.2 + near[i] * 0.8 - hi[i] * 0.6);
      screenGlow(p, halo, [1, 0.3, 0.08], 1);
      break;
    }
    case "anamorphic":
      anamorphicFlare(p);
      break;
    default:
      break;
  }
  if (looks.silver) silverPrint(p);
  switch (looks.stock) {
    case "film35":
      tone(p, { shoulder: 0.14, lift: 0.015, gains: [1.03, 1, 0.96] });
      grain(p, 0.035, 1, 35);
      break;
    case "film16":
      for (let c = 0; c < 3; c++) {
        const plane = blur(channel(p, c), w, h, 0.7, 0.7);
        for (let i = 0; i < plane.length; i++) p.rgb[i * 3 + c] = plane[i];
      }
      tone(p, { contrast: 0.9, lift: 0.06, shoulder: 0.16, saturation: 0.88, gains: [1.02, 1, 0.97] });
      grain(p, 0.075, 2.2, 16);
      vignette(p, 0.8);
      break;
    case "homevideo":
      homeVideo(p);
      break;
    default:
      break;
  }
  return p;
}
