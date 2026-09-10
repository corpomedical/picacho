// Is a Set closed? Measured, not asked (Astra Sets, 2026-09-11).
//
// A Set exists so the place stays the same from shot to shot. Where a
// camera can see past the last wall — bare set floor running out to empty
// sky — the image model invents whatever it likes, and invents it
// differently every time. The first production builds showed both ways it
// happens: an exterior street left open at both ends, and a showroom built
// like a theatre set, with no fourth wall where its cameras stood and gaps
// where two walls failed to meet.
//
// This is the deterministic check for it, asking what the eye asks. From
// every mark, at eye height, rays go out on a compass of bearings. A bearing
// is CLOSED when the eye-level ray meets something the set built (a wall, a
// facade, a tree line). When it escapes to the sky, the question is what
// lies just below the horizon: rays dipping towards the floor find either
// something built — a sea modelled to the horizon, a line of dunes, distant
// hills — which is a real horizon, or the interpreter's own bare floor
// running out, which is the edge of the set. A bearing is OPEN when at
// least 2 of a fan of 5 rays (±8°) see that bare floor first.
//
// The downward rays look no further than a set can build: the normaliser
// holds every shape within 200 m of the centre and 200 m across, so nothing
// modelled reaches past 300 m, while the interpreter's floor runs out to
// three set-widths. Probing past 300 m on a 150 m set read even a sea
// modelled edge to edge as open (2026-09-11 review).
//
// Calibrated 2026-09-11 against three blind judges on four sets (agreeing
// direction for direction). On the beach fixture it reads the sea dead ahead
// and the dunes inland as closed, and bare floor along the shore both ways —
// and just either side of dead ahead, where the modelled sea (200 m wide)
// stops short of the horizon.
//
// three.js is passed in, as build-scene.ts does: the server measures with
// three's core, no GPU involved.

import type * as ThreeNS from "three";
import { buildSetScene, groundHalfExtent } from "./build-scene";
import { SET_LIMITS, type SetSpec } from "./set-spec";

type Three = typeof ThreeNS;

export const CLOSURE_BEARINGS = 16;
export const CLOSURE_EYE_HEIGHT_M = 1.6;
/** Half-width of the fan of rays cast on each bearing. */
const FAN_HALF_DEG = 8;
const FAN_RAYS = 5;
/** Rays of a fan that must see bare floor for the bearing to count as open. */
const FAN_OPEN_MIN = 2;
/**
 * Just below the horizon, shallowest first, as fractions of the reach (the
 * floor's edge, or the furthest a set can build, whichever is nearer): a ray
 * at dip d from eye height meets the floor 1.6 / tan(d) away, so these land
 * at 1/1.1, 1/1.5, 1/2, 1/3 and 1/5 of the way out. Fixed
 * angles missed the floor entirely around a small room (a 3° ray from the
 * middle of a 10 m room reaches the floor 30.5 m out, just past its 30 m
 * edge), which read an open fourth wall as closed.
 */
const FLOOR_FRACTIONS = [1 / 1.1, 1 / 1.5, 1 / 2, 1 / 3, 1 / 5];

export type SetSide = "+X" | "-X" | "+Z" | "-Z";

export type ClosureReport = {
  bearings: number;
  /** Bearings (degrees, 0 = +Z, 90 = +X) open from ANY mark, ascending. */
  openBearings: number[];
  /** The same, per mark. */
  perMark: { markId: string; openBearings: number[] }[];
  /** The sides of the set the escaping rays actually leave through. */
  openSides: SetSide[];
};

const DEG = Math.PI / 180;

