// Where the Producer's lamp sits (2026-09-25, operator: "The light bulb is
// disturbing some of the buttons", then "Lets make it movable and
// dismissible. Also, if taken to any edge, its lives as an edge tab").
//
// Three places: HOME — the corner the CSS gives it (above the composer's dock
// on a phone, above the tab bar in the app), where it starts and where it
// always flies back to while the sheet is open, since the wheel opens into
// that corner; FREE — wherever it was let go; EDGE — dropped with its rim
// near an edge, it lives there as a slim glowing tab. Free and edge places are
// kept as fractions of the stage, so a resize or a rotated phone keeps it in
// the same part of the screen. The pure half is tested; the storage half is
// per device (a comfort setting, never synced).

export const BULB = 44;
export const TAB_THICK = 12;
export const TAB_LEN = 64;
/** A bulb let go with its rim this close to an edge becomes that edge's tab. */
export const SNAP_GAP = 28;
/** How close to the drop target's centre the bulb's centre must be to hide it. */
export const DISMISS_RADIUS = 52;
const MARGIN = 8;

export type Edge = "left" | "right" | "top" | "bottom";
export type Place = { kind: "home" } | { kind: "free"; x: number; y: number } | { kind: "edge"; edge: Edge; t: number };
/** The part of the screen the lamp may use: the viewport minus the bars at its top and bottom. */
export type Stage = { left: number; top: number; right: number; bottom: number };
export type Box = { left: number; top: number; width: number; height: number };

const EDGES: Edge[] = ["left", "right", "top", "bottom"];

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}
function fraction(v: number): number {
  return clamp(Number.isFinite(v) ? v : 0.5, 0, 1);
}

export function isSideEdge(edge: Edge): boolean {
  return edge === "left" || edge === "right";
}

/** The edge nearest a bulb centred at (cx, cy), and the gap between the bulb's rim and it. */
export function nearestEdge(cx: number, cy: number, s: Stage): { edge: Edge; gap: number } {
  const gaps: [Edge, number][] = [
    ["left", cx - s.left],
    ["right", s.right - cx],
    ["top", cy - s.top],
    ["bottom", s.bottom - cy],
  ];
  let best = gaps[0];
  for (const g of gaps) if (g[1] < best[1]) best = g;
  return { edge: best[0], gap: best[1] - BULB / 2 };
}

/** A dragged bulb stays whole on the stage. */
export function clampCentre(cx: number, cy: number, s: Stage): { cx: number; cy: number } {
  return {
    cx: clamp(cx, s.left + BULB / 2, s.right - BULB / 2),
    cy: clamp(cy, s.top + BULB / 2, s.bottom - BULB / 2),
  };
}

/** Where a bulb let go with its centre at (cx, cy) lives. */
export function settle(cx: number, cy: number, s: Stage): Place {
  const w = Math.max(1, s.right - s.left);
  const h = Math.max(1, s.bottom - s.top);
  const near = nearestEdge(cx, cy, s);
  if (near.gap <= SNAP_GAP) {
    const t = isSideEdge(near.edge) ? (cy - s.top) / h : (cx - s.left) / w;
    return { kind: "edge", edge: near.edge, t: fraction(t) };
  }
  return { kind: "free", x: fraction((cx - s.left) / w), y: fraction((cy - s.top) / h) };
}

/** The lamp's box for a free or edge place (home is the CSS's to decide). */
export function boxFor(place: Exclude<Place, { kind: "home" }>, s: Stage): Box {
  const w = s.right - s.left;
  const h = s.bottom - s.top;
  if (place.kind === "free") {
    const cx = clamp(s.left + place.x * w, s.left + MARGIN + BULB / 2, s.right - MARGIN - BULB / 2);
    const cy = clamp(s.top + place.y * h, s.top + MARGIN + BULB / 2, s.bottom - MARGIN - BULB / 2);
    return { left: cx - BULB / 2, top: cy - BULB / 2, width: BULB, height: BULB };
  }
  if (isSideEdge(place.edge)) {
    const top = clamp(s.top + place.t * h - TAB_LEN / 2, s.top + MARGIN, s.bottom - MARGIN - TAB_LEN);
    return { left: place.edge === "left" ? s.left : s.right - TAB_THICK, top, width: TAB_THICK, height: TAB_LEN };
  }
  const left = clamp(s.left + place.t * w - TAB_LEN / 2, s.left + MARGIN, s.right - MARGIN - TAB_LEN);
  return { left, top: place.edge === "top" ? s.top : s.bottom - TAB_THICK, width: TAB_LEN, height: TAB_THICK };
}

/** Where the "drop here to hide" target sits: bottom centre, clear of the bottom bar. */
export function dismissTarget(s: Stage): { cx: number; cy: number } {
  return { cx: (s.left + s.right) / 2, cy: s.bottom - 72 };
}

export function overDismiss(cx: number, cy: number, s: Stage): boolean {
  const t = dismissTarget(s);
  return Math.hypot(cx - t.cx, cy - t.cy) <= DISMISS_RADIUS;
}

/** A stored place, or home when there is none or it isn't one we wrote. */
export function parsePlace(raw: string | null): Place {
  if (!raw) return { kind: "home" };
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (p.kind === "free" && typeof p.x === "number" && typeof p.y === "number") {
      return { kind: "free", x: fraction(p.x), y: fraction(p.y) };
    }
    if (p.kind === "edge" && EDGES.includes(p.edge as Edge) && typeof p.t === "number") {
      return { kind: "edge", edge: p.edge as Edge, t: fraction(p.t) };
    }
  } catch {}
  return { kind: "home" };
}

// ---------------------------------------------------------------------------
// This device's choice (localStorage; the Settings row changes it too, and
// tells the lamp through LAMP_EVENT — a storage event never reaches the tab
// that wrote it).

export const LAMP_PLACE_KEY = "picacho.producer.lampPlace";
export const LAMP_HIDDEN_KEY = "picacho.producer.lampHidden";
export const LAMP_EVENT = "picacho:lamp";

export function readLampPlace(): Place {
  try {
    return parsePlace(window.localStorage.getItem(LAMP_PLACE_KEY));
  } catch {
    return { kind: "home" };
  }
}

export function writeLampPlace(place: Place): void {
  try {
    if (place.kind === "home") window.localStorage.removeItem(LAMP_PLACE_KEY);
    else window.localStorage.setItem(LAMP_PLACE_KEY, JSON.stringify(place));
  } catch {}
  window.dispatchEvent(new Event(LAMP_EVENT));
}

export function readLampHidden(): boolean {
  try {
    return window.localStorage.getItem(LAMP_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeLampHidden(hidden: boolean): void {
  try {
    if (hidden) window.localStorage.setItem(LAMP_HIDDEN_KEY, "1");
    else window.localStorage.removeItem(LAMP_HIDDEN_KEY);
  } catch {}
  window.dispatchEvent(new Event(LAMP_EVENT));
}
