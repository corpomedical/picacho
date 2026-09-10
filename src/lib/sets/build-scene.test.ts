import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildSetScene, buildStandIn, fovForLens, lensForFov, nearestLens, placeStandIn } from "./build-scene";
import { normaliseSetSpec, specInstanceCount, type SetSpec } from "./set-spec";
import rainyMarket from "./fixtures-rainy-market.json";

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
    expect(built.fog?.near).toBe(spec.fog?.near);
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
