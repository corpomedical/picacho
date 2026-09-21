// What the page says about each thing with photos (R1, 2026-09-21): the
// word on its chip, the sentence in its card and under a still, from the
// same plan the shot makes (elements.ts planShotSheets). Pure: the page and
// the tests share it; the words themselves live in the catalogues
// (sets.cast.*), named here by key.

import type { ShotElementStatus } from "./elements";

/** A thing's state on the page: the shot's statuses, plus what the page knows before a shot — a sheet still to draw, one drawing, one the model refused or failed. */
export type ElementState =
  | "rides"
  | "draw"
  | "drawing"
  | "no-room"
  | "alike"
  | "behind"
  | "out"
  | "hidden"
  | "model"
  | "refused"
  | "failed"
  | "loose";

/** The catalogue keys the words come from (sets.cast.*). */
export type CastStatusKey =
  | "stRides"
  | "stRidesLong"
  | "stDrawAtShoot"
  | "stDrawing"
  | "stOut"
  | "stOutBehind"
  | "stOutFrame"
  | "stOutHidden"
  | "stNoRoom"
  | "stNoRoomLong"
  | "stAlike"
  | "stAlikeLong"
  | "stRefused"
  | "stRefusedLong"
  | "stFailed"
  | "stFailedLong"
  | "stModel"
  | "stModelLong"
  | "stLoose"
  | "stLooseLong";

export type StatusWords = { short: CastStatusKey; long: CastStatusKey; params: Record<string, string | number> };

/**
 * The chip's word and the card's sentence for a state. `sheet` and `count`
 * say which sheet rides of how many; `max` is the still's budget; `like` the
 * sheet a too-alike thing stands beside.
 */
export function statusWords(state: ElementState, p: { sheet?: number; count?: number; max?: number; like?: number } = {}): StatusWords {
  switch (state) {
    case "rides":
      return { short: "stRides", long: "stRidesLong", params: { n: p.sheet ?? 1, count: p.count ?? 1 } };
    case "draw":
      return { short: "stRides", long: "stDrawAtShoot", params: {} };
    case "drawing":
      return { short: "stRides", long: "stDrawing", params: {} };
    case "no-room":
      return { short: "stNoRoom", long: "stNoRoomLong", params: { max: p.max ?? 0 } };
    case "alike":
      return { short: "stAlike", long: "stAlikeLong", params: { n: p.like ?? 1 } };
    case "behind":
      return { short: "stOut", long: "stOutBehind", params: {} };
    case "out":
      return { short: "stOut", long: "stOutFrame", params: {} };
    case "hidden":
      return { short: "stOut", long: "stOutHidden", params: {} };
    case "model":
      return { short: "stModel", long: "stModelLong", params: {} };
    case "refused":
      return { short: "stRefused", long: "stRefusedLong", params: {} };
    case "failed":
      return { short: "stFailed", long: "stFailedLong", params: {} };
    case "loose":
      return { short: "stLoose", long: "stLooseLong", params: {} };
  }
}

/** Whether the chip wears the accent: its sheet rides, drawn or about to be. */
export function ridesState(state: ElementState): boolean {
  return state === "rides" || state === "draw" || state === "drawing";
}

/**
 * A thing's state on the page before a shot: the plan's status, then what
 * is known of its sheet — refused or failed when the last try said so,
 * drawing while one runs, still to draw when it rides and is not drawn.
 */
export function pageState(
  status: ShotElementStatus["status"],
  sheet: { drawn: boolean; drawing: boolean; last: "refused" | "failed" | null },
): ElementState {
  if (status === "rode") {
    if (sheet.drawn) return "rides";
    if (sheet.drawing) return "drawing";
    if (sheet.last) return sheet.last;
    return "draw";
  }
  // The page plans as if every sheet were drawn (it draws them at Shoot), so
  // "no-sheet" and "not-sent" only come back from a shot.
  if (status === "no-sheet") return sheet.last ?? "failed";
  if (status === "not-sent") return "failed";
  return status;
}

/**
 * Why a thing's photos did not ride a still, from the shot's answer, or
 * null when there is nothing to say: it rode, or it was not in the frame
 * (nothing of it was drawn to keep).
 */
export function afterShotWhy(status: ShotElementStatus["status"]): CastStatusKey | null {
  switch (status) {
    case "no-room":
      return "stNoRoomLong";
    case "alike":
      return "stAlikeLong";
    case "model":
      return "stModelLong";
    case "no-sheet":
    case "not-sent":
      return "stFailedLong";
    default:
      return null;
  }
}

/** The keys whose sheets must be drawn before a shot: those that ride and are not drawn, in sheet order. */
export function beforeShoot(riding: readonly { key: string; hash: string }[], drawn: ReadonlySet<string> | readonly string[]): string[] {
  const has = drawn instanceof Set ? (h: string) => drawn.has(h) : (h: string) => (drawn as readonly string[]).includes(h);
  return riding.filter((r) => !has(r.hash)).map((r) => r.key);
}
