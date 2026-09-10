// The fixed interpreter (Astra Sets, 2026-09-10): a normalised SetSpec in,
// three.js objects out. The ONLY code that ever turns a Set into something
// drawn — the model's output is data read by this, never code run by the
// page.
//
// three.js is passed in rather than imported: the page loads it dynamically
// (~600 KB only the Sets and Stage routes need), and the node test hands in
// three's core, which builds scenes fine without a GPU.
//
// Everything here assumes its input came through normaliseSetSpec — the
// counts, sizes and colours are already inside their bounds.

import type * as ThreeNS from "three";
import type { SetLight, SetObject, SetSpec, Vec3 } from "./set-spec";

type Three = typeof ThreeNS;

export type BuiltSet = {
  /** Everything the set draws; add it to a scene. */
  root: ThreeNS.Group;
  /** For scene.background — null when a sky dome is drawn instead. */
  background: ThreeNS.Color | null;
  fog: ThreeNS.Fog | null;
  /** Far enough for the camera to see the sky dome. */
  farPlane: number;
  meshCount: number;
  dispose(): void;
};

const DEG = Math.PI / 180;

export function buildSetScene(THREE: Three, spec: SetSpec, opts: { shadows?: boolean } = {}): BuiltSet {
  const shadows = opts.shadows === true;
  const root = new THREE.Group();
  root.name = "set";
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  const span = Math.max(spec.bounds.x, spec.bounds.z, spec.bounds.height);
  const domeRadius = Math.max(150, span * 4);

  // --- sky ---
  let background: ThreeNS.Color | null = null;
  if (spec.sky.kind === "color") {
    background = new THREE.Color(spec.sky.colors[0]);
  } else {
    const top = new THREE.Color(spec.sky.colors[0]);
    const horizon = new THREE.Color(spec.sky.colors[1] ?? spec.sky.colors[0]);
    const geo = track(new THREE.SphereGeometry(domeRadius, 32, 16));
    const pos = geo.getAttribute("position");
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, pos.getY(i) / domeRadius);
      c.copy(horizon).lerp(top, Math.pow(t, 0.6));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = track(
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }),
    );
    const dome = new THREE.Mesh(geo, mat);
    dome.name = "sky";
    dome.renderOrder = -1;
    root.add(dome);
  }

  const fog = spec.fog ? new THREE.Fog(new THREE.Color(spec.fog.color), spec.fog.near, spec.fog.far) : null;

  // --- ground: wider than the set, so no camera inside the bounds sees its edge ---
  {
    const size = groundHalfExtent(spec) * 2;
    const geo = track(new THREE.PlaneGeometry(size, size));
    geo.rotateX(-Math.PI / 2);
    const mat = track(
      new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.ground.color), roughness: spec.ground.roughness }),
    );
    const ground = new THREE.Mesh(geo, mat);
    ground.name = "ground";
    ground.receiveShadow = shadows;
    root.add(ground);
  }

  // --- lights ---
  let shadowCaster = false;
  for (const light of spec.lights) {
    const built = makeLight(THREE, light, spec, shadows && !shadowCaster && light.kind === "sun");
    if (built.castsShadow) shadowCaster = true;
    for (const o of built.objects) root.add(o);
  }

  // --- objects ---
  const geometries = new Map<string, ThreeNS.BufferGeometry>();
  const materials = new Map<string, ThreeNS.MeshStandardMaterial>();
  const geometryFor = (o: SetObject): ThreeNS.BufferGeometry => {
    // A torus's ring and tube are independent sizes, so it is built at its
    // real dimensions; every other shape is a unit shape scaled per mesh.
    const key = o.shape === "torus" ? `torus:${o.size[0].toFixed(3)}:${o.size[1].toFixed(3)}` : o.shape;
    const hit = geometries.get(key);
    if (hit) return hit;
    const geo = track(unitGeometry(THREE, o));
    geometries.set(key, geo);
    return geo;
  };
  const materialFor = (o: SetObject): ThreeNS.MeshStandardMaterial => {
    const key = [o.color, o.roughness, o.metalness, o.emissive ?? "", o.emissiveIntensity, o.shape === "plane"].join("|");
    const hit = materials.get(key);
    if (hit) return hit;
    const mat = track(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(o.color),
        roughness: o.roughness,
        metalness: o.metalness,
        emissive: new THREE.Color(o.emissive ?? "#000000"),
        emissiveIntensity: o.emissive ? o.emissiveIntensity : 0,
        side: o.shape === "plane" ? THREE.DoubleSide : THREE.FrontSide,
      }),
    );
    materials.set(key, mat);
    return mat;
  };

  let meshCount = 0;
  for (const o of spec.objects) {
    const geo = geometryFor(o);
    const mat = materialFor(o);
    const count = o.repeat?.count ?? 1;
    const step: Vec3 = o.repeat?.offset ?? [0, 0, 0];
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(o.position[0] + step[0] * i, o.position[1] + step[1] * i, o.position[2] + step[2] * i);
      // A plane on the ground would flicker against it.
      if (o.shape === "plane" && Math.abs(mesh.position.y) < 0.01) mesh.position.y = 0.01;
      mesh.rotation.set(o.rotation[0] * DEG, o.rotation[1] * DEG, o.rotation[2] * DEG, "XYZ");
      mesh.scale.copy(unitScale(o));
      mesh.castShadow = shadows && o.castShadow;
      mesh.receiveShadow = shadows;
      root.add(mesh);
      meshCount += 1;
    }
  }

  return {
    root,
    background,
    fog,
    farPlane: domeRadius * 2.2,
    meshCount,
    dispose() {
      for (const d of disposables) d.dispose();
      root.clear();
    },
  };
}

