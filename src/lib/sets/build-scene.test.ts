import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FULL_STAGE, buildSetScene, buildStandIn, fovForLens, lensForFov, moveBuildInto, nearestLens, placeStandIn, squeezeProjection } from "./build-scene";
import { normaliseSetSpec, specInstanceCount, type SetSpec } from "./set-spec";
import rainyMarket from "./fixtures-rainy-market.json";
import showroomOpen from "./fixtures-showroom-open.json";

// The fixed interpreter, run on three's core in node — no GPU needed to
// build a scene graph. The fixture is the first real Astra build.

const spec = (() => {
  const r = normaliseSetSpec(rainyMarket);
  if (!r.ok) throw new Error("fixture");
  return r.spec;
})();

describe("buildSetScene", () => {
  it("draws exactly the shapes the spec describes", () => {
    const built = buildSetScene(THREE, spec);
    expect(built.meshCount).toBe(specInstanceCount(spec));
    built.dispose();
  });

  it("adds one light object per spec light (plus targets for suns and spots)", () => {
    const built = buildSetScene(THREE, spec);
    const lights: THREE.Light[] = [];
    built.root.traverse((o) => {
      if ((o as THREE.Light).isLight) lights.push(o as THREE.Light);
    });
    expect(lights).toHaveLength(spec.lights.length);
    built.dispose();
  });

  it("draws a night sky as a dome, and a flat sky as a background colour", () => {
    const night = buildSetScene(THREE, spec);
    expect(spec.sky.kind).toBe("night");
    expect(night.background).toBeNull();
    expect(night.root.getObjectByName("sky")).toBeDefined();
    night.dispose();

    const flat = buildSetScene(THREE, { ...spec, sky: { kind: "color", colors: ["#aabbcc"] } });
    expect(flat.background?.getHexString()).toBe("aabbcc");
    expect(flat.root.getObjectByName("sky")).toBeUndefined();
    flat.dispose();
  });

  it("carries fog through, and sets the far plane past the sky", () => {
    const built = buildSetScene(THREE, spec);
    // A night set keeps Astra's near and far (linear fog) on both stages.
    expect((built.fog as THREE.Fog).near).toBe(spec.fog?.near);
    const sky = built.root.getObjectByName("sky") as THREE.Mesh;
    const radius = (sky.geometry as THREE.SphereGeometry).parameters.radius;
    expect(built.farPlane).toBeGreaterThan(radius);
    built.dispose();
  });

  it("places repeats along their offset", () => {
    const s: SetSpec = {
      ...spec,
      objects: [{ ...spec.objects[0], position: [1, 2, 3], repeat: { count: 3, offset: [2, 0, -1] } }],
    };
    const built = buildSetScene(THREE, s);
    const meshes = built.root.children.filter((c) => (c as THREE.Mesh).isMesh && c.name === "");
    expect(meshes.map((m) => m.position.toArray())).toEqual([
      [1, 2, 3],
      [3, 2, 2],
      [5, 2, 1],
    ]);
    built.dispose();
  });

  it("casts shadows only when asked, from one sun at most", () => {
    const twoSuns: SetSpec = {
      ...spec,
      lights: [
        { kind: "sun", color: "#ffffff", intensity: 2, position: [5, 10, 5], target: [0, 0, 0], groundColor: null, angleDeg: 30, distance: 0 },
        { kind: "sun", color: "#ffffff", intensity: 1, position: [-5, 10, 5], target: [0, 0, 0], groundColor: null, angleDeg: 30, distance: 0 },
      ],
    };
    const lit = buildSetScene(THREE, twoSuns, { shadows: true });
    const casters: THREE.Object3D[] = [];
    lit.root.traverse((o) => {
      if ((o as THREE.DirectionalLight).isDirectionalLight && o.castShadow) casters.push(o);
    });
    expect(casters).toHaveLength(1);
    lit.dispose();

    const unlit = buildSetScene(THREE, twoSuns);
    let any = false;
    unlit.root.traverse((o) => {
      if (o.castShadow) any = true;
    });
    expect(any).toBe(false);
    unlit.dispose();
  });
});

