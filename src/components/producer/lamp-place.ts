// Where the Producer's lamp sits (2026-09-25, operator: "The light bulb is
// disturbing some of the buttons", then "Lets make it movable and
// dismissible. Also, if taken to any edge, its lives as an edge tab"; redrawn
// 2026-09-30, operator: "The light bulb and how it sticks in the corner, the
// animation feels cheap", and he picked "A · Tuck" from the draft).
//
// Four kinds of place. HOME — the bottom-right corner the CSS gives it (above
// the composer's dock on a phone, above the tab bar in the app), where it
// starts and where it always flies while the sheet is open, since the wheel
// opens into that corner. A CORNER — any of the other three, where a throw or
// a drop near it parks the lamp. An EDGE — thrown or dropped at a side, the
// lamp slides half behind it and lives there tucked, its light still on; only
// a side the screen itself ends at can hold a tucked lamp (the screen cuts it
// off there; a top bar or a dock would not), so on a phone that is the left
// and right. FREE — anywhere else it was put down. Free and edge places are
// kept as fractions of the stage, so a resize or a rotated phone keeps it in
// the same part of the screen. The pure half is tested; the storage half is
// per device (a comfort setting, never synced).

export const BULB = 44;
export const RADIUS = BULB / 2;
/** How far a parked lamp sits from the stage's sides (the CSS home's own 20 px). */
export const MARGIN = 20;
/** How much of a tucked lamp stays on the screen. */
export const PEEK = 18;
/** How much further a tucked lamp comes out under a mouse. */
export const PEEK_HOVER = 9;
/** Tucked lamps keep this far (their centre from a corner of the stage) out of the corners. */
export const ALONG_PAD = 96;
/** A lamp whose throw lands this close to two sides parks in that corner. */
export const CORNER_ZONE = 170;
/** A lamp whose throw brings its rim this close to a side tucks into it. */
export const EDGE_ZONE = 34;
/** While dragging, a corner starts to pull from this far (centre to centre). */
export const CORNER_PULL = 150;
/** While dragging, a side starts to pull when the rim is this close. */
export const EDGE_PULL = 66;
/** How far ahead a throw is projected: its speed at the release times this many seconds. */
export const THROW_AHEAD = 0.22;
/** How close to the drop target's centre the lamp's centre must be to hide it. */
export const DISMISS_RADIUS = 52;

export type Edge = "left" | "right" | "top" | "bottom";
export type Corner = "tl" | "tr" | "bl";
export type Place =
  | { kind: "home" }
  | { kind: "corner"; corner: Corner }
  | { kind: "free"; x: number; y: number }
  | { kind: "edge"; edge: Edge; t: number };
/** The part of the screen the lamp may use: the viewport minus the bars at its top and bottom. */
export type Stage = { left: number; top: number; right: number; bottom: number };
export type Point = { x: number; y: number };
/** Which sides of the stage are the screen's own (a lamp can be tucked only there). */
export type Tuckable = Record<Edge, boolean>;

