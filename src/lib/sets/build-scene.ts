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
import { fitRepeat, groundMaterialOf, materialOf, stageMaterial, type StageTextures } from "./stage-materials";

type Three = typeof ThreeNS;

/**
 * "full" is the stage as drawn since 2026-09-17 (canvas page J, cut 1):
 * physical materials with texture from each thing's material word, a
 * physical sky lighting the set through an environment map, soft shadows
 * from the sun and the lamps. "basic" is the stage as it was — flat colour
 * under Astra's lights — kept for phones, and reachable with ?stage=basic.
 */
export type StageQuality = "basic" | "full";

/** three's Sky addon, as the page imports it: a mesh whose shader takes the sun. */
export type SkyLike = ThreeNS.Mesh<ThreeNS.BufferGeometry, ThreeNS.ShaderMaterial>;

export type BuildSetOptions = {
  shadows?: boolean;
  quality?: StageQuality;
  /** The page's procedural textures (stage-materials.ts makeStageTextures); null draws the words without maps. */
  textures?: StageTextures | null;
  /**
   * For the full stage's sky: the Sky class and a PMREM generator on the
   * page's renderer. Without them (node, the tests) the full stage keeps the
   * gradient dome and has no environment light.
   */
  sky?: { Sky: new () => SkyLike; pmrem: ThreeNS.PMREMGenerator } | null;
};

export type BuiltSet = {
  /** Everything the set draws; add it to a scene. */
  root: ThreeNS.Group;
  /** For scene.background — null when a sky dome is drawn instead. */
  background: ThreeNS.Color | null;
  fog: ThreeNS.Fog | ThreeNS.FogExp2 | null;
  /** For scene.environment: the sky's light on every surface (the full stage with a sky), else null. */
  environment: ThreeNS.Texture | null;
  /** For scene.environmentIntensity. */
  environmentIntensity: number;
  /** Far enough for the camera to see the sky dome. */
  farPlane: number;
  meshCount: number;
  quality: StageQuality;
  dispose(): void;
};

const DEG = Math.PI / 180;

/**
 * How the full stage balances Astra's lights against the sky it adds.
 * Astra writes intensities for the basic stage (a sun of 1–4 under a
 * hemisphere fill); on the full stage the sky's environment lights every
 * surface, so the fill comes down and the sun goes up, and a low sun keeps
 * more of its fill. The numbers are the draft's (canvas page J, rendered
 * at exposure 0.72 with sun ×3.2, fill ×0.45, environment 0.15), moved to
 * the stage's own exposure of 1.3, which changes nothing about the picture.
 * At night the lamps carry the set: they go up, the fill goes up a little,
 * and the dome lights the rest through the environment.
 */
export const FULL_STAGE = {
  sunGain: 1.8,
  sunGainLow: 1.55,
  /** sin of 20°: below this the sun is "low" (sunset, sunrise). */
  lowSunY: 0.34,
  fillGain: 0.25,
  envIntensity: 0.085,
  envIntensityLow: 0.09,
  nightEnvIntensity: 1,
  nightFillGain: 2.2,
  nightLampGain: 2.4,
  sunShadowMap: 4096,
  spotShadowMap: 1024,
  pointShadowMap: 512,
  maxSpotShadows: 2,
  maxPointShadows: 2,
  /** Daylight fog is exponential: this over the set's far distance. */
  fogDensityOverFar: 1.6,
} as const;