describe("the sun's shadows", () => {
  it("reach the set wherever the model put the sun, keeping its direction", () => {
    const farSun: SetSpec = {
      ...spec,
      bounds: { x: 30, z: 30, height: 12 },
      lights: [
        { kind: "sun", color: "#ffffff", intensity: 2, position: [100, 200, 100], target: [0, 0, 0], groundColor: null, angleDeg: 30, distance: 0 },
      ],
    };
    const built = buildSetScene(THREE, farSun, { shadows: true });
    let sun: THREE.DirectionalLight | null = null;
    built.root.traverse((o) => {
      if ((o as THREE.DirectionalLight).isDirectionalLight) sun = o as THREE.DirectionalLight;
    });
    const light = sun as unknown as THREE.DirectionalLight;
    const toTarget = light.position.clone().sub(light.target.position);
    // Same direction as the model's...
    expect(toTarget.clone().normalize().toArray().map((v) => +v.toFixed(4))).toEqual(
      new THREE.Vector3(100, 200, 100).normalize().toArray().map((v) => +v.toFixed(4)),
    );
    // ...and the far corner of the set's footprint sits inside the shadow camera.
    const corner = new THREE.Vector3(15, 0, 15).sub(light.position).length();
    expect(corner).toBeLessThan(light.shadow.camera.far);
    built.dispose();
  });
});

describe("rebuilding a live set in place (moveBuildInto)", () => {
  const lightsIn = (root: THREE.Object3D) => {
    let n = 0;
    root.traverse((o) => {
      if ((o as THREE.Light).isLight) n++;
    });
    return n;
  };

  it("leaves only the newest build in the root, however many rebuilds ran", () => {
    // The stage's order (set-view.tsx rebuild): the build it started with,
    // then each rebuild frees the last one and moves the fresh one in.
    const live = buildSetScene(THREE, spec);
    const root = live.root;
    let disposeLive = () => live.dispose();
    const darker: SetSpec = { ...spec, lights: spec.lights.slice(0, 1) };
    for (const next of [spec, darker, spec, darker]) {
      const fresh = buildSetScene(THREE, next);
      const count = fresh.root.children.length;
      disposeLive();
      disposeLive = moveBuildInto(root, fresh);
      expect(root.children).toHaveLength(count);
      expect(lightsIn(root)).toBe(next.lights.length);
    }
    disposeLive();
  });
});

describe("the stand-in", () => {
  it("is 1.75 m tall and faces +Z at 0°", () => {
    const s = buildStandIn(THREE, "#c8923a");
    s.helpers.visible = false;
    const box = new THREE.Box3().setFromObject(s.figure);
    expect(box.max.y).toBeCloseTo(1.75, 1);
    expect(box.min.y).toBeCloseTo(0, 2);
    // The feet reach further forward than back: the silhouette has a front.
    expect(box.max.z).toBeGreaterThan(-box.min.z);
    s.dispose();
  });

  it("turns with the mark: 90° faces +X", () => {
    const s = buildStandIn(THREE, "#c8923a");
    placeStandIn(s, { x: 2, z: -1, facingDeg: 90 });
    s.group.updateMatrixWorld(true);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(s.group.quaternion);
    expect(forward.x).toBeCloseTo(1, 5);
    expect(s.group.position.toArray()).toEqual([2, 0, -1]);
    s.dispose();
  });
});

describe("lenses", () => {
  it("round-trips millimetres and field of view (full-frame, 24 mm high)", () => {
    for (const mm of [18, 35, 85]) expect(lensForFov(fovForLens(mm))).toBeCloseTo(mm, 6);
    expect(fovForLens(50)).toBeCloseTo(26.99, 1);
    expect(nearestLens(40)).toBe(35);
  });
});