const EDGES: Edge[] = ["left", "right", "top", "bottom"];
const CORNERS: Corner[] = ["tl", "tr", "bl"];

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}
function fraction(v: number): number {
  return clamp(Number.isFinite(v) ? v : 0.5, 0, 1);
}
function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function smooth(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

export function isSideEdge(edge: Edge): boolean {
  return edge === "left" || edge === "right";
}

/** The way from an edge into the page. */
export function inward(edge: Edge): Point {
  if (edge === "right") return { x: -1, y: 0 };
  if (edge === "left") return { x: 1, y: 0 };
  if (edge === "top") return { x: 0, y: 1 };
  return { x: 0, y: -1 };
}

/** The sides of the stage the screen itself ends at, for a viewport of vw × vh. */
export function tuckableSides(s: Stage, vw: number, vh: number): Tuckable {
  return {
    left: s.left <= 0.5,
    right: s.right >= vw - 0.5,
    top: s.top <= 0.5,
    bottom: s.bottom >= vh - 0.5,
  };
}

/** The centre of a parked lamp. The other corners mirror home, which the CSS places. */
export function cornerCentre(corner: Corner, s: Stage, home: Point): Point {
  const left = s.left + MARGIN + RADIUS;
  const top = s.top + MARGIN + RADIUS;
  if (corner === "tl") return { x: left, y: top };
  if (corner === "tr") return { x: home.x, y: top };
  return { x: left, y: home.y };
}

/**
 * The centre of a lamp tucked into an edge at fraction t along it: PEEK px of
 * it on the screen (more while it peeks). On a side the screen doesn't end at,
 * it stays whole beside it instead.
 */
export function dockCentre(edge: Edge, t: number, s: Stage, tuckable: Tuckable, peek = 0): Point {
  const out = tuckable[edge] ? RADIUS - PEEK - peek : -(MARGIN + RADIUS);
  if (isSideEdge(edge)) {
    const y = clamp(s.top + fraction(t) * (s.bottom - s.top), s.top + ALONG_PAD, s.bottom - ALONG_PAD);
    return { x: edge === "right" ? s.right + out : s.left - out, y };
  }
  const x = clamp(s.left + fraction(t) * (s.right - s.left), s.left + ALONG_PAD, s.right - ALONG_PAD);
  return { x, y: edge === "bottom" ? s.bottom + out : s.top - out };
}

/** The centre of a lamp put down in open space, kept whole on the stage. */
export function freeCentre(x: number, y: number, s: Stage): Point {
  return {
    x: clamp(s.left + fraction(x) * (s.right - s.left), s.left + MARGIN + RADIUS, s.right - MARGIN - RADIUS),
    y: clamp(s.top + fraction(y) * (s.bottom - s.top), s.top + MARGIN + RADIUS, s.bottom - MARGIN - RADIUS),
  };
}

/** Where a place is on this stage (home is where the CSS puts it). */
export function placeCentre(place: Place, s: Stage, home: Point, tuckable: Tuckable, peek = 0): Point {
  if (place.kind === "home") return home;
  if (place.kind === "corner") return cornerCentre(place.corner, s, home);
  if (place.kind === "edge") return dockCentre(place.edge, place.t, s, tuckable, peek);
  return freeCentre(place.x, place.y, s);
}

/** Whether a place is a tucked lamp on this stage. */
export function isTucked(place: Place, tuckable: Tuckable): place is { kind: "edge"; edge: Edge; t: number } {
  return place.kind === "edge" && tuckable[place.edge];
}

/**
 * Where a lamp let go at (x, y) moving at (vx, vy) px/s lives: where its throw
 * would carry it (a careful drop lands where it is). Near two sides it parks
 * in that corner; near one side it tucks in there; anywhere else it stays.
 */
export function decide(x: number, y: number, vx: number, vy: number, s: Stage, tuckable: Tuckable): Place {
  const w = Math.max(1, s.right - s.left);
  const h = Math.max(1, s.bottom - s.top);
  const px = clamp(x + vx * THROW_AHEAD, s.left, s.right);
  const py = clamp(y + vy * THROW_AHEAD, s.top, s.bottom);
  const zone = Math.min(CORNER_ZONE, h * 0.28, w * 0.32);
  const dl = px - s.left;
  const dr = s.right - px;
  const dt = py - s.top;
  const db = s.bottom - py;
  // Near two sides, or thrown along one side into a corner (it lands at that
  // side a little way out from the corner, and a corner is what it meant).
  const nx = Math.min(dl, dr);
  const ny = Math.min(dt, db);
  if ((nx < zone && ny < zone) || (nx < zone * 1.35 && ny < zone * 0.35) || (ny < zone * 1.35 && nx < zone * 0.35)) {
    const c = `${dt < db ? "t" : "b"}${dl < dr ? "l" : "r"}`;
    return c === "br" ? { kind: "home" } : { kind: "corner", corner: c as Corner };
  }
  const near = [
    { edge: "right" as Edge, gap: dr },
    { edge: "left" as Edge, gap: dl },
    { edge: "bottom" as Edge, gap: db },
    { edge: "top" as Edge, gap: dt },
  ]
    .filter((e) => tuckable[e.edge])
    .sort((a, b) => a.gap - b.gap)[0];
  if (near && near.gap < RADIUS + EDGE_ZONE) {
    const t = isSideEdge(near.edge) ? (py - s.top) / h : (px - s.left) / w;
    return { kind: "edge", edge: near.edge, t: fraction(t) };
  }
  return { kind: "free", x: fraction((px - s.left) / w), y: fraction((py - s.top) / h) };
}

/** A lamp in the hand, drawn toward a corner or a side it comes near (0 far away, 1 there). */
export type Pull = {
  x: number;
  y: number;
  corner: Corner | "home" | null;
  cornerPull: number;
  edge: Edge | null;
  edgePull: number;
};

export function magnet(x: number, y: number, s: Stage, home: Point, tuckable: Tuckable): Pull {
  let best: { c: Corner | "home"; p: Point; d: number } | null = null;
  const spots: { c: Corner | "home"; p: Point }[] = [
    { c: "home", p: home },
    ...CORNERS.map((c) => ({ c, p: cornerCentre(c, s, home) })),
  ];
  for (const { c, p } of spots) {
    const d = Math.hypot(x - p.x, y - p.y);
    if (d < CORNER_PULL && (!best || d < best.d)) best = { c, p, d };
  }
  if (best) {
    const pull = smooth(1 - best.d / CORNER_PULL);
    return { x: mix(x, best.p.x, pull * 0.32), y: mix(y, best.p.y, pull * 0.32), corner: best.c, cornerPull: pull, edge: null, edgePull: 0 };
  }
  const near = [
    { edge: "left" as Edge, gap: x - s.left - RADIUS },
    { edge: "right" as Edge, gap: s.right - x - RADIUS },
    { edge: "top" as Edge, gap: y - s.top - RADIUS },
    { edge: "bottom" as Edge, gap: s.bottom - y - RADIUS },
  ]
    .filter((e) => tuckable[e.edge])
    .sort((a, b) => a.gap - b.gap)[0];
  if (near && near.gap < EDGE_PULL) {
    const pull = (1 - Math.max(0, near.gap) / EDGE_PULL) ** 2;
    const n = inward(near.edge);
    return { x: x - n.x * pull * 9, y: y - n.y * pull * 9, corner: null, cornerPull: 0, edge: near.edge, edgePull: pull };
  }
  return { x, y, corner: null, cornerPull: 0, edge: null, edgePull: 0 };
}

/** How far the round lamp centred at (x, y) reaches past its furthest-crossed stage side. */
export function overEdge(x: number, y: number, s: Stage): { edge: Edge; over: number } {
  const over: [Edge, number][] = [
    ["right", x + RADIUS - s.right],
    ["left", s.left - (x - RADIUS)],
    ["top", s.top - (y - RADIUS)],
    ["bottom", y + RADIUS - s.bottom],
  ];
  let best = over[0];
  for (const o of over) if (o[1] > best[1]) best = o;
  return { edge: best[0], over: clamp(best[1], 0, BULB) };
}

/**
 * Where the light sits inside a lamp that reaches `over` px past `edge`: in the
 * middle of the part still on the screen, smaller as that part narrows, so a
 * tucked lamp's light never goes out of sight. `vis` is how much of it shows.
 */
export function lensFor(edge: Edge, over: number): { x: number; y: number; scale: number; vis: number } {
  const o = clamp(over, 0, BULB);
  const n = inward(edge);
  const vis = 1 - o / BULB;
  return { x: n.x * o * 0.5, y: n.y * o * 0.5, scale: mix(0.62, 1, smooth(vis * 1.35)), vis };
}

/** Where the "drop here to hide" target sits: bottom centre, clear of the bottom bar. */
export function dismissTarget(s: Stage): Point {
  return { x: (s.left + s.right) / 2, y: s.bottom - 72 };
}

export function overDismiss(x: number, y: number, s: Stage): boolean {
  const t = dismissTarget(s);
  return Math.hypot(x - t.x, y - t.y) <= DISMISS_RADIUS;
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
    if (p.kind === "corner" && CORNERS.includes(p.corner as Corner)) {
      return { kind: "corner", corner: p.corner as Corner };
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
