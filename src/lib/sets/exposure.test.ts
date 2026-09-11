import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  BASE_EXPOSURE,
  chooseExposure,
  chooseLift,
  fillBrightness,
  liftSet,
  MAX_EXPOSURE_LIFT,
  MAX_FILL_LIFT,
  measurePanoramaLuminance,
  NO_LIFT,
  TARGET_MEAN_LUMINANCE,
} from "./exposure";
import { normaliseSetSpec, type SetSpec } from "./set-spec";
import rainyMarket from "./fixtures-rainy-market.json";

// The exposure search, against brightness curves shaped like the real one:
// display brightness rises with exposure and saturates (tone mapping), and a
// darker set needs more lift for the same brightness.

const toneCurve = (scene: number) => (e: number) => 255 * (1 - Math.exp(-scene * e));

describe("chooseExposure", () => {
  it("leaves a bright set at its base exposure", () => {
    expect(chooseExposure(toneCurve(0.5))).toBe(BASE_EXPOSURE);
  });

  it("lifts a dark set until it reaches the target, within tolerance", () => {
    // Scenes the cap can bring to the target (0.03 cannot: 68 at the cap).
    for (const scene of [0.08, 0.05, 0.04]) {
      const measure = toneCurve(scene);
      const e = chooseExposure(measure);
      expect(e).toBeGreaterThan(BASE_EXPOSURE);
      expect(Math.abs(measure(e) - TARGET_MEAN_LUMINANCE)).toBeLessThanOrEqual(8);
    }
  });

  it("never lifts past the cap, however dark", () => {
    expect(chooseExposure(toneCurve(0.001))).toBe(BASE_EXPOSURE * MAX_EXPOSURE_LIFT);
  });

  it("never goes below the base, and falls back to it when brightness cannot be measured", () => {
    expect(chooseExposure(() => Number.NaN)).toBe(BASE_EXPOSURE);
    expect(chooseExposure(() => 255)).toBe(BASE_EXPOSURE);
  });

  it("keeps the base when a measurement fails partway through the search, never the untested cap", () => {
    for (const scene of [0.25, 0.08, 0.04]) {
      for (const failAt of [3, 4, 5]) {
        let calls = 0;
        const e = chooseExposure((x) => (++calls === failAt ? Number.NaN : toneCurve(scene)(x)));
        // A search that finished before that call never saw the failure.
        expect(e).toBe(calls >= failAt ? BASE_EXPOSURE : chooseExposure(toneCurve(scene)));
      }
      let calls = 0;
      expect(chooseExposure((x) => (++calls === 3 ? Number.NaN : toneCurve(scene)(x)))).toBe(BASE_EXPOSURE);
    }
  });

  it("measures a bounded number of times — each is eight small renders on the person's GPU", () => {
    let calls = 0;
    chooseExposure((e) => {
      calls += 1;
      return toneCurve(0.04)(e);
    });
    expect(calls).toBeLessThanOrEqual(8);
  });
});

// A set's brightness as fill and exposure change: what the fill lights add
// scales with the fill, what the lamps and the sky add does not.
const setCurve = (fillPart: number, rest: number) => (fill: number, e: number) =>
  255 * (1 - Math.exp(-(fillPart * fill + rest) * e));

describe("chooseLift", () => {
  it("leaves a bright set as built", () => {
    expect(chooseLift(setCurve(0.3, 0.3), { hasFill: true })).toEqual(NO_LIFT);
  });

  it("lifts an interior with fill light alone, leaving the exposure — and the lamps — as they were", () => {
    const measure = setCurve(0.02, 0.02);
    const lift = chooseLift(measure, { hasFill: true });
    expect(lift.exposure).toBe(BASE_EXPOSURE);
    expect(lift.fill).toBeGreaterThan(1);
    expect(lift.fill).toBeLessThan(MAX_FILL_LIFT);
    expect(Math.abs(measure(lift.fill, lift.exposure) - TARGET_MEAN_LUMINANCE)).toBeLessThanOrEqual(8);
  });

  it("makes up with exposure what the most fill cannot reach, as under a night sky", () => {
    const measure = setCurve(0.002, 0.02);
    const lift = chooseLift(measure, { hasFill: true });
    expect(lift.fill).toBe(MAX_FILL_LIFT);
    expect(lift.exposure).toBeGreaterThan(BASE_EXPOSURE);
    expect(Math.abs(measure(lift.fill, lift.exposure) - TARGET_MEAN_LUMINANCE)).toBeLessThanOrEqual(8);
  });

  it("lifts a set with no fill light by exposure alone", () => {
    const lift = chooseLift((_fill, e) => 255 * (1 - Math.exp(-0.03 * e)), { hasFill: false });
    expect(lift.fill).toBe(1);
    expect(lift.exposure).toBeGreaterThan(BASE_EXPOSURE);
  });

  it("leaves the set as built when a measurement fails at any step", () => {
    for (const curve of [setCurve(0.02, 0.02), setCurve(0.002, 0.02)]) {
      for (let failAt = 1; failAt <= 14; failAt++) {
        let calls = 0;
        const lift = chooseLift((f, e) => (++calls === failAt ? Number.NaN : curve(f, e)), { hasFill: true });
        // A search that finished before that call never saw the failure.
        if (calls >= failAt) expect(lift).toEqual(NO_LIFT);
      }
    }
  });

  it("measures a bounded number of times", () => {
    let calls = 0;
    const curve = setCurve(0.002, 0.02);
    chooseLift((f, e) => {
      calls += 1;
      return curve(f, e);
    }, { hasFill: true });
    expect(calls).toBeLessThanOrEqual(16);
  });
});

