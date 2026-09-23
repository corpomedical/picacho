// The movers (2026-09-23, "I want Helios to work the same way"): a thing on
// the set that MOVES during a beat — the van that drives past, the door that
// swings, the ball that rolls. Until now only the camera and the figure ever
// moved, so a rehearsal of a street was a street standing still.
//
// A mover is stored against the thing's own key (elements.ts) and says where
// it has got to by the end of the beat: how far its middle has travelled from
// where the set was built, how far it has turned, and the points it travels
// through. It never edits the set — the set is the arrangement, and a film is
// what happens on it — so the same set can carry three films that move its
// van three different ways.
//
// Pure, relative-import only, like people.ts and furniture.ts: the page, the
// film's data, the shot's plan and the tests all read the same shape.

import { ELEMENT_KEY_RE, type SetElement } from "./elements";
import type { SetObject, SetSpec } from "./set-spec";
import { alongPath, normalisePath, type Path } from "./people";

/** How far a mover may end from where it was built, metres (the film's own reach). */
const REACH_M = 200;
/** How many things may move in one beat: three is as much as one continuous shot can be read to carry. */
export const MOVERS_PER_BEAT = 3;

// A turn of exactly half a circle lands a coordinate on -0, which reads as
// another number to anything comparing stored movers.
const r3 = (n: number) => {
  const v = Math.round(n * 1000) / 1000;
  return v === 0 ? 0 : v;
};
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? r3(Math.min(REACH_M, Math.max(-REACH_M, v))) : null);
const DEG = Math.PI / 180;

/**
 * One thing moving in one beat: where its middle stands when the beat ends,
 * how far it has turned from the heading it was built at, and the points it
 * travels through on the way. The key is the thing's key in the ARRANGEMENT
 * — where the set stands — so a beat that moves it does not rename it.
 */
export type Mover = {
  key: string;
  /** Where its middle ends, in the set's own metres. */
  x: number;
  z: number;
  /** How far it has turned by then, degrees about the upright; 0 keeps its heading. */
  turnDeg: number;
  /** The points its middle travels through, empty for a straight line. */
  path: Path;
};

/** Where a thing stands at a moment: the same shape a mover ends at. */
export type Placement = { key: string; x: number; z: number; turnDeg: number };

/** A stored or sent mover list, cut to the ceiling; anything unusable is dropped whole. */
export function normaliseMovers(v: unknown): Mover[] {
  if (!Array.isArray(v)) return [];
  const out: Mover[] = [];
  const seen = new Set<string>();
  for (const m of v) {
    if (out.length >= MOVERS_PER_BEAT) break;
    if (!m || typeof m !== "object") continue;
    const raw = m as Record<string, unknown>;
    const key = typeof raw.key === "string" && ELEMENT_KEY_RE.test(raw.key) ? raw.key : null;
    const x = num(raw.x);
    const z = num(raw.z);
    if (!key || x === null || z === null || seen.has(key)) continue;
    const turn = typeof raw.turnDeg === "number" && Number.isFinite(raw.turnDeg) ? Math.round((((raw.turnDeg % 360) + 360) % 360) * 10) / 10 : 0;
    seen.add(key);
    out.push({ key, x, z, turnDeg: turn, path: normalisePath(raw.path) });
  }
  return out;
}