export function measureClosure(THREE: Three, spec: SetSpec): ClosureReport {
  const built = buildSetScene(THREE, spec);
  try {
    built.root.updateMatrixWorld(true);
    const solids: ThreeNS.Object3D[] = [];
    let ground: ThreeNS.Object3D | null = null;
    built.root.traverse((o) => {
      if (!(o as ThreeNS.Mesh).isMesh || o.name === "sky") return;
      if (o.name === "ground") ground = o;
      else solids.push(o);
    });
    const targets = ground ? [...solids, ground] : solids;
    const span = Math.max(spec.bounds.x, spec.bounds.z);
    const raycaster = new THREE.Raycaster();
    raycaster.far = span * 8 + 200;
    const origin = new THREE.Vector3();
    const dir = new THREE.Vector3();

    const aim = (bearingDeg: number, dipDeg: number) => {
      const b = bearingDeg * DEG;
      const d = dipDeg * DEG;
      dir.set(Math.sin(b) * Math.cos(d), -Math.sin(d), Math.cos(b) * Math.cos(d));
      raycaster.set(origin, dir);
    };
    // "sky" when nothing is hit, otherwise whether the first hit was built.
    const firstHit = (bearingDeg: number, dipDeg: number): "built" | "floor" | "sky" => {
      aim(bearingDeg, dipDeg);
      const hit = raycaster.intersectObjects(targets, false)[0];
      if (!hit) return "sky";
      return hit.object === ground ? "floor" : "built";
    };
    const reach = Math.min(groundHalfExtent(spec), SET_LIMITS.maxCoordinate + SET_LIMITS.maxSize / 2);
    const dips = FLOOR_FRACTIONS.map((f) => Math.atan(CLOSURE_EYE_HEIGHT_M / (reach * f)) / DEG);
    const seesBareFloor = (bearingDeg: number): boolean => {
      if (firstHit(bearingDeg, 0) === "built") return false;
      for (const dip of dips) {
        const h = firstHit(bearingDeg, dip);
        if (h !== "sky") return h === "floor";
      }
      return false;
    };

    const sides = new Set<SetSide>();
    const perMark = spec.marks.map((m) => {
      origin.set(m.x, CLOSURE_EYE_HEIGHT_M, m.z);
      const open: number[] = [];
      for (let i = 0; i < CLOSURE_BEARINGS; i++) {
        const bearing = (360 / CLOSURE_BEARINGS) * i;
        const exits: SetSide[] = [];
        for (let k = 0; k < FAN_RAYS; k++) {
          const b = bearing - FAN_HALF_DEG + ((2 * FAN_HALF_DEG) / (FAN_RAYS - 1)) * k;
          if (seesBareFloor(b)) exits.push(exitSide(spec, m.x, m.z, b));
        }
        if (exits.length >= FAN_OPEN_MIN) {
          open.push(bearing);
          for (const e of exits) sides.add(e);
        }
      }
      return { markId: m.id, openBearings: open };
    });

    const all = new Set<number>();
    for (const m of perMark) for (const b of m.openBearings) all.add(b);
    const order: SetSide[] = ["+Z", "+X", "-Z", "-X"];
    return {
      bearings: CLOSURE_BEARINGS,
      openBearings: [...all].sort((a, b) => a - b),
      perMark,
      openSides: order.filter((o) => sides.has(o)),
    };
  } finally {
    built.dispose();
  }
}

/** Which side of the set's footprint a ray from (x, z) on this bearing leaves through. */
function exitSide(spec: SetSpec, x: number, z: number, bearingDeg: number): SetSide {
  const dx = Math.sin(bearingDeg * DEG);
  const dz = Math.cos(bearingDeg * DEG);
  const hx = spec.bounds.x / 2;
  const hz = spec.bounds.z / 2;
  const tx = Math.abs(dx) < 1e-9 ? Infinity : ((dx > 0 ? hx : -hx) - x) / dx;
  const tz = Math.abs(dz) < 1e-9 ? Infinity : ((dz > 0 ? hz : -hz) - z) / dz;
  if (tx < tz) return dx > 0 ? "+X" : "-X";
  return dz > 0 ? "+Z" : "-Z";
}

/** The open sides in the builder's own coordinates — what a closing retry names. */
export function describeOpenSides(spec: SetSpec, sides: SetSide[]): string[] {
  const hx = spec.bounds.x / 2;
  const hz = spec.bounds.z / 2;
  return sides.map((side) =>
    side === "+Z"
      ? `the +Z side (around z = ${hz})`
      : side === "-Z"
        ? `the -Z side (around z = -${hz})`
        : side === "+X"
          ? `the +X side (around x = ${hx})`
          : `the -X side (around x = -${hx})`,
  );
}
