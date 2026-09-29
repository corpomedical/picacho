// Helios Studio on phones and tablets (stage 6, 2026-09-29 — operator:
// "Pushed, keep going."). Blender-on-iPad style: the viewport takes the
// screen; the Outliner, Properties, Astra and the Timeline become bottom
// sheets switched from a tab row, each with a grip that drags between half
// and full height. Nothing is hidden, only moved. Pure, for the engine and
// the tests.

/**
 * When the Studio uses the compact layout: narrow windows, and touch
 * screens up to a large tablet's width. A desktop window (fine pointer,
 * wider than 1100 px) keeps the desktop layout exactly.
 */
export const STUDIO_COMPACT_QUERY = "(max-width: 1100px), (pointer: coarse) and (max-width: 1366px)";

/** Hold this long without moving to open the context menu by touch. */
export const LONG_PRESS_MS = 550;
/** A finger that moves further than this is orbiting, not pressing. */
export const LONG_PRESS_SLOP_PX = 10;
/** A grip moved less than this is a tap (half ↔ full). */
export const GRIP_TAP_PX = 6;

export type SheetSize = "closed" | "half" | "full";

/** A sheet's two heights in the space between the top bar and the tab row. */
export function sheetHeights(room: number): { half: number; full: number; min: number } {
  const full = Math.max(160, Math.round(room - 8));
  return { half: Math.max(160, Math.round(room * 0.5)), full, min: 120 };
}

/**
 * Where a dragged sheet settles: below a quarter of the room it closes,
 * above three quarters it goes full, otherwise half.
 */
export function sheetSnap(height: number, room: number): SheetSize {
  if (height < room * 0.25) return "closed";
  if (height > room * 0.75) return "full";
  return "half";
}

/** The height while dragging: the start height minus how far the finger went down, kept inside the room. */
export function sheetDragHeight(startHeight: number, dy: number, room: number): number {
  return Math.round(Math.min(room, Math.max(0, startHeight - dy)));
}

/** The sheet a tab opens: the same tab again closes it. */
export function nextSheet(current: string, tapped: string): string {
  return current === tapped ? "" : tapped;
}