// The measurement itself needs a GPU; what it does with the pixels it reads
// back does not. A renderer that fills every readback with one colour stands
// in for it.
describe("measurePanoramaLuminance", () => {
  const spec = ((): SetSpec => {
    const r = normaliseSetSpec(rainyMarket);
    if (!r.ok) throw new Error("fixture");
    return r.spec;
  })();

  function renderer(pixel: [number, number, number, number], lost = false) {
    const r = {
      toneMappingExposure: 1.3,
      shadowMap: { autoUpdate: true, needsUpdate: false },
      getContext: () => ({
        RGBA: 0x1908,
        UNSIGNED_BYTE: 0x1401,
        isContextLost: () => lost,
        readPixels: (_x: number, _y: number, _w: number, _h: number, _f: number, _t: number, buf: Uint8Array) => {
          for (let i = 0; i < buf.length; i += 4) buf.set(pixel, i);
        },
      }),
      getPixelRatio: () => 2,
      viewport: null as THREE.Vector4 | null,
      getViewport: (v: THREE.Vector4) => v.set(0, 0, 800, 600),
      setViewport: (v: THREE.Vector4 | number) => {
        if (typeof v !== "number") r.viewport = v.clone();
      },
      render: () => {},
    };
    return r as unknown as THREE.WebGLRenderer & typeof r;
  }
  const measure = (r: THREE.WebGLRenderer, e: number) =>
    measurePanoramaLuminance(THREE, r, new THREE.Scene(), spec, 500, e);

  it("reads the mean display brightness of what was drawn", () => {
    expect(measure(renderer([100, 100, 100, 255]), 2)).toBeCloseTo(100, 5);
  });

  it("counts an empty readback as no measurement, so a GPU reset leaves the base exposure instead of lifting 8x", () => {
    // The canvas has no alpha channel: a real pixel reads back opaque.
    expect(measure(renderer([0, 0, 0, 0]), 2)).toBeNaN();
    expect(chooseExposure((e) => measure(renderer([0, 0, 0, 0]), e))).toBe(BASE_EXPOSURE);
    expect(measure(renderer([0, 0, 0, 255], true), 2)).toBeNaN();
  });

  it("gives the renderer back as it found it", () => {
    const r = renderer([0, 0, 0, 0]);
    measure(r, 7);
    expect(r.toneMappingExposure).toBe(1.3);
    expect(r.shadowMap.autoUpdate).toBe(true);
    expect(r.viewport?.toArray()).toEqual([0, 0, 800, 600]);
  });

  // liftSet's wiring: which light it adds, and what it leaves set.
  const litScene = () => {
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0x2040a0, 0.5));
    scene.add(new THREE.PointLight(0xffaa55, 30));
    return scene;
  };
  const liftFill = (scene: THREE.Scene) => scene.getObjectByName("lift-fill") as THREE.HemisphereLight;

  it("leaves a bright set as built, its added fill at zero", () => {
    const scene = litScene();
    const r = renderer([200, 200, 200, 255]);
    expect(liftSet(THREE, r, scene, spec, 500)).toEqual(NO_LIFT);
    expect(liftFill(scene).intensity).toBe(0);
    expect(r.toneMappingExposure).toBe(BASE_EXPOSURE);
  });

  it("adds neutral fill to a dark set without touching the set's own lights", () => {
    const scene = litScene();
    const own = fillBrightness(scene);
    const r = renderer([5, 5, 5, 255]);
    const lift = liftSet(THREE, r, scene, spec, 500);
    // A readback this dark at every step runs both searches to their caps.
    expect(lift).toEqual({ fill: MAX_FILL_LIFT, exposure: BASE_EXPOSURE * MAX_EXPOSURE_LIFT });
    // Neutral light, and together with the set's own fill exactly 16 times as bright.
    expect(liftFill(scene).color.getHexString()).toBe("ffffff");
    expect(fillBrightness(scene)).toBeCloseTo(own * MAX_FILL_LIFT, 5);
    expect((scene.children[0] as THREE.AmbientLight).intensity).toBe(0.5);
    expect((scene.children[1] as THREE.PointLight).intensity).toBe(30);
    expect(r.toneMappingExposure).toBe(BASE_EXPOSURE * MAX_EXPOSURE_LIFT);
  });

  it("leaves the set as built when the measurement cannot run", () => {
    const scene = litScene();
    const r = renderer([0, 0, 0, 0]);
    expect(liftSet(THREE, r, scene, spec, 500)).toEqual(NO_LIFT);
    expect(liftFill(scene).intensity).toBe(0);
    expect(r.toneMappingExposure).toBe(BASE_EXPOSURE);
  });

  it("measures how bright a set's own fill is, hemisphere averaged over sky and ground", () => {
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    scene.add(new THREE.HemisphereLight(0xffffff, 0x000000, 1));
    scene.add(new THREE.PointLight(0xffffff, 40));
    expect(fillBrightness(scene)).toBeCloseTo(1, 5);
  });
});
