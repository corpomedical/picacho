// Moves (Helios Cinema, 2026-09-15, canvas page I): Cinema Studio's camera
// moves, as PATHS in the person's own set instead of # tags in a prompt.
// Picking a move for a film beat lays the beat's end keyframe round the
// figure (layMove); the stage flies it in previz for free, and the take
// renders between two frames the set drew — so where the move starts and
// ends is held by the stage, and only the path between is the engine's.
// Each move also carries one sentence for the video model about that path
// (take.ts), and three textures ride on top as words alone: handheld, slow
// motion, a whip — what a path can't hold.
//
// Rack focus is not here on purpose: it needs a second focus target the
// rig does not have yet.
//
// Pure and relative-import only: the page and the tests share it.

import type { Vec3 } from "./set-spec";
import { SET_LIMITS } from "./set-spec";
import type { FilmPose } from "./film";

export const FILM_MOVES = [
  "push-in",
  "pull-out",
  "hold",
  "arc-left",
  "arc-right",
  "orbit-90",
  "crane-up",
  "crane-down",
  "rise-reveal",
  "truck-left",
  "truck-right",
  "tilt-up",
  "low-hero",
  "dolly-zoom",
] as const;
export type FilmMove = (typeof FILM_MOVES)[number];

export function isFilmMove(v: unknown): v is FilmMove {
  return typeof v === "string" && (FILM_MOVES as readonly string[]).includes(v);
}

export const FILM_TEXTURES = ["handheld", "slow-motion", "whip-pan"] as const;
export type FilmTexture = (typeof FILM_TEXTURES)[number];

export function isFilmTexture(v: unknown): v is FilmTexture {
  return typeof v === "string" && (FILM_TEXTURES as readonly string[]).includes(v);
}

/** The one sentence each move gives the video model about the path between the frames. */
export const FILM_MOVE_WORDS: Record<FilmMove, string> = {
  "push-in": "Camera: one slow, steady push in toward the person.",
  "pull-out": "Camera: one slow, steady pull back away from the person, revealing more of the place.",
  hold: "Camera: locked off and still; only the person and the place move.",
  "arc-left": "Camera: a smooth arc to the left around the person, keeping them centred.",
  "arc-right": "Camera: a smooth arc to the right around the person, keeping them centred.",
  "orbit-90": "Camera: a steady quarter orbit around the person, keeping them centred the whole way.",
  "crane-up": "Camera: a smooth crane up, rising above the person while it keeps them in frame.",
  "crane-down": "Camera: a smooth crane down from above, settling toward the person's eye level.",
  "rise-reveal": "Camera: rises and pulls back at once, revealing the whole place around the person.",
  "truck-left": "Camera: a smooth sideways track to the left, parallel to the person.",
  "truck-right": "Camera: a smooth sideways track to the right, parallel to the person.",
  "tilt-up": "Camera: stays where it stands and tilts slowly up, from the person to what rises above them.",
  "low-hero": "Camera: low near the ground, looking up, pushing slowly toward the person.",
  "dolly-zoom":
    "Camera: a dolly zoom — pulling back while zooming in, so the person keeps the same size in frame while the background seems to swell and close in behind them.",
};

export const FILM_TEXTURE_WORDS: Record<FilmTexture, string> = {
  handheld: "The camera is handheld: a gentle, human sway and small corrections throughout.",
  "slow-motion": "Everything moves in slow motion, weightless and drawn out.",
  "whip-pan": "The move ends in a fast whip: a sharp blur of motion that settles on the last frame.",
};

/** The subject's centre the moves turn round: the mark at chest height. */
const SUBJECT_Y = 1.25;
/** Eye height the person's face is at, for moves that look up at it. */
const FACE_Y = 1.6;

const DEG = Math.PI / 180;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;

type Reach = { halfX: number; halfZ: number; height: number };

/** The camera held to where a saved layout may keep it (normaliseSetLayout: the set's own bounds plus 10 m). */
function hold(p: Vec3, reach: Reach): Vec3 {
  const rx = reach.halfX + 10;
  const rz = reach.halfZ + 10;
  return [r3(Math.min(rx, Math.max(-rx, p[0]))), r3(Math.min(reach.height * 2, Math.max(0.2, p[1]))), r3(Math.min(rz, Math.max(-rz, p[2])))];
}

