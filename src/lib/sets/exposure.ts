// One exposure per Set, like a camera's (Astra Sets, 2026-09-11).
//
// Night and interior sets rendered near-black from most directions — 89% of
// an eye-height panorama in a forest at dusk, 77% on a rooftop at night, up
// to 65% in a podcast studio — because three.js lights physically: fill
// light reaches a surface divided by π, and Astra writes fill intensities on
// the old artist-friendly scale, then tints them with the scene's own dark
// palette. Daylit sets hide it (the sun dominates); sets lit by fill and a
// few lamps collapse. A sketch that is black in most directions shows the
// image model nothing there, and a person cannot arrange what they cannot
// see.
//
// The fix is exposure, chosen once per set from what the set actually looks
// like: its eye-height panorama from the first mark is measured and the
// exposure raised until its mean brightness reaches a target. Once per SET,
// not per view, so every sketch, snapshot and thumbnail of one set shares
// one exposure and the stills shot in it stay comparable. It only ever
// raises: a set bright enough already keeps its base exposure. The mood the
// darkness carried is not lost — the set's description, which rides every
// shot, still says night, and the shot prompt says the sketch's brightness
// is not the scene's (set-shot-prompt.ts).
//
// The search is pure (it takes a function that measures brightness at an
// exposure) so it is tested without a GPU; the browser supplies the real
// measurement (set-view.tsx, measurePanoramaLuminance below).
//
// Relative imports only: tested without the "@/" alias.

import type * as ThreeNS from "three";
import type { SetSpec } from "./set-spec";

type Three = typeof ThreeNS;

/** The viewer's exposure before any lift (set-view.tsx). */
export const BASE_EXPOSURE = 1.3;
/** Never brighten a set more than this many times its base exposure. */
export const MAX_EXPOSURE_LIFT = 8;
/** Mean display brightness (0–255) of the first mark's panorama to reach. */
export const TARGET_MEAN_LUMINANCE = 80;
const TOLERANCE = 6;
/** Measurements after the two bracketing ones; each is eight small renders. */
const MAX_STEPS = 5;

/**
 * The exposure for a set: the base when bright enough, otherwise the
 * smallest lift (up to MAX_EXPOSURE_LIFT) that brings the measured mean to
 * the target. `measure(exposure)` returns mean display brightness, 0–255,
 * and must rise with exposure.
 */
export function chooseExposure(
  measure: (exposure: number) => number,
  opts: { base?: number; target?: number; maxLift?: number } = {},
): number {
  const base = opts.base ?? BASE_EXPOSURE;
  const target = opts.target ?? TARGET_MEAN_LUMINANCE;
  const max = base * (opts.maxLift ?? MAX_EXPOSURE_LIFT);

  const atBase = measure(base);
  if (!Number.isFinite(atBase) || atBase >= target - TOLERANCE) return base;
  const atMax = measure(max);
  if (!Number.isFinite(atMax)) return base;
  if (atMax <= target) return max;

  // False position in log-exposure, falling back to halving when the guess
  // hugs an end. Brightness after tone mapping is smooth and rising, so
  // interpolating between the two bracketing measurements lands close in a
  // step or two where plain halving took six and still missed.
  let lo = base;
  let mLo = atBase;
  let hi = max;
  let mHi = atMax;
  let best = { e: max, err: Math.abs(atMax - target) };
  for (let i = 0; i < MAX_STEPS; i++) {
    const llo = Math.log(lo);
    const lhi = Math.log(hi);
    let frac = (target - mLo) / (mHi - mLo);
    if (!(frac > 0.05 && frac < 0.95)) frac = 0.5;
    const mid = Math.exp(llo + frac * (lhi - llo));
    const m = measure(mid);
    // A measurement that cannot run leaves the base, here as before the
    // search: the best so far may be the untested cap, 8× too bright.
    if (!Number.isFinite(m)) return base;
    const err = Math.abs(m - target);
    if (err < best.err) best = { e: mid, err };
    if (err <= TOLERANCE) break;
    if (m < target) {
      lo = mid;
      mLo = m;
    } else {
      hi = mid;
      mHi = m;
    }
  }
  return round(Math.max(base, Math.min(max, best.e)));
}

const round = (e: number) => Math.round(e * 100) / 100;

/**
 * Mean display brightness (0–255) of the first mark's eye-height panorama:
 * eight directions, rendered small through the real renderer — its tone
 * mapping and colour space included — and read back. Browser only: it needs
 * a WebGL context. Leaves the renderer's viewport and exposure as it found
 * them; the frames it draws are overwritten before the page shows anything.
 */
export function measurePanoramaLuminance(
  THREE: Three,
  renderer: ThreeNS.WebGLRenderer,
  scene: ThreeNS.Scene,
  spec: SetSpec,
  farPlane: number,
  exposure: number,
  sizePx = 32,
): number {
  const gl = renderer.getContext();
  const pr = renderer.getPixelRatio();
  const px = Math.max(1, Math.floor(sizePx * pr));
  const prevViewport = new THREE.Vector4();
  renderer.getViewport(prevViewport);
  const prevExposure = renderer.toneMappingExposure;
  const prevShadowAuto = renderer.shadowMap.autoUpdate;
  const cam = new THREE.PerspectiveCamera(60, 1, 0.05, farPlane);
  const mark = spec.marks[0];
  const buf = new Uint8Array(px * px * 4);
  let sum = 0;
  let n = 0;
  try {
    renderer.toneMappingExposure = exposure;
    renderer.setViewport(0, 0, sizePx, sizePx);
    // The shadows do not move between these frames: draw them once, not
    // for every one of up to 64 small renders.
    renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, cam);
    renderer.shadowMap.autoUpdate = false;
    for (let i = 0; i < 8; i++) {
      const b = (i * Math.PI) / 4;
      cam.position.set(mark.x, 1.6, mark.z);
      cam.lookAt(mark.x + Math.sin(b) * 10, 1.6, mark.z + Math.cos(b) * 10);
      renderer.render(scene, cam);
      // The drawing buffer's origin is bottom-left; the viewport sits there.
      gl.readPixels(0, 0, px, px, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      // Everything a set draws is opaque — the renderer clears to alpha 1
      // (three.js does, unless created with alpha: true) and every surface
      // writes alpha 1 — so a real readback has alpha 255. Zero alpha means
      // nothing was read (the GPU reset mid-measurement) and must not read
      // as "very dark", which would lift a daylit set 8×.
      if (buf[3] === 0 || gl.isContextLost()) return Number.NaN;
      for (let p = 0; p < buf.length; p += 16) {
        sum += 0.2126 * buf[p] + 0.7152 * buf[p + 1] + 0.0722 * buf[p + 2];
        n += 1;
      }
    }
  } finally {
    renderer.shadowMap.autoUpdate = prevShadowAuto;
    renderer.toneMappingExposure = prevExposure;
    // getViewport reports CSS pixels, the unit setViewport takes.
    renderer.setViewport(prevViewport);
  }
  return n > 0 ? sum / n : Number.NaN;
}