describe("the full stage", () => {
  // Canvas page J, cut 1 (2026-09-17): physical materials from each thing's
  // word, the sun's balance against the sky, soft shadows from the lamps.
  // In node there is no Sky and no renderer, so no environment: the gradient
  // dome stays and the fill keeps its own intensity.
  const showroom = (() => {
    const r = normaliseSetSpec(showroomOpen);
    if (!r.ok) throw new Error("fixture");
    return r.spec;
  })();

  it("draws every thing in a physical material carrying its word, and the basic stage in a standard one", () => {
    const full = buildSetScene(THREE, spec, { quality: "full" });
    const words = new Set<string>();
    for (const c of full.root.children) {
      const m = c as THREE.Mesh;
      if (!m.isMesh || m.name === "sky" || m.name === "ground") continue;
      const mat = m.material as THREE.MeshPhysicalMaterial;
      expect(mat.isMeshPhysicalMaterial).toBe(true);
      words.add(mat.userData.material);
    }
    expect(words.has("brick")).toBe(true);
    expect(words.has("water")).toBe(true);
    const ground = full.root.getObjectByName("ground") as THREE.Mesh;
    expect((ground.material as THREE.MeshPhysicalMaterial).userData.material).toBe("cobbles");
    expect(full.quality).toBe("full");
    expect(full.environment).toBeNull();
    full.dispose();

    const basic = buildSetScene(THREE, spec);
    for (const c of basic.root.children) {
      const m = c as THREE.Mesh;
      if (!m.isMesh || m.name === "sky") continue;
      expect((m.material as THREE.Material).type).toBe("MeshStandardMaterial");
    }
    expect(basic.quality).toBe("basic");
    basic.dispose();
  });

  it("turns the sun up by FULL_STAGE.sunGain, with a bigger, softer shadow, and leaves the fill alone without a sky", () => {
    const sunLit: SetSpec = {
      ...spec,
      sky: { kind: "gradient", colors: ["#8fb3d9", "#e8e2d6"] },
      lights: [
        { kind: "sun", color: "#ffffff", intensity: 2, position: [5, 10, 5], target: [0, 0, 0], groundColor: null, angleDeg: 30, distance: 0 },
        { kind: "hemisphere", color: "#ffffff", intensity: 1, position: [0, 0, 0], target: [0, 0, 0], groundColor: "#808080", angleDeg: 30, distance: 0 },
      ],
    };
    const full = buildSetScene(THREE, sunLit, { shadows: true, quality: "full" });
    let sun: THREE.DirectionalLight | null = null;
    let fill: THREE.HemisphereLight | null = null;
    full.root.traverse((o) => {
      if ((o as THREE.DirectionalLight).isDirectionalLight) sun = o as THREE.DirectionalLight;
      if ((o as THREE.HemisphereLight).isHemisphereLight) fill = o as THREE.HemisphereLight;
    });
    const s = sun as unknown as THREE.DirectionalLight;
    const f = fill as unknown as THREE.HemisphereLight;
    expect(s.intensity).toBeCloseTo(2 * FULL_STAGE.sunGain, 6);
    expect(s.shadow.mapSize.x).toBe(FULL_STAGE.sunShadowMap);
    expect(s.shadow.radius).toBe(2);
    expect(f.intensity).toBe(1);
    full.dispose();

    const basic = buildSetScene(THREE, sunLit, { shadows: true });
    let sun2: THREE.DirectionalLight | null = null;
    basic.root.traverse((o) => {
      if ((o as THREE.DirectionalLight).isDirectionalLight) sun2 = o as THREE.DirectionalLight;
    });
    const s2 = sun2 as unknown as THREE.DirectionalLight;
    expect(s2.intensity).toBe(2);
    expect(s2.shadow.mapSize.x).toBe(2048);
    basic.dispose();
  });

  it("lets the first two spots and the first two bulbs cast shadows, and no more", () => {
    const lamps: SetSpec = {
      ...showroom,
      lights: [
        ...showroom.lights,
        { kind: "spot", color: "#ffffff", intensity: 10, position: [0, 5, 0], target: [0, 0, 0], groundColor: null, angleDeg: 30, distance: 10 },
        { kind: "point", color: "#ffffff", intensity: 10, position: [1, 3, 0], target: [0, 0, 0], groundColor: null, angleDeg: 30, distance: 10 },
        { kind: "point", color: "#ffffff", intensity: 10, position: [2, 3, 0], target: [0, 0, 0], groundColor: null, angleDeg: 30, distance: 10 },
        { kind: "point", color: "#ffffff", intensity: 10, position: [3, 3, 0], target: [0, 0, 0], groundColor: null, angleDeg: 30, distance: 10 },
      ],
    };
    expect(lamps.lights.filter((l) => l.kind === "spot")).toHaveLength(3);
    const full = buildSetScene(THREE, lamps, { shadows: true, quality: "full" });
    let spots = 0;
    let points = 0;
    full.root.traverse((o) => {
      if ((o as THREE.SpotLight).isSpotLight && o.castShadow) spots += 1;
      if ((o as THREE.PointLight).isPointLight && o.castShadow) points += 1;
    });
    expect(spots).toBe(FULL_STAGE.maxSpotShadows);
    expect(points).toBe(FULL_STAGE.maxPointShadows);
    full.dispose();

    const basic = buildSetScene(THREE, lamps, { shadows: true });
    let any = 0;
    basic.root.traverse((o) => {
      if (((o as THREE.SpotLight).isSpotLight || (o as THREE.PointLight).isPointLight) && o.castShadow) any += 1;
    });
    expect(any).toBe(0);
    basic.dispose();
  });

  it("thins daylight fog with distance, and keeps a night set's fog as written", () => {
    const day = buildSetScene(THREE, { ...showroom, fog: { color: "#bac7d1", near: 110, far: 280 } }, { quality: "full" });
    expect((day.fog as THREE.FogExp2).isFogExp2).toBe(true);
    expect((day.fog as THREE.FogExp2).density).toBeCloseTo(FULL_STAGE.fogDensityOverFar / 280, 9);
    day.dispose();
    const dark = buildSetScene(THREE, spec, { quality: "full" });
    expect((dark.fog as THREE.Fog).isFog).toBe(true);
    expect((dark.fog as THREE.Fog).near).toBe(spec.fog?.near);
    dark.dispose();
  });
});