/** Half the width of the interpreter's own floor (closure.ts measures against it). */
export function groundHalfExtent(spec: SetSpec): number {
  return Math.max(spec.bounds.x, spec.bounds.z) * 3;
}

function unitGeometry(THREE: Three, o: SetObject): ThreeNS.BufferGeometry {
  switch (o.shape) {
    case "box":
      return new THREE.BoxGeometry(1, 1, 1);
    case "cylinder":
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
    case "cone":
      return new THREE.ConeGeometry(0.5, 1, 24);
    case "sphere":
      return new THREE.SphereGeometry(0.5, 24, 16);
    case "capsule":
      // Diameter 0.5, overall height 1 — unitScale() doubles x and z.
      return new THREE.CapsuleGeometry(0.25, 0.5, 6, 16);
    case "plane": {
      const g = new THREE.PlaneGeometry(1, 1);
      g.rotateX(-Math.PI / 2);
      return g;
    }
    case "torus": {
      const tube = Math.max(0.005, o.size[1] / 2);
      const ring = Math.max(0.01, o.size[0] / 2 - tube);
      const g = new THREE.TorusGeometry(ring, tube, 12, 32);
      g.rotateX(-Math.PI / 2);
      return g;
    }
  }
}

function unitScale(o: SetObject): { x: number; y: number; z: number } {
  const [x, y, z] = o.size;
  switch (o.shape) {
    case "capsule":
      return { x: x * 2, y, z: z * 2 };
    case "plane":
      return { x, y: 1, z };
    case "torus":
      return { x: 1, y: 1, z: 1 };
    default:
      return { x, y, z };
  }
}

function makeLight(
  THREE: Three,
  l: SetLight,
  spec: SetSpec,
  castShadow: boolean,
): { objects: ThreeNS.Object3D[]; castsShadow: boolean } {
  const color = new THREE.Color(l.color);
  switch (l.kind) {
    case "ambient":
      return { objects: [new THREE.AmbientLight(color, l.intensity)], castsShadow: false };
    case "hemisphere":
      return {
        objects: [new THREE.HemisphereLight(color, new THREE.Color(l.groundColor ?? spec.ground.color), l.intensity)],
        castsShadow: false,
      };
    case "point": {
      const p = new THREE.PointLight(color, l.intensity, l.distance, 2);
      p.position.set(...l.position);
      return { objects: [p], castsShadow: false };
    }
    case "spot": {
      const s = new THREE.SpotLight(color, l.intensity, l.distance, l.angleDeg * DEG, 0.4, 2);
      s.position.set(...l.position);
      s.target.position.set(...l.target);
      return { objects: [s, s.target], castsShadow: false };
    }
    case "sun": {
      // A sun's position says only where it shines FROM — the model is told
      // its distance means nothing — but three puts the shadow camera AT the
      // light. A sun placed 100 m out over a 30 m set left the whole set past
      // the shadow camera's far plane: no shadow anywhere, the stand-in
      // included, in the very frame an image model is asked to match for
      // light direction (2026-09-10 review). So the sun is re-placed along
      // its own direction at a distance the set's size decides, which
      // changes nothing about how it lights and everything about its shadows.
      const d = new THREE.DirectionalLight(color, l.intensity);
      const span = Math.max(spec.bounds.x, spec.bounds.z, spec.bounds.height);
      const dir = new THREE.Vector3(
        l.position[0] - l.target[0],
        l.position[1] - l.target[1],
        l.position[2] - l.target[2],
      );
      if (dir.lengthSq() < 1e-6) dir.set(0.4, 1, 0.3);
      dir.normalize();
      const dist = span * 1.5 + 10;
      d.target.position.set(...l.target);
      d.position.copy(d.target.position).addScaledVector(dir, dist);
      if (castShadow) {
        const half = Math.min(120, Math.max(spec.bounds.x, spec.bounds.z) * 0.75 + 2);
        d.castShadow = true;
        d.shadow.mapSize.set(2048, 2048);
        d.shadow.camera.left = -half;
        d.shadow.camera.right = half;
        d.shadow.camera.top = half;
        d.shadow.camera.bottom = -half;
        d.shadow.camera.near = 0.5;
        d.shadow.camera.far = dist + span * 1.5 + 10;
        d.shadow.bias = -0.0004;
        d.shadow.normalBias = 0.02;
      }
      return { objects: [d, d.target], castsShadow: castShadow };
    }
  }
}