const clampFov = (fov: number) => r2(Math.min(SET_LIMITS.maxFovDeg, Math.max(SET_LIMITS.minMatchFovDeg, fov)));

/**
 * The end of a beat that makes `move` from `from`, round the figure on its
 * mark. Distances are measured on the ground from the mark; the camera keeps
 * its height unless the move is about height. Everything stays inside the
 * set's reach, and a lens inside the stage's range.
 */
export function layMove(
  move: FilmMove,
  from: FilmPose,
  mark: { x: number; z: number },
  bounds: { x: number; z: number; height: number },
): FilmPose {
  const reach: Reach = { halfX: bounds.x / 2, halfZ: bounds.z / 2, height: bounds.height };
  const subject: Vec3 = [mark.x, SUBJECT_Y, mark.z];
  const dx = from.position[0] - mark.x;
  const dz = from.position[2] - mark.z;
  let dist = Math.hypot(dx, dz);
  // A camera standing on the mark has no bearing: it takes the one it looks along, reversed.
  const bearing = dist > 0.05 ? Math.atan2(dx, dz) : Math.atan2(from.position[0] - from.target[0], from.position[2] - from.target[2]);
  if (dist < 0.05) dist = 2;
  const y = from.position[1];
  const place = (b: number, d: number, h: number): Vec3 => hold([mark.x + Math.sin(b) * d, h, mark.z + Math.cos(b) * d], reach);
  const aimed = (position: Vec3, target: Vec3 = subject, fovDeg = from.fovDeg): FilmPose => ({ position, target, fovDeg: clampFov(fovDeg) });

  switch (move) {
    case "push-in":
      return aimed(place(bearing, Math.max(0.9, dist * 0.55), y));
    case "pull-out":
      return aimed(place(bearing, dist * 1.8, y));
    case "hold":
      return { position: [...from.position] as Vec3, target: [...from.target] as Vec3, fovDeg: from.fovDeg };
    case "arc-left":
      // Left as the camera sees it: its right-hand side lies toward a larger
      // bearing (screen right is the view turned 90° clockwise from above,
      // set-shot-prompt.ts), so an arc to the left turns the bearing down.
      return aimed(place(bearing - 35 * DEG, dist, y));
    case "arc-right":
      return aimed(place(bearing + 35 * DEG, dist, y));
    case "orbit-90":
      return aimed(place(bearing + 90 * DEG, dist, y));
    case "crane-up":
      return aimed(place(bearing, dist, Math.min(bounds.height * 2, y + 2.5)));
    case "crane-down":
      // From above down to eye level; from eye level, down toward the floor.
      return aimed(place(bearing, dist, y > 2 ? 1.5 : Math.max(0.5, y - 1.2)), [mark.x, FACE_Y, mark.z]);
    case "rise-reveal":
      return aimed(place(bearing, dist * 1.6, Math.min(bounds.height * 2, y + 3)));
    case "truck-left":
    case "truck-right": {
      // Sideways, parallel to the view: camera and aim move together.
      const side = move === "truck-left" ? -1 : 1;
      const view = Math.atan2(from.target[0] - from.position[0], from.target[2] - from.position[2]);
      // Screen right of a camera looking along bearing v is v − 90° here (x = sin, z = cos).
      const right = view - 90 * DEG;
      const step = 1.6 * side;
      const sx = Math.sin(right) * step;
      const sz = Math.cos(right) * step;
      const position = hold([from.position[0] + sx, y, from.position[2] + sz], reach);
      return aimed(position, [r3(from.target[0] + sx), from.target[1], r3(from.target[2] + sz)]);
    }
    case "tilt-up": {
      const up = dist * Math.tan(25 * DEG);
      return aimed([...from.position] as Vec3, [r3(from.target[0]), r3(from.target[1] + up), r3(from.target[2])]);
    }
    case "low-hero":
      return aimed(place(bearing, Math.max(1, dist * 0.8), 0.35), [mark.x, FACE_Y, mark.z]);
    case "dolly-zoom": {
      // She keeps her size: distance ÷ tan(fov / 2) is held, so the camera
      // backs off 3.5× while the lens closes in. Where the lens meets the
      // stage's longest, the distance gives way instead.
      const t0 = Math.tan((from.fovDeg * DEG) / 2) * dist;
      let back = dist * 3.5;
      let fov = (2 * Math.atan(t0 / back)) / DEG;
      if (fov < SET_LIMITS.minMatchFovDeg) {
        fov = SET_LIMITS.minMatchFovDeg;
        back = t0 / Math.tan((fov * DEG) / 2);
      }
      return aimed(place(bearing, back, y), subject, fov);
    }
  }
}