export function buildSetScene(THREE: Three, spec: SetSpec, opts: BuildSetOptions = {}): BuiltSet {
  const shadows = opts.shadows === true;
  const quality: StageQuality = opts.quality === "full" ? "full" : "basic";
  const full = quality === "full";
  const textures = full ? (opts.textures ?? null) : null;
  const root = new THREE.Group();
  root.name = "set";
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };
  /** A fitted copy of a material and its maps (stage-materials.ts fitRepeat), freed with the build. */
  const adopt = (m: ThreeNS.MeshPhysicalMaterial): ThreeNS.MeshPhysicalMaterial => {
    track(m);
    for (const k of ["map", "bumpMap", "roughnessMap"] as const) if (m[k]) track(m[k]);
    return m;
  };

  const span = Math.max(spec.bounds.x, spec.bounds.z, spec.bounds.height);
  const domeRadius = Math.max(150, span * 4);
  const night = spec.sky.kind === "night";

  // The sun's direction, for the sky and for what counts as a low sun.
  const sunSpec = spec.lights.find((l) => l.kind === "sun") ?? null;
  const sunDir = new THREE.Vector3(0.4, 1, 0.3);
  if (sunSpec) {
    sunDir.set(sunSpec.position[0] - sunSpec.target[0], sunSpec.position[1] - sunSpec.target[1], sunSpec.position[2] - sunSpec.target[2]);
    if (sunDir.lengthSq() < 1e-6) sunDir.set(0.4, 1, 0.3);
  }
  sunDir.normalize();
  const lowSun = sunDir.y < FULL_STAGE.lowSunY;

  // --- sky ---
  let background: ThreeNS.Color | null = null;
  let environment: ThreeNS.Texture | null = null;
  let environmentIntensity = 1;
  /** The full stage's environment, from whatever draws the sky. */
  const lightFrom = (skyMesh: ThreeNS.Object3D, intensity: number) => {
    if (!full || !opts.sky) return;
    const envScene = new THREE.Scene();
    envScene.add(skyMesh);
    const target = track(opts.sky.pmrem.fromScene(envScene, 0.04, 0.1, domeRadius * 3));
    envScene.remove(skyMesh);
    environment = target.texture;
    environmentIntensity = intensity;
  };
  if (spec.sky.kind === "color") {
    background = new THREE.Color(spec.sky.colors[0]);
  } else if (full && opts.sky && !night && sunSpec) {
    // A real sky, from the sun's own height: the horizon warms as the sun
    // drops, the zenith deepens, and its light falls on every surface.
    const sky = new opts.sky.Sky();
    sky.name = "sky";
    sky.scale.setScalar(domeRadius * 1.8);
    const u = sky.material.uniforms;
    u.turbidity.value = lowSun ? 8 : 4;
    u.rayleigh.value = lowSun ? 3.2 : 1.6;
    u.mieCoefficient.value = lowSun ? 0.02 : 0.006;
    u.mieDirectionalG.value = lowSun ? 0.86 : 0.8;
    (u.sunPosition.value as ThreeNS.Vector3).copy(sunDir);
    track(sky.material);
    track(sky.geometry);
    lightFrom(sky, lowSun ? FULL_STAGE.envIntensityLow : FULL_STAGE.envIntensity);
    root.add(sky);
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
    lightFrom(dome, night ? FULL_STAGE.nightEnvIntensity : FULL_STAGE.envIntensity);
    root.add(dome);
  }

  // Daylight fog on the full stage thins with distance the way air does;
  // a night set keeps Astra's near and far as written (its fog is a look).
  const fog: BuiltSet["fog"] = !spec.fog
    ? null
    : full && !night
      ? new THREE.FogExp2(new THREE.Color(spec.fog.color), FULL_STAGE.fogDensityOverFar / spec.fog.far)
      : new THREE.Fog(new THREE.Color(spec.fog.color), spec.fog.near, spec.fog.far);

  // --- ground: wider than the set, so no camera inside the bounds sees its edge ---
  {
    const size = groundHalfExtent(spec) * 2;
    const geo = track(new THREE.PlaneGeometry(size, size));
    geo.rotateX(-Math.PI / 2);
    const mat = track(
      full
        ? stageMaterial(THREE, groundMaterialOf(spec.ground), { color: spec.ground.color, roughness: spec.ground.roughness, metalness: 0 }, textures)
        : new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.ground.color), roughness: spec.ground.roughness }),
    );
    const ground = new THREE.Mesh(geo, mat);
    ground.name = "ground";
    ground.receiveShadow = shadows;
    if (full) {
      // A plane geometry is unit-sized nowhere here (it is built at the
      // ground's real size), so the repeat is fitted through the scale it
      // would have had.
      const fitted = fitRepeat({ scale: { x: size, y: 1, z: size }, material: mat }, true);
      if (fitted) ground.material = adopt(fitted);
    }
    root.add(ground);
  }

  // --- lights ---
  let shadowCaster = false;
  let spotShadows = 0;
  let pointShadows = 0;
  const skyLit = environment !== null;
  for (const light of spec.lights) {
    const built = makeLight(THREE, light, spec, shadows && !shadowCaster && light.kind === "sun", full);
    if (built.castsShadow) shadowCaster = true;
    for (const o of built.objects) {
      if (full) {
        // The full stage's balance (FULL_STAGE), and soft shadows from the
        // lamps too — the first two spots and the first two bulbs.
        const l = o as ThreeNS.Light;
        if ((o as ThreeNS.DirectionalLight).isDirectionalLight) l.intensity *= lowSun ? FULL_STAGE.sunGainLow : FULL_STAGE.sunGain;
        else if ((o as ThreeNS.HemisphereLight).isHemisphereLight || (o as ThreeNS.AmbientLight).isAmbientLight) {
          if (night) l.intensity *= FULL_STAGE.nightFillGain;
          else if (skyLit) l.intensity *= FULL_STAGE.fillGain;
        } else if ((o as ThreeNS.SpotLight).isSpotLight) {
          const sp = o as ThreeNS.SpotLight;
          if (night) sp.intensity *= FULL_STAGE.nightLampGain;
          sp.penumbra = 0.55;
          if (shadows && spotShadows < FULL_STAGE.maxSpotShadows) {
            spotShadows += 1;
            sp.castShadow = true;
            sp.shadow.mapSize.set(FULL_STAGE.spotShadowMap, FULL_STAGE.spotShadowMap);
            sp.shadow.radius = 3;
            sp.shadow.bias = -0.0003;
            sp.shadow.normalBias = 0.02;
            sp.shadow.camera.near = 0.3;
            sp.shadow.camera.far = (sp.distance || 30) + 5;
          }
        } else if ((o as ThreeNS.RectAreaLight).isRectAreaLight) {
          if (night) (o as ThreeNS.Light).intensity *= FULL_STAGE.nightLampGain;
        } else if ((o as ThreeNS.PointLight).isPointLight) {
          const pt = o as ThreeNS.PointLight;
          if (night) pt.intensity *= FULL_STAGE.nightLampGain;
          if (shadows && pointShadows < FULL_STAGE.maxPointShadows) {
            pointShadows += 1;
            pt.castShadow = true;
            pt.shadow.mapSize.set(FULL_STAGE.pointShadowMap, FULL_STAGE.pointShadowMap);
            pt.shadow.radius = 3;
            pt.shadow.bias = -0.0005;
            pt.shadow.normalBias = 0.03;
            pt.shadow.camera.near = 0.2;
          }
        }
      }
      root.add(o);
    }
  }

  // --- objects ---
  const geometries = new Map<string, ThreeNS.BufferGeometry>();
  const materials = new Map<string, ThreeNS.MeshStandardMaterial | ThreeNS.MeshPhysicalMaterial>();
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
  const materialFor = (o: SetObject): ThreeNS.MeshStandardMaterial | ThreeNS.MeshPhysicalMaterial => {
    const word = full ? materialOf(o) : "";
    const key = [word, o.color, o.roughness, o.metalness, o.emissive ?? "", o.emissiveIntensity, o.shape === "plane"].join("|");
    const hit = materials.get(key);
    if (hit) return hit;
    if (full) {
      const made = track(
        stageMaterial(
          THREE,
          word as Exclude<typeof word, "">,
          { color: o.color, roughness: o.roughness, metalness: o.metalness, emissive: o.emissive, emissiveIntensity: o.emissiveIntensity, doubleSided: o.shape === "plane" },
          textures,
        ),
      );
      materials.set(key, made);
      return made;
    }
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
      if (full) {
        const fitted = fitRepeat(mesh, o.shape === "plane");
        if (fitted) mesh.material = adopt(fitted);
      }
      root.add(mesh);
      meshCount += 1;
    }
  }

  return {
    root,
    background,
    fog,
    environment,
    environmentIntensity,
    farPlane: domeRadius * 2.2,
    meshCount,
    quality,
    dispose() {
      for (const d of disposables) d.dispose();
      root.clear();
    },
  };
}