// ---------------------------------------------------------------------------
// The stand-in: where the person will be, and nothing about who. Neutral
// grey, no face, no clothing — it carries position, scale and facing only,
// because anything more would be a second identity for the image model to
// copy. The ring and arrow are placement aids and are hidden for the
// snapshot (see `helpers`).
// ---------------------------------------------------------------------------

export const STAND_IN_HEIGHT_M = 1.75;

export type StandIn = {
  group: ThreeNS.Group;
  /** The figure alone — what a pointer grabs to drag it. */
  figure: ThreeNS.Group;
  /** Ring and facing arrow: shown while arranging, hidden in snapshots. */
  helpers: ThreeNS.Group;
  dispose(): void;
};

// A faceless jointed mannequin, 1.75 m by default. A capsule alone read as a
// bollard in the first render (2026-09-10), and a still engine told "the
// person stands where the grey figure stands" needs to recognise a figure to
// get the scale right. Feet point along +Z, so the silhouette also says which
// way it faces.
export function buildStandIn(THREE: Three, accent: string, heightM = STAND_IN_HEIGHT_M): StandIn {
  const k = heightM / STAND_IN_HEIGHT_M;
  const group = new THREE.Group();
  group.name = "stand-in";
  const figure = new THREE.Group();
  const grey = new THREE.MeshStandardMaterial({ color: new THREE.Color("#b3aea4"), roughness: 0.85 });
  const geos: ThreeNS.BufferGeometry[] = [];
  const part = (
    geo: ThreeNS.BufferGeometry,
    at: [number, number, number],
    scale: [number, number, number] = [1, 1, 1],
    rotZ = 0,
  ) => {
    geos.push(geo);
    const m = new THREE.Mesh(geo, grey);
    m.position.set(at[0] * k, at[1] * k, at[2] * k);
    m.scale.set(scale[0] * k, scale[1] * k, scale[2] * k);
    m.rotation.z = rotZ;
    m.castShadow = true;
    figure.add(m);
  };
  const limb = (radius: number, length: number) => new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), 6, 12);
  for (const side of [-1, 1]) {
    part(new THREE.BoxGeometry(0.1, 0.06, 0.25), [side * 0.1, 0.03, 0.06]);
    part(limb(0.065, 0.86), [side * 0.1, 0.47, 0]);
    part(limb(0.045, 0.62), [side * 0.25, 1.14, 0], [1, 1, 1], side * 0.08);
  }
  part(new THREE.BoxGeometry(0.33, 0.14, 0.2), [0, 0.9, 0]);
  part(limb(0.14, 0.6), [0, 1.2, 0], [1.25, 1, 0.8]);
  part(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 12), [0, 1.52, 0]);
  part(new THREE.SphereGeometry(0.1, 20, 14), [0, 1.645, 0.005], [1, 1.05, 1.1]);
  group.add(figure);

  const helpers = new THREE.Group();
  const accentMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(accent),
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const ringGeo = new THREE.RingGeometry(0.42, 0.5, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(ringGeo, accentMat);
  ring.position.y = 0.015;
  const arrowGeo = new THREE.ConeGeometry(0.12, 0.3, 3);
  arrowGeo.rotateX(Math.PI / 2);
  const arrow = new THREE.Mesh(arrowGeo, accentMat);
  arrow.position.set(0, 0.03, 0.72);
  arrow.scale.y = 0.2;
  helpers.add(ring, arrow);
  group.add(helpers);

  return {
    group,
    figure,
    helpers,
    dispose() {
      for (const g of [...geos, ringGeo, arrowGeo]) g.dispose();
      grey.dispose();
      accentMat.dispose();
    },
  };
}

/** Place the stand-in on a mark: facingDeg 0 faces +Z, 90 faces +X. */
export function placeStandIn(standIn: StandIn, mark: { x: number; z: number; facingDeg: number }): void {
  standIn.group.position.set(mark.x, 0, mark.z);
  standIn.group.rotation.set(0, mark.facingDeg * DEG, 0);
}

// ---------------------------------------------------------------------------
// Lenses. The picker speaks millimetres; three.js speaks vertical field of
// view. Full-frame equivalents (24 mm sensor height), which is what a
// photographer means by "a 35".
// ---------------------------------------------------------------------------

export const LENSES_MM = [18, 24, 35, 50, 85, 135] as const;

export function fovForLens(mm: number): number {
  return (2 * Math.atan(12 / mm)) / DEG;
}

export function lensForFov(fovDeg: number): number {
  return 12 / Math.tan((fovDeg * DEG) / 2);
}

/** The listed lens nearest to a field of view. */
export function nearestLens(fovDeg: number): (typeof LENSES_MM)[number] {
  const mm = lensForFov(fovDeg);
  return LENSES_MM.reduce((best, l) => (Math.abs(l - mm) < Math.abs(best - mm) ? l : best), LENSES_MM[0]);
}
