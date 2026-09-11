// Lifting a dark Set so it can be seen: fill light first, then exposure
// (Astra Sets, 2026-09-11).
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
// The lift is chosen once per set from what the set actually looks like:
// the eye-height panorama from its first mark is measured and brightened
// until its mean reaches a target. Neutral fill light is added first, until
// the fill totals up to 16 times the set's own, and only what fill cannot
// reach — a night sky filling half the view, a set with no fill light at
// all — is made up by exposure. The set is measured without the grey figure
// (set-view.tsx): the lift belongs to the set, not to where the figure was
// left. The first version lifted by exposure alone, like a camera
// (8c9fb44), and exposure scales the lamps with the shadows: on the podcast
// studio the lamp-lit table went white and the walnut pale peach while the
// far walls stayed dark. Fill lifts the shadows and barely touches what a
// lamp already lights, as a gaffer's would. Blind-judged on eight dark sets
// (docs/ASTRA_SETS.md): this beat exposure alone 12 to 0.
//
// Once per SET, not per view, so every sketch, snapshot and thumbnail of one
// set shares one lift and the stills shot in it stay comparable. It only
// ever raises: a set bright enough already is left as built. The mood the
// darkness carried is not lost — the set's description, which rides every
// shot, still says night, and the shot prompt says the sketch is lit
// brighter than the scene (set-shot-prompt.ts).
//
// The searches are pure (they take a function that measures brightness) so
// they are tested without a GPU; the browser supplies the real measurement
// (set-view.tsx; liftSet and measurePanoramaLuminance below).
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

/** Never raise a set's fill light more than this many times what Astra wrote. */
export const MAX_FILL_LIFT = 16;

export type SetLift = { fill: number; exposure: number };
export const NO_LIFT: SetLift = { fill: 1, exposure: BASE_EXPOSURE };

/**
 * How a dark set is lifted: fill light first, exposure only for what fill
 * cannot reach. `measure(fill, exposure)` returns mean display brightness,
 * 0–255, with the set's fill lights at `fill` times what Astra wrote;
 * `hasFill` is false for a set with no fill light to raise. A measurement
 * that cannot run, at any step, leaves the set as built.
 */
export function chooseLift(
  measure: (fill: number, exposure: number) => number,
  opts: { hasFill: boolean },
): SetLift {
  let failed = false;
  const m = (fill: number, exposure: number) => {
    const v = measure(fill, exposure);
    if (!Number.isFinite(v)) failed = true;
    return v;
  };
  const fill = opts.hasFill ? chooseExposure((k) => m(k, BASE_EXPOSURE), { base: 1, maxLift: MAX_FILL_LIFT }) : 1;
  if (failed) return NO_LIFT;
  // Fill that reached the target leaves the exposure alone. Only a set the
  // most fill cannot bring up — a night sky fills the view, or there is no
  // fill light at all — has the rest made up by exposure.
  if (opts.hasFill && fill < MAX_FILL_LIFT) return { fill, exposure: BASE_EXPOSURE };
  const exposure = chooseExposure((e) => m(fill, e));
  if (failed) return NO_LIFT;
  return { fill, exposure };
}

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

/** The fill a lift adds: white from above, a little less from below, so a box keeps a top and sides. */
const NEUTRAL_FILL_SKY = 0xffffff;
const NEUTRAL_FILL_GROUND = 0xc0c0c0;

const luminance = (c: ThreeNS.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/** How bright the set's own fill lights are together: ambient, and hemisphere averaged over sky and ground. */
export function fillBrightness(root: ThreeNS.Object3D): number {
  let total = 0;
  root.traverse((o) => {
    const hemi = o as ThreeNS.HemisphereLight;
    const ambient = o as ThreeNS.AmbientLight;
    if (hemi.isHemisphereLight) total += (hemi.intensity * (luminance(hemi.color) + luminance(hemi.groundColor))) / 2;
    else if (ambient.isAmbientLight) total += ambient.intensity * luminance(ambient.color);
  });
  return total;
}

/**
 * Lift a dark set in the browser: measure it, choose (chooseLift), and leave
 * the scene and the renderer at the choice, which is returned. On any
 * failure the set is left as built.
 *
 * Fill is ADDED, not turned up. Astra tints its fill with the scene's own
 * palette — deep blue on a night rooftop — and turning that up sixteenfold
 * turned stone lavender, paving navy and brick mauve (blind-judged,
 * 2026-09-11). The set keeps its own fill as written; the lift adds neutral
 * light of `fill − 1` times its brightness, so what is lifted shows its own
 * colour. The light is added before anything is measured and stays, at zero
 * on a set bright enough already: adding or removing a light later would
 * recompile every material in the set.
 */
export function liftSet(
  THREE: Three,
  renderer: ThreeNS.WebGLRenderer,
  scene: ThreeNS.Scene,
  spec: SetSpec,
  farPlane: number,
): SetLift {
  const own = fillBrightness(scene);
  const neutral = new THREE.HemisphereLight(NEUTRAL_FILL_SKY, NEUTRAL_FILL_GROUND, 0);
  neutral.name = "lift-fill";
  const perStep = own / ((luminance(neutral.color) + luminance(neutral.groundColor)) / 2);
  const setFill = (k: number) => {
    neutral.intensity = (k - 1) * perStep;
  };
  scene.add(neutral);
  let lift = NO_LIFT;
  try {
    lift = chooseLift(
      (fill, exposure) => {
        setFill(fill);
        return measurePanoramaLuminance(THREE, renderer, scene, spec, farPlane, exposure);
      },
      { hasFill: own > 0 },
    );
  } finally {
    setFill(lift.fill);
    renderer.toneMappingExposure = lift.exposure;
  }
  return lift;
}