/**
 * A fresh build moved into a live set's root, in place of everything the
 * root held: the group keeps its identity, so whatever is aimed at it keeps
 * working, and only its children change. Returns what frees the fresh
 * build's resources, for the swap after this one.
 *
 * The root is emptied HERE, not by the old build's dispose: that clears the
 * old build's own group, which is empty once its things moved into the live
 * root. Found 2026-09-15 proving Helios's light schemes: every rebuild after
 * the first left the last one's objects and lights in the set — three
 * schemes in turn stacked two lights into six, and a second Astra edit left
 * the first edit's objects standing.
 */
export function moveBuildInto(root: ThreeNS.Group, fresh: BuiltSet): () => void {
  root.clear();
  for (const child of [...fresh.root.children]) root.add(child);
  return () => fresh.dispose();
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
  full = false,
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
    case "area": {
      // A soft rectangle facing its target (the light department, cut 3).
      // three draws it without a shadow; the page initialises the area
      // light's uniforms once (RectAreaLightUniformsLib) before drawing.
      const [w, h] = l.size ?? [1, 1];
      const a = new THREE.RectAreaLight(color, l.intensity, w, h);
      a.position.set(...l.position);
      a.lookAt(...l.target);
      return { objects: [a], castsShadow: false };
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
        d.shadow.mapSize.set(full ? FULL_STAGE.sunShadowMap : 2048, full ? FULL_STAGE.sunShadowMap : 2048);
        d.shadow.camera.left = -half;
        d.shadow.camera.right = half;
        d.shadow.camera.top = half;
        d.shadow.camera.bottom = -half;
        d.shadow.camera.near = 0.5;
        d.shadow.camera.far = dist + span * 1.5 + 10;
        if (full) {
          // Softened 2 px; a low sun grazes every surface, so it needs more
          // room against its own shadow (acne) than a high one.
          d.shadow.radius = 2;
          d.shadow.bias = -0.00015;
          d.shadow.normalBias = dir.y < FULL_STAGE.lowSunY ? 0.12 : 0.04;
        } else {
          d.shadow.bias = -0.0004;
          d.shadow.normalBias = 0.02;
        }
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
// view. On full frame (24 mm sensor height, the default) a "35" is what a
// photographer means by one; the rig's sensor (rig.ts sensorHeightMm) makes
// the same 35 see less on Super 35 and more on a large format — the camera
// department, cut 2 (2026-09-17).
// ---------------------------------------------------------------------------

export const LENSES_MM = [18, 24, 35, 50, 85, 135] as const;
export const FULL_FRAME_HEIGHT_MM = 24;

export function fovForLens(mm: number, sensorHeightMm = FULL_FRAME_HEIGHT_MM): number {
  return (2 * Math.atan(sensorHeightMm / 2 / mm)) / DEG;
}

export function lensForFov(fovDeg: number, sensorHeightMm = FULL_FRAME_HEIGHT_MM): number {
  return sensorHeightMm / 2 / Math.tan((fovDeg * DEG) / 2);
}

/** The listed lens nearest to a field of view. */
export function nearestLens(fovDeg: number, sensorHeightMm = FULL_FRAME_HEIGHT_MM): (typeof LENSES_MM)[number] {
  const mm = lensForFov(fovDeg, sensorHeightMm);
  return LENSES_MM.reduce((best, l) => (Math.abs(l - mm) < Math.abs(best - mm) ? l : best), LENSES_MM[0]);
}

/**
 * An anamorphic squeeze: the same lens sees `squeeze` times wider across
 * the frame, drawn unsqueezed. Applied to the projection after
 * updateProjectionMatrix (which resets it), so a raycast through the camera
 * sees the same picture the person does. 1 leaves the camera alone.
 */
export function squeezeProjection(camera: ThreeNS.PerspectiveCamera, squeeze: number): void {
  if (!(squeeze > 1)) return;
  camera.projectionMatrix.elements[0] /= squeeze;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