const lerp = (x: number, y: number, t: number) => x + (y - x) * t;
const lerpV = (p: Vec3, q: Vec3, t: number): Vec3 => [lerp(p[0], q[0], t), lerp(p[1], q[1], t), lerp(p[2], q[2], t)];
const TAU = Math.PI * 2;

/**
 * The camera part-way through a beat's move, `e` from 0 (where it starts)
 * to 1 (where it ends) — the path Play the move flies. A straight line is
 * the move for most of them, not for all. An arc and an orbit go ROUND the
 * person, turning about the point the move aims at: a straight line cuts
 * the chord instead, and halfway through a quarter orbit that passes 29%
 * closer, so she swells and shrinks where the camera should circle her. A
 * dolly zoom HOLDS her size the whole way (distance × tan(fov / 2), as
 * layMove lays it), which a lens and a distance eased on their own do not.
 * Both ends are exactly the beat's, whatever the move, and a pose too close
 * to the point it turns about keeps the straight line.
 */
export function poseAlong(move: FilmMove | null, a: FilmPose, b: FilmPose, e: number): FilmPose {
  const straight: FilmPose = {
    position: lerpV(a.position, b.position, e),
    target: lerpV(a.target, b.target, e),
    fovDeg: lerp(a.fovDeg, b.fovDeg, e),
  };
  const cx = b.target[0];
  const cz = b.target[2];
  const ground = (p: Vec3) => Math.hypot(p[0] - cx, p[2] - cz);
  if (move === "arc-left" || move === "arc-right" || move === "orbit-90") {
    const r0 = ground(a.position);
    const r1 = ground(b.position);
    if (r0 < 0.05 || r1 < 0.05) return straight;
    const t0 = Math.atan2(a.position[0] - cx, a.position[2] - cz);
    const t1 = Math.atan2(b.position[0] - cx, b.position[2] - cz);
    // The short way round: every arc in the library turns less than half a circle.
    const turn = ((((t1 - t0 + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
    const th = t0 + turn * e;
    const r = lerp(r0, r1, e);
    return { ...straight, position: [cx + Math.sin(th) * r, straight.position[1], cz + Math.cos(th) * r] };
  }
  if (move === "dolly-zoom") {
    const d0 = ground(a.position);
    const d1 = ground(b.position);
    const d = ground(straight.position);
    if (d0 < 0.05 || d1 < 0.05 || d < 0.05) return straight;
    const half = (fov: number) => Math.tan((fov * DEG) / 2);
    const size = lerp(half(a.fovDeg) * d0, half(b.fovDeg) * d1, e);
    return { ...straight, fovDeg: (2 * Math.atan(size / d)) / DEG };
  }
  return straight;
}

/** How far a pose stands from the mark on the ground, metres — what the rig's focus reads. */
export function groundDistance(pose: FilmPose, mark: { x: number; z: number }): number {
  return Math.hypot(pose.position[0] - mark.x, pose.position[2] - mark.z);
}

/**
 * Two poses the same to within what the stage itself moves by: 2 cm on
 * either point and a twentieth of a degree of lens. A view set by hand on
 * the end a move already laid is that end, not a new one.
 */
export function samePose(a: FilmPose, b: FilmPose): boolean {
  const near = (x: number, y: number, eps: number) => Math.abs(x - y) <= eps;
  return (
    [0, 1, 2].every((i) => near(a.position[i], b.position[i], 0.02) && near(a.target[i], b.target[i], 0.02)) &&
    near(a.fovDeg, b.fovDeg, 0.05)
  );
}

/**
 * A beat's end for `move`, laid from where the beat starts (layMove), kept
 * clear of what the set built by the stage's own check (`room`: the camera
 * stops 0.3 m short of anything built), and a dolly zoom stopped short
 * re-solving its lens, so she keeps her size (distance × tan(fov / 2)).
 */
export function layBeatMove(
  move: FilmMove,
  from: FilmPose,
  mark: { x: number; z: number },
  bounds: { x: number; z: number; height: number },
  room: (pose: FilmPose) => FilmPose = (pose) => pose,
): FilmPose {
  let end = room(layMove(move, from, mark, bounds));
  if (move === "dolly-zoom") {
    const size = Math.hypot(from.position[0] - mark.x, from.position[2] - mark.z) * Math.tan((from.fovDeg * DEG) / 2);
    const d = Math.hypot(end.position[0] - mark.x, end.position[2] - mark.z);
    if (d > 0.1) end = { ...end, fovDeg: clampFov((2 * Math.atan(size / d)) / DEG) };
  }
  return end;
}

/**
 * The beats with every move laid again from where each beat now starts:
 * the film's opening still's own camera for the first, the beat before for
 * the rest, in order. A move is a path FROM where its beat starts, so once
 * the opening still or an earlier beat changes, the end it was laid to asks
 * the take to join two cameras the move does not: the first real film's
 * "Arc left" had been laid from still 1 (50 mm, 5.5 m) and rendered from
 * still 6 (135 mm, 8.3 m), and the clip cross-faded between them
 * (2026-09-21). A beat framed by hand keeps its end; with no known start
 * (the opening still's camera never recorded) the first beat keeps its end
 * too. The same array back when nothing moved.
 */
export function relayMoves<B extends { end: FilmPose; move: FilmMove | null }>(
  beats: readonly B[],
  start: FilmPose | null,
  mark: { x: number; z: number },
  bounds: { x: number; z: number; height: number },
  room?: (pose: FilmPose) => FilmPose,
): readonly B[] {
  let changed = false;
  const out: B[] = [];
  let from = start;
  for (const beat of beats) {
    let next = beat;
    if (beat.move && from) {
      const end = layBeatMove(beat.move, from, mark, bounds, room);
      if (!samePose(end, beat.end)) {
        next = { ...beat, end };
        changed = true;
      }
    }
    out.push(next);
    from = next.end;
  }
  return changed ? out : beats;
}

/** Past this turn round the figure, a beat framed by hand asks its take for a jump no path is said for. */
export const BEAT_JUMP_TURN_DEG = 20;
/** …or past this factor of the figure's size on screen, growing or shrinking. */
export const BEAT_JUMP_SIZE = 2;

/**
 * Whether a beat with NO move asks its take to cross more of the set than
 * the video engine joins by moving. Two frames it can connect by a camera
 * path it moves between; two views far round the figure, with no path
 * said, it cross-fades between instead. The first real film (2026-09-21):
 * beat 2 went 35° round her and 1.8× closer with no move, and dissolved;
 * beat 3's two ends stood at one bearing with her size held (a dolly
 * zoom's), and came out smooth. The size is distance × tan(fov / 2), as a
 * dolly zoom holds it; a camera almost on the mark has no bearing to turn.
 */
export function beatJumps(from: FilmPose, to: FilmPose, mark: { x: number; z: number }): boolean {
  const d0 = groundDistance(from, mark);
  const d1 = groundDistance(to, mark);
  const size = (p: FilmPose, d: number) => Math.max(0.05, d) * Math.tan((p.fovDeg * DEG) / 2);
  const grow = size(to, d1) / size(from, d0);
  if (grow > BEAT_JUMP_SIZE || grow < 1 / BEAT_JUMP_SIZE) return true;
  if (d0 < 0.3 || d1 < 0.3) return false;
  const b0 = Math.atan2(from.position[0] - mark.x, from.position[2] - mark.z);
  const b1 = Math.atan2(to.position[0] - mark.x, to.position[2] - mark.z);
  const turn = Math.abs(((((b1 - b0 + Math.PI) % TAU) + TAU) % TAU) - Math.PI) / DEG;
  return turn > BEAT_JUMP_TURN_DEG;
}