describe("the lens on a sensor (the camera department, cut 2)", () => {
  it("sees less on a smaller sensor and more on a larger one, and reads back as the same lens", () => {
    const full = fovForLens(35);
    const s35 = fovForLens(35, 18.7);
    const large = fovForLens(35, 25.5);
    expect(full).toBeCloseTo(37.85, 1);
    expect(s35).toBeLessThan(full);
    expect(large).toBeGreaterThan(full);
    expect(lensForFov(s35, 18.7)).toBeCloseTo(35, 9);
    expect(nearestLens(s35, 18.7)).toBe(35);
    // Read as full frame, the same field of view is a longer lens.
    expect(nearestLens(s35)).toBe(50);
  });

  it("squeezes the projection: the same frame sees wider, and the inverse follows", () => {
    const cam = new THREE.PerspectiveCamera(40, 1.5, 0.1, 100);
    cam.updateProjectionMatrix();
    const x0 = cam.projectionMatrix.elements[0];
    squeezeProjection(cam, 2);
    expect(cam.projectionMatrix.elements[0]).toBeCloseTo(x0 / 2, 9);
    const check = cam.projectionMatrix.clone().multiply(cam.projectionMatrixInverse);
    for (let i = 0; i < 16; i++) expect(check.elements[i]).toBeCloseTo(i % 5 === 0 ? 1 : 0, 6);
    const plain = new THREE.PerspectiveCamera(40, 1.5, 0.1, 100);
    plain.updateProjectionMatrix();
    squeezeProjection(plain, 1);
    expect(plain.projectionMatrix.elements[0]).toBeCloseTo(x0, 9);
  });
});
