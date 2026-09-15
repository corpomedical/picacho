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

const clampFov = (fov: number) => r2(Math.min(SET_LIMITS.maxFovDeg, Math.max(SET_LIMITS.minLayoutFovDeg, fov)));

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
      if (fov < SET_LIMITS.minLayoutFovDeg) {
        fov = SET_LIMITS.minLayoutFovDeg;
        back = t0 / Math.tan((fov * DEG) / 2);
      }
      return aimed(place(bearing, back, y), subject, fov);
    }
  }
}

/** How far a pose stands from the mark on the ground, metres — what the rig's focus reads. */
export function groundDistance(pose: FilmPose, mark: { x: number; z: number }): number {
  return Math.hypot(pose.position[0] - mark.x, pose.position[2] - mark.z);
}
