// Helios Studio people (2026-09-30 — operator picked "Posable people"): the
// person figure that replaces the grey capsule stand-in. An artist's
// mannequin, built here and fully ours: smooth tapered segments that follow
// the bones of studio-pose.ts's skeleton, ball joints, an oval head with a
// small nose so its facing reads, in one neutral material (the object's
// paint). Every segment is a plain mesh under its bone, so the viewport, the
// path tracer, the Cycles export and GLB all draw the posed figure as it
// stands; each mesh carries its bone's name for picking in Pose Mode.

import * as THREE from "three";
import { BONE, BONES, buildSkeleton, type BoneName } from "@/lib/sets/studio-pose";

/** A smooth limb from its joint along +Y to `len`, `r0` wide at the joint and `r1` at the end, rounded both ends. */
function taper(len: number, r0: number, r1: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(1e-4, r0 * Math.cos(a)), r0 * Math.sin(a)));
  }
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(1e-4, r1 * Math.cos(a)), len + r1 * Math.sin(a)));
  }
  const g = new THREE.LatheGeometry(pts, 24);
  g.computeVertexNormals();
  return g;
}

/** Radii at the joint and at the end, per bone (metres). */
const SEG: Partial<Record<BoneName, [number, number]>> = {
  neck: [0.048, 0.044],
  "upperArm.L": [0.052, 0.04],
  "forearm.L": [0.04, 0.03],
  "thigh.L": [0.085, 0.056],
  "shin.L": [0.055, 0.038],
};
const segOf = (n: BoneName) => SEG[n] ?? SEG[n.replace(".R", ".L") as BoneName];

/**
 * The figure: a group (the object) holding the skeleton and its segments,
 * standing at rest with its soles on y 0, facing +Z. `mat` is the one
 * material every segment shares.
 */
export function makeFigure(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const sk = buildSkeleton(g);
  const add = (bone: BoneName, geo: THREE.BufferGeometry, at: [number, number, number] = [0, 0, 0], scale?: [number, number, number], rot?: [number, number, number]) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...at);
    if (scale) m.scale.set(...scale);
    if (rot) m.rotation.set(...rot);
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.bone = bone;
    m.name = bone + " · segment";
    sk.bones[bone].add(m);
    return m;
  };
  const ball = (r: number) => new THREE.SphereGeometry(r, 20, 14);
  for (const b of BONES) {
    const n = b.name, t = new THREE.Vector3(...b.tail), len = t.length();
    const r = segOf(n);
    if (r) {
      // A limb along its bone: the lathe runs along +Y, turned to the bone's tail.
      const m = add(n, taper(len, r[0], r[1]));
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), t.clone().normalize());
      if (!n.startsWith("neck")) add(n, ball(r[0] * 0.92));
    }
  }
  add("pelvis", ball(1), [0, -0.01, 0], [0.165, 0.11, 0.115]);
  add("spine", taper(0.2, 0.125, 0.135), [0, 0.01, 0], [1, 1, 0.72]);
  add("chest", ball(1), [0, 0.12, 0.005], [0.175, 0.15, 0.115]);
  add("head", ball(1), [0, 0.095, 0.012], [0.088, 0.108, 0.1]);
  add("head", ball(0.02), [0, 0.092, 0.108], [0.8, 1.1, 1]);
  for (const s of ["L", "R"] as const) {
    const x = s === "L" ? 1 : -1;
    add(`shoulder.${s}`, taper(0.15, 0.045, 0.052), [0, 0, 0], [1, 1, 0.9], [0, 0, -x * (Math.PI / 2 - 0.12)]);
    add(`hand.${s}`, ball(1), [0, -0.085, 0.005], [0.026, 0.085, 0.048]);
    add(`hand.${s}`, ball(0.018), [0, -0.035, 0.05], [1, 1.8, 1]);
    add(`foot.${s}`, ball(1), [0, -0.035, 0.055], [0.046, 0.037, 0.125]);
  }
  g.userData.figure = true;
  g.userData.paint = [mat];
  return g;
}

/** The bone a mesh belongs to, when it is one of a figure's segments. */
export function boneOfMesh(o: THREE.Object3D | null): BoneName | null {
  for (let x = o; x; x = x.parent) if (typeof x.userData?.bone === "string" && BONE[x.userData.bone as BoneName]) return x.userData.bone as BoneName;
  return null;
}