/** Two mover lists as the same list: a thing moving anywhere else is another beat. */
export function sameMovers(a: readonly Mover[], b: readonly Mover[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((m, i) => {
    const o = b[i];
    return (
      m.key === o.key &&
      m.x === o.x &&
      m.z === o.z &&
      m.turnDeg === o.turnDeg &&
      m.path.length === o.path.length &&
      m.path.every((p, j) => p.x === o.path[j].x && p.z === o.path[j].z)
    );
  });
}

/**
 * Where every moved thing stands at the end of each beat, in beat order. A
 * thing stays where the film left it: a beat that does not move it keeps the
 * beat before it, and the first beat opens on the arrangement — the same
 * rule the figure and the sun follow (film.ts filmStages).
 */
export function moverStages(beats: readonly { movers: readonly Mover[] }[]): Placement[][] {
  const at = new Map<string, Placement>();
  return beats.map((beat) => {
    for (const m of beat.movers) at.set(m.key, { key: m.key, x: m.x, z: m.z, turnDeg: m.turnDeg });
    return [...at.values()];
  });
}

/** Where a thing stands before a beat moves it: the beat before it, else where it was built. */
export function placementBefore(stages: readonly Placement[][], beat: number, key: string, home: { x: number; z: number }): Placement {
  for (let i = beat - 1; i >= 0; i--) {
    const found = stages[i]?.find((p) => p.key === key);
    if (found) return found;
  }
  return { key, x: home.x, z: home.z, turnDeg: 0 };
}

/**
 * Where a thing stands a share `e` of the way through the beat that moves
 * it: along its own path, turning as it goes. The previz and the rehearsal
 * draw every frame from this, and at e = 1 it is exactly where the beat's
 * end frame is shot with it (movedSpec).
 */
export function moverAlong(from: Placement, mover: Mover, e: number): Placement {
  const k = Math.min(1, Math.max(0, e));
  const at = alongPath({ x: from.x, z: from.z }, mover.path, { x: mover.x, z: mover.z }, k);
  // The short way round: from 350° to 10° is twenty degrees, not three hundred and forty.
  const d = ((mover.turnDeg - from.turnDeg + 540) % 360) - 180;
  const turn = (((from.turnDeg + d * k) % 360) + 360) % 360;
  return { key: mover.key, x: at.x, z: at.z, turnDeg: Math.round(turn * 10) / 10 };
}

/**
 * Whether this thing can be moved on its own. A block written once and drawn
 * many times (a row of bollards, a line of parked cars) is ONE object in the
 * set with copies, and the set cannot say where a single copy stands — so a
 * thing may move only when every copy of every block it is made of belongs to
 * it. The card says so rather than moving the whole row.
 */
export function canMove(el: SetElement, spec: Pick<SetSpec, "objects">): boolean {
  const mine = new Map<number, number>();
  for (const [oi] of el.members) mine.set(oi, (mine.get(oi) ?? 0) + 1);
  for (const [oi, count] of mine) {
    const o = spec.objects[oi];
    if (!o) return false;
    if ((o.repeat?.count ?? 1) !== count) return false;
  }
  return true;
}

/** A point turned about another point, on the ground. */
export function turnAbout(p: { x: number; z: number }, about: { x: number; z: number }, turnDeg: number): { x: number; z: number } {
  if (!turnDeg) return { x: p.x, z: p.z };
  const c = Math.cos(turnDeg * DEG);
  const s = Math.sin(turnDeg * DEG);
  const dx = p.x - about.x;
  const dz = p.z - about.z;
  // The stage's own sense of a turn: +Y in three.js, which reads as x' = x·cos + z·sin.
  return { x: r3(about.x + dx * c + dz * s), z: r3(about.z - dx * s + dz * c) };
}

/**
 * The set as it stands once its movers have moved, for the one frame a beat
 * ends on: the blocks themselves are moved, so everything downstream — the
 * sketch the model paints from, which things are in the frame, the sentence
 * that names each one by where it stands — is true of the moment without
 * knowing movers exist.
 *
 * The set's own objects are never edited: this is a copy, and the film keeps
 * the arrangement.
 */
export function movedSpec<T extends Pick<SetSpec, "objects">>(spec: T, els: readonly SetElement[], placements: readonly Placement[]): T {
  if (placements.length === 0) return spec;
  const byKey = new Map(els.map((e) => [e.key, e]));
  const moved = new Map<number, SetObject>();
  for (const p of placements) {
    const el = byKey.get(p.key);
    if (!el || !canMove(el, spec)) continue;
    const about = { x: el.centre[0], z: el.centre[2] };
    const shift = { x: p.x - about.x, z: p.z - about.z };
    for (const oi of new Set(el.members.map(([o]) => o))) {
      const o = moved.get(oi) ?? spec.objects[oi];
      if (!o) continue;
      const turned = turnAbout({ x: o.position[0], z: o.position[2] }, about, p.turnDeg);
      const next: SetObject = {
        ...o,
        position: [r3(turned.x + shift.x), o.position[1], r3(turned.z + shift.z)],
        rotation: [o.rotation[0], r3(o.rotation[1] + p.turnDeg), o.rotation[2]],
      };
      // A block drawn many times keeps its row: the step between its copies
      // turns with it, so a turned line of tyres is still a line.
      if (o.repeat && p.turnDeg) {
        const step = turnAbout({ x: o.repeat.offset[0], z: o.repeat.offset[2] }, { x: 0, z: 0 }, p.turnDeg);
        next.repeat = { ...o.repeat, offset: [step.x, o.repeat.offset[1], step.z] };
      }
      moved.set(oi, next);
    }
  }
  if (moved.size === 0) return spec;
  return { ...spec, objects: spec.objects.map((o, i) => moved.get(i) ?? o) };
}
