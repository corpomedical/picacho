// A tap on the stage, and which thing it touched (the per-thing reference
// photos, 2026-09-21). The stage orbits, pans and drags the figure with the
// same pointer, so a tap is only a press that neither moved past a small
// slop nor lasted long, with no second finger down. What it touched is the
// nearest hit that belongs to a thing: the figure, or a block of one of
// the set's elements (elements.ts). The ground and the sky are nothing; a
// block of the set itself (a wall, the track) is structure.
//
// Pure and relative-import only: the page and the tests share it.

/** How far a press may travel and still be a tap, by pointer: set-editor's 5 px on a mouse, more for a finger. */
export const TAP_SLOP_PX = { mouse: 5, pen: 6, touch: 10 } as const;
/** A press held longer than this is not a tap. */
export const TAP_MAX_MS = 600;
/** A tap on the figure waits this long, so a double-click (frame the figure) wins over it. */
export const FIGURE_TAP_WAIT_MS = 280;
/** How far past a thumbnail's box a tap still lands on it, by pointer precision. */
export const BADGE_HIT_SLOP_PX = { fine: 6, coarse: 12 } as const;

export type TapStart = { id: number; type: string; x: number; y: number; t: number };

/** Whether a press that went down as `s` and came up as `up` was a tap. */
export function isTap(s: TapStart, up: { id: number; x: number; y: number; t: number }, otherPointerWentDown: boolean): boolean {
  if (otherPointerWentDown || up.id !== s.id) return false;
  const slop = s.type === "touch" ? TAP_SLOP_PX.touch : s.type === "pen" ? TAP_SLOP_PX.pen : TAP_SLOP_PX.mouse;
  if (Math.hypot(up.x - s.x, up.y - s.y) > slop) return false;
  return up.t - s.t <= TAP_MAX_MS;
}

/** One ray hit on the stage, as the page reads it off three.js. */
export type StageHit = { oi: number | null; copy: number | null; figure: boolean; ground: boolean; sky: boolean; distance: number };

export type ElementHit = { kind: "element"; key: string } | { kind: "structure" } | null;

/**
 * What a tap touched: the nearest hit that is not sky. The figure is its
 * own element; a block belongs to the element `keyOfCopy` names, or else
 * is structure; the ground (or nothing) is null.
 */
export function elementForHits(hits: readonly StageHit[], keyOfCopy: (oi: number, copy: number) => string | null, figureKey: string): ElementHit {
  const nearest = [...hits].filter((h) => !h.sky).sort((a, b) => a.distance - b.distance)[0];
  if (!nearest || nearest.ground) return null;
  if (nearest.figure) return { kind: "element", key: figureKey };
  if (nearest.oi === null || nearest.copy === null) return null;
  const key = keyOfCopy(nearest.oi, nearest.copy);
  return key ? { kind: "element", key } : { kind: "structure" };
}

/** The thumbnail a tap landed on, by its box on screen grown by `slop`; the last drawn (topmost) wins. */
export function badgeAt(rects: readonly { key: string; left: number; top: number; right: number; bottom: number }[], x: number, y: number, slop: number): string | null {
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i];
    if (x >= r.left - slop && x <= r.right + slop && y >= r.top - slop && y <= r.bottom + slop) return r.key;
  }
  return null;
}
