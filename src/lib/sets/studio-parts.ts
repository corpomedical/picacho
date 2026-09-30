// The set's own parts in Helios Studio (2026-09-30 — operator: "remove the
// garage and put the car on the road."). Astra answered live that "the
// garage isn't a separate object" and that the scene "doesn't identify the
// asphalt road's position, height, or direction": the Studio drew every
// block of the set that isn't a thing (a car, a prop) as ONE object, "The
// place".
//
// Here the place is split into the parts a person would name — "Track",
// "Kerbs", "Pit garage", "Grandstand", "Barrier" — each its own object in
// the Studio (selectable, hideable, deletable, movable, keyable), and each
// part is described for Astra: what kind of thing it is, the height of its
// top, and for a road its direction and width (studioRoadLayout), so a
// request like "park the car on the road" lands ON the road (placeOnSpot).
//
// How blocks are grouped:
//   - named blocks (SetObject.name, the naming pass) group by their name, as
//     the set page's parts do (elements.ts setParts);
//   - an unnamed block is read by its words (the set's material word, the
//     realism keyword table) and its shape: flat on the ground (a road, its
//     markings, grass, water), low repeats (kerbs), thin and long (a barrier,
//     a wall), tall and thin (posts), big (a building), stepped repeats (a
//     grandstand);
//   - a building keeps the blocks that touch it (its doors, windows, roof,
//     seats) — one building is one object — and a repeat stays one object
//     (every copy of a repeated block is in the same part, with its count);
//   - at most STUDIO_PARTS_MAX parts: the smallest beyond it, and specks,
//     go into "The place (rest)".
//
// Pure and relative-import only: the engine bundle and the tests share it.

import { hslOf, inferGroundMaterial } from "./stage-materials";
import { rotationXYZ } from "./marks";
import { realWord } from "./studio-realism";
import { studioPlaceIndoor } from "./studio-recast";
import type { SetObject, SetSpec, Vec3 } from "./set-spec";

/** The most parts the Studio makes of one set; the rest are one object. */
export const STUDIO_PARTS_MAX = 24;
/** What the smallest parts past the cap, and specks, are kept as. */
export const STUDIO_PART_REST = "The place (rest)";
/** A part smaller than this on every side is a speck: it goes into the rest. */
export const STUDIO_PART_SPECK_M = 0.3;
/** How close two blocks are to count as touching (metres). */
const TOUCH_M = 0.15;

export const STUDIO_PART_KINDS = ["road", "marking", "kerb", "grass", "water", "ground", "hill", "building", "wall", "barrier", "stand", "pole", "tree", "prop"] as const;
export type StudioPartKind = (typeof STUDIO_PART_KINDS)[number];

/** Words in a part's name → its kind. First match wins ("tyre wall" is a barrier before it is a wall). */
export const PART_NAME_KINDS: readonly (readonly [RegExp, StudioPartKind])[] = [
  [/\b(kerbs?|curbs?|rumble ?strips?)\b/i, "kerb"],
  [/\b(lines?|markings?|stripes?|zebra|crossing|grid|arrows?)\b/i, "marking"],
  [/\b(roads?|tracks?|streets?|runways?|lanes?|asphalt|tarmac|circuit|highway|driveway|motorway|avenue|carriageway)\b/i, "road"],
  [/\b(grass|lawn|turf|verges?|field|meadow|park)\b/i, "grass"],
  [/\b(water|pool|pond|lake|sea|river|canal|puddle|fountain)\b/i, "water"],
  [/\b(grandstands?|stands?|bleachers?|seats?|seating|tribunes?|terraces?)\b/i, "stand"],
  [/\b(barriers?|rails?|railings?|guardrails?|armco|fences?|tyre walls?|tire walls?|bollards?|cones?)\b/i, "barrier"],
  [/\b(walls?|facades?|façades?)\b/i, "wall"],
  [/\b(garages?|pits?|buildings?|houses?|shops?|towers?|terminals?|hangars?|sheds?|offices?|halls?|stations?|warehouses?|kiosks?|booths?|cafes?|hotels?|roofs?|canopy|canopies)\b/i, "building"],
  [/\b(poles?|posts?|lamps?|lights?|pylons?|masts?|gantry|gantries|columns?|pillars?|signs?)\b/i, "pole"],
  [/\b(trees?|bush|bushes|hedges?|shrubs?|palms?|plants?)\b/i, "tree"],
  [/\b(dunes?|hills?|mounds?|slopes?|rocks?|cliffs?)\b/i, "hill"],
  [/\b(sidewalks?|pavements?|plaza|square|floor|ground|sand|beach|dirt|gravel|paving|apron|paths?|verge)\b/i, "ground"],
];

/** A part of the set: its blocks ([object, copy]), what it is, and how many copies its most repeated block has. */
export type StudioPart = {
  /** Stable while the set is the same: "part:" and its name in lower case. */
  key: string;
  name: string;
  kind: StudioPartKind;
  members: [number, number][];
  /** The most copies one of its blocks repeats (an Array-like note), 1 when none repeats. */
  repeat: number;
  /** Its box, three.js axes (Y up). */
  min: Vec3;
  max: Vec3;
  /** The rest: the smallest parts past the cap and specks, together. */
  rest?: true;
};

type Copy = { o: number; c: number; min: Vec3; max: Vec3 };

/** One copy of a block as the Studio draws it (a unit shape scaled to its size, turned X then Y then Z): its world box. */
export function copyBox(o: Pick<SetObject, "size" | "position" | "rotation" | "repeat">, copy: number): { min: Vec3; max: Vec3 } {
  const off = o.repeat ? o.repeat.offset : [0, 0, 0];
  const c = [0, 1, 2].map((i) => o.position[i] + off[i] * copy);
  const half = [Math.max(o.size[0], 0.01) / 2, Math.max(o.size[1], 0.01) / 2, Math.max(o.size[2], 0.01) / 2];
  const d = Math.PI / 180;
  const r = rotationXYZ(o.rotation[0] * d, o.rotation[1] * d, o.rotation[2] * d);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const l = [sx * half[0], sy * half[1], sz * half[2]];
    for (let i = 0; i < 3; i++) {
      const v = c[i] + r[i][0] * l[0] + r[i][1] * l[1] + r[i][2] * l[2];
      if (v < min[i]) min[i] = v;
      if (v > max[i]) max[i] = v;
    }
  }
  return { min, max };
}

const touches = (a: { min: Vec3; max: Vec3 }, b: { min: Vec3; max: Vec3 }, eps = TOUCH_M) => {
  for (let i = 0; i < 3; i++) if (a.max[i] < b.min[i] - eps || a.min[i] > b.max[i] + eps) return false;
  return true;
};

/** The ground area two boxes share, each widened by the touching distance (a window flat on a wall still shares a strip). */
const sharedArea = (a: { min: Vec3; max: Vec3 }, b: { min: Vec3; max: Vec3 }) =>
  Math.max(0, Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]) + 2 * TOUCH_M) * Math.max(0, Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]) + 2 * TOUCH_M);

/** A part's kind from its name, or null when no word says it. */
export function partKindOfName(name: string): StudioPartKind | null {
  for (const [re, kind] of PART_NAME_KINDS) if (re.test(name)) return kind;
  return null;
}

/**
 * What an unnamed block is, from its word and shape (its first copy, as
 * turned): flat things on the ground by their colour and word; low repeats
 * are kerbs; thin long blocks are barriers (low) or walls (tall); tall thin
 * ones posts; big ones buildings; a repeat that climbs is a grandstand.
 */
export function blockKind(o: SetObject, first: { min: Vec3; max: Vec3 }): StudioPartKind {
  const W = first.max[0] - first.min[0], H = first.max[1] - first.min[1], D = first.max[2] - first.min[2];
  const lo = Math.min(W, D), hi = Math.max(W, D);
  const onGround = first.min[1] <= 0.25;
  const flat = o.shape === "plane" || (H <= 0.12 && H <= 0.1 * hi && !(H >= 0.08 && hi <= 4 && (o.repeat?.count ?? 1) >= 3));
  const { h, s, l } = hslOf(o.color);
  const word = realWord(o);
  const green = h >= 70 && h <= 160 && s > 0.2;
  const count = o.repeat?.count ?? 1;
  if (flat && onGround) {
    if (word === "water") return "water";
    if (word === "grass" || word === "foliage" || green) return "grass";
    if (lo <= 0.6 || (l >= 0.6 && hi < 8)) return "marking";
    if (word === "asphalt" || (hi >= 8 && l < 0.45 && s < 0.25)) return "road";
    return "ground";
  }
  if (!flat && onGround && H >= 0.04 && H <= 0.35 && hi <= 4 && count >= 3) return "kerb";
  if ((o.shape === "sphere" || o.shape === "cone") && hi >= 6 && (first.min[1] < 0 || ["sand", "earth", "grass", "foliage"].includes(word))) return "hill";
  if (onGround && H <= 0.35 && hi >= 3) return "ground";
  if (word === "foliage" || ((o.shape === "cone" || o.shape === "sphere") && green)) return "tree";
  if (H >= 2 && hi <= 0.7) return "pole";
  const off = o.repeat?.offset;
  if (off && count >= 3 && off[1] > 0.05 && Math.abs(off[0]) + Math.abs(off[2]) > 0.05) return "stand";
  if (onGround && hi >= 3 && hi >= 5 * lo && H >= 0.4) {
    if (H < 2.5) return "barrier";
    if (lo <= 1.5 || hi >= 15 * lo) return "wall";
  }
  if (W * H * D >= 40 && H >= 2.5) return "building";
  return "prop";
}

/** Big enough to hold what touches it together (a building or a wall). */
const isAnchor = (kind: StudioPartKind, first: { min: Vec3; max: Vec3 }, count: number) => {
  const W = first.max[0] - first.min[0], H = first.max[1] - first.min[1], D = first.max[2] - first.min[2];
  return (kind === "building" && W * H * D >= 40 && H >= 2.5) || (kind === "wall" && H >= 2.5 && Math.max(W, D) >= 3 && count <= 2);
};
/** What may join a touching building: doors, windows, roofs, seats, steps, posts. Never a barrier, a kerb, a road or a tree. */
const ATTACHES = new Set<StudioPartKind>(["prop", "stand", "pole", "wall", "building"]);

const PLACE_WORDS = /\b(circuit|race|racing|raceway|speedway|motorsport|grand prix|karting|kart|pit ?lane|paddock|track)\b/i;

/** The words a kind is called by, on this set ("Track" on a circuit, "Road" elsewhere). */
function kindLabel(kind: StudioPartKind, circuit: boolean, ctx: { road: boolean; indoor: boolean; word: string }): string {
  switch (kind) {
    case "road": return circuit ? "Track" : "Road";
    case "marking": return !ctx.road ? "Lines" : circuit ? "Track markings" : "Road markings";
    case "hill": return ctx.word === "sand" ? "Dunes" : "Hills";
    case "kerb": return "Kerbs";
    case "grass": return "Grass";
    case "water": return "Water";
    case "ground": return ctx.indoor || ctx.word === "tile" ? "Floor" : ctx.word === "sand" ? "Sand" : ctx.word === "earth" ? "Dirt" : ctx.word === "cobbles" ? "Cobbles" : ctx.word === "concrete" || ctx.word === "asphalt" ? "Pavement" : "Ground";
    case "building": return "Building";
    case "wall": return "Wall";
    case "barrier": return "Barrier";
    case "stand": return "Grandstand";
    case "pole": return "Posts";
    case "tree": return "Trees";
    default: return "Structure";
  }
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const partKeyOfName = (name: string) => "part:" + name.toLowerCase();

/**
 * The set's parts, in the set's order (by their first block): every block of
 * the set that isn't part of a thing (`inThing`, "object:copy" — the
 * Studio's things, elements.ts setElements) is in exactly one part.
 */
export function studioSetParts(spec: Pick<SetSpec, "objects" | "title" | "description">, inThing: ReadonlySet<string>): StudioPart[] {
  const circuit = PLACE_WORDS.test(`${spec.title || ""} ${spec.description || ""}`);
  const pits = /\bpits?\b|\bpit garages?\b|\bpit ?lane\b/i.test(`${spec.title || ""} ${spec.description || ""}`);
  // Each object's copies that are the set's own.
  const own: { o: number; copies: Copy[]; kind: StudioPartKind; anchor: boolean; vol: number }[] = [];
  spec.objects.forEach((obj, oi) => {
    const n = obj.repeat ? obj.repeat.count : 1;
    const copies: Copy[] = [];
    for (let c = 0; c < n; c++) if (!inThing.has(oi + ":" + c)) copies.push({ o: oi, c, ...copyBox(obj, c) });
    if (!copies.length) return;
    const first = copies[0];
    const named = typeof obj.name === "string" && obj.name.trim() ? partKindOfName(obj.name) : null;
    const kind = named ?? blockKind(obj, first);
    const vol = (first.max[0] - first.min[0]) * (first.max[1] - first.min[1]) * (first.max[2] - first.min[2]);
    own.push({ o: oi, copies, kind, anchor: isAnchor(kind, first, copies.length), vol });
  });

  type Group = { label: string | null; kind: StudioPartKind; objs: typeof own; first: number; big: number; hasDoors: boolean };
  const groups: Group[] = [];
  const groupOf = new Map<number, Group>();
  const join = (g: Group, x: (typeof own)[number]) => { g.objs.push(x); groupOf.set(x.o, g); g.first = Math.min(g.first, x.o); };

  // 1. Named blocks: one part per name.
  const byName = new Map<string, Group>();
  for (const x of own) {
    const name = spec.objects[x.o].name?.trim();
    if (!name) continue;
    const k = name.toLowerCase();
    let g = byName.get(k);
    if (!g) { g = { label: cap(name), kind: x.kind, objs: [], first: x.o, big: 0, hasDoors: false }; byName.set(k, g); groups.push(g); }
    join(g, x);
  }
  // 2. Unnamed anchors (buildings, walls): each its own part, every copy together.
  for (const x of own) {
    if (groupOf.has(x.o) || !x.anchor) continue;
    const g: Group = { label: null, kind: x.kind, objs: [], first: x.o, big: x.vol, hasDoors: false };
    groups.push(g);
    join(g, x);
  }
  // 3. What touches a part joins it (doors, windows, roofs, seats, steps), round after round.
  const boxesOfGroup = (g: Group) => g.objs.flatMap((x) => x.copies);
  const indoor = studioPlaceIndoor(spec.title || "", spec.description || "");
  for (let round = 0; round < 8; round++) {
    let moved = false;
    for (const x of own) {
      if (groupOf.has(x.o) || !ATTACHES.has(x.kind)) continue;
      // The part it rests on most: the ground area its copies share with the blocks they touch (a row of seats joins
      // the stand under it, not a facade one seat brushes; a window joins its facade).
      let best: Group | null = null, bestScore = 0;
      for (const g of groups) {
        if (!ATTACHES.has(g.kind) && g.kind !== "stand") continue;
        let score = 0;
        for (const c of x.copies) for (const b of boxesOfGroup(g)) if (touches(c, b)) score += sharedArea(c, b) + 1e-6;
        if (score > bestScore) { best = g; bestScore = score; }
      }
      if (best) { join(best, x); moved = true; }
    }
    if (!moved) break;
  }
  // 4. The flat things, kerbs and trees: one part per kind (the road's pieces are described by its segments).
  const byKind = new Map<StudioPartKind, Group>();
  for (const x of own) {
    if (groupOf.has(x.o)) continue;
    if (!["road", "marking", "grass", "water", "ground", "hill", "kerb", "tree"].includes(x.kind)) continue;
    let g = byKind.get(x.kind);
    if (!g) { g = { label: null, kind: x.kind, objs: [], first: x.o, big: 0, hasDoors: false }; byKind.set(x.kind, g); groups.push(g); }
    join(g, x);
  }
  // 5. Barriers: each its own part. Everything else: what touches, together.
  for (const x of own) {
    if (groupOf.has(x.o)) continue;
    const g: Group = { label: null, kind: x.kind, objs: [], first: x.o, big: x.vol, hasDoors: false };
    groups.push(g);
    join(g, x);
    if (x.kind === "barrier") continue;
    for (let grew = true; grew; ) {
      grew = false;
      for (const y of own) {
        if (groupOf.has(y.o) || y.kind === "barrier" || !ATTACHES.has(y.kind)) continue;
        const gb = boxesOfGroup(g);
        if (y.copies.some((c) => gb.some((b) => touches(c, b)))) { join(g, y); grew = true; }
      }
    }
  }

  // Each group's kind: a grandstand when it has one; a building's repeated thin panels are its garage doors.
  for (const g of groups) {
    if (g.label && partKindOfName(g.label)) { g.kind = partKindOfName(g.label)!; continue; }
    // The kind of the block it grew from (a wall that holds a ceiling is still a wall), a grandstand when it has steps.
    if (g.objs.length > 1 && g.objs.some((x) => x.kind === "stand")) g.kind = "stand";
    g.hasDoors = g.objs.some((x) => {
      const o = spec.objects[x.o], f = x.copies[0];
      const W = f.max[0] - f.min[0], H = f.max[1] - f.min[1], D = f.max[2] - f.min[2];
      return (o.repeat?.count ?? 1) >= 3 && f.min[1] <= 0.5 && Math.min(W, D) <= 0.3 && H >= 2 && Math.max(W, D) >= 2;
    });
  }

  // The parts, with names: the set's own, else the kind's words, numbered when a name is taken.
  const taken = new Set(groups.filter((g) => g.label).map((g) => g.label!.toLowerCase()));
  const nameFor = (base: string) => {
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
    taken.add(name.toLowerCase());
    return name;
  };
  groups.sort((a, b) => a.first - b.first);
  const hasRoad = groups.some((g) => g.kind === "road");
  const garages = /\bgarages?\b|\bpits?\b/i.test(`${spec.title || ""} ${spec.description || ""}`);
  let parts: StudioPart[] = groups.map((g) => {
    const members = g.objs.flatMap((x) => x.copies.map((c) => [c.o, c.c] as [number, number])).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const boxes = g.objs.flatMap((x) => x.copies);
    const min = [0, 1, 2].map((i) => Math.min(...boxes.map((b) => b.min[i]))) as Vec3;
    const max = [0, 1, 2].map((i) => Math.max(...boxes.map((b) => b.max[i]))) as Vec3;
    const main = spec.objects[[...g.objs].sort((a, b) => b.vol - a.vol)[0].o];
    // A patch of ground is read the way the stage reads a set's ground: sand, earth, cobbles, tile or concrete.
    const word = g.kind === "ground" || g.kind === "hill" ? main.material ?? inferGroundMaterial(main) : realWord(main);
    const label = g.label ?? (g.kind === "building" && g.hasDoors && garages ? (circuit && pits ? "Pit garage" : "Garages") : g.kind === "pole" && g.objs.some((x) => spec.objects[x.o].emissive) ? "Lamps" : kindLabel(g.kind, circuit, { road: hasRoad, indoor, word }));
    const name = g.label ? g.label : nameFor(label);
    return { key: partKeyOfName(name), name, kind: g.kind, members, repeat: Math.max(1, ...g.objs.map((x) => x.copies.length)), min, max };
  });

  // Specks and the smallest past the cap: the rest.
  const size = (p: StudioPart) => Math.max(p.max[0] - p.min[0], p.max[1] - p.min[1], p.max[2] - p.min[2]);
  const vol = (p: StudioPart) => (p.max[0] - p.min[0]) * Math.max(0.05, p.max[1] - p.min[1]) * (p.max[2] - p.min[2]);
  const speck = (p: StudioPart) => size(p) < STUDIO_PART_SPECK_M;
  let rest = parts.filter(speck);
  parts = parts.filter((p) => !speck(p));
  if (parts.length + (rest.length ? 1 : 0) > STUDIO_PARTS_MAX) {
    const keep = new Set([...parts].sort((a, b) => vol(b) - vol(a)).slice(0, STUDIO_PARTS_MAX - 1));
    rest = [...rest, ...parts.filter((p) => !keep.has(p))];
    parts = parts.filter((p) => keep.has(p));
  }
  if (rest.length) {
    const members = rest.flatMap((p) => p.members).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const min = [0, 1, 2].map((i) => Math.min(...rest.map((p) => p.min[i]))) as Vec3;
    const max = [0, 1, 2].map((i) => Math.max(...rest.map((p) => p.max[i]))) as Vec3;
    parts.push({ key: partKeyOfName(STUDIO_PART_REST), name: STUDIO_PART_REST, kind: "prop", members, repeat: 1, min, max, rest: true });
  }
  return parts;
}

// ---------------------------------------------------------------------------
// A part as Astra reads it
// ---------------------------------------------------------------------------

/** One block of a part as it stands now (three.js axes): its centre, its sides along its own X and Z on the ground, its X axis on the ground, and its top. */
export type PartBlock = { c: Vec3; lenX: number; lenZ: number; ax: [number, number]; top: number };

const r1 = (v: number) => { const x = Math.round(v * 10) / 10; return Object.is(x, -0) ? 0 : x; };
const r2 = (v: number) => { const x = Math.round(v * 100) / 100; return Object.is(x, -0) ? 0 : x; };

/** A road's layout in Blender axes (X right, Y away): the way it runs (a unit [x, y], pointing away or right), its width and length, and each piece's centre line when it has several. */
export type RoadLayout = { along: [number, number]; width: number; length: number; segs?: [number, number, number, number, number][] };

/** The long axis of one block on the ground (three.js x, z), its length and width. */
function longAxis(b: PartBlock): { u: [number, number]; len: number; wid: number } {
  const x: [number, number] = b.ax, z: [number, number] = [-b.ax[1], b.ax[0]];
  // three.js: turning by y maps local X to (cos, −sin) and local Z to (sin, cos) on (x, z) — perpendicular either way.
  return b.lenX >= b.lenZ ? { u: x, len: b.lenX, wid: b.lenZ } : { u: z, len: b.lenZ, wid: b.lenX };
}
/** A direction on the ground in Blender axes, turned to point away (+Y) or, across, right (+X). */
function blenderDir(u: [number, number]): [number, number] {
  let x = u[0], y = -u[1];
  if (y < -1e-6 || (Math.abs(y) <= 1e-6 && x < 0)) { x = -x; y = -y; }
  return [r2(x), r2(y)];
}

export function studioRoadLayout(blocks: readonly PartBlock[]): RoadLayout | null {
  if (!blocks.length) return null;
  const ranked = [...blocks].sort((a, b) => Math.max(b.lenX, b.lenZ) * Math.min(b.lenX, b.lenZ) - Math.max(a.lenX, a.lenZ) * Math.min(a.lenX, a.lenZ));
  const main = longAxis(ranked[0]);
  const out: RoadLayout = { along: blenderDir(main.u), width: r1(main.wid), length: r1(main.len) };
  if (blocks.length > 1) {
    out.segs = ranked.slice(0, 8).map((b) => {
      // From its near end to its far end (the way `along` points: away, or right).
      const a = longAxis(b);
      const d = blenderDir(a.u), h = a.len / 2, cx = b.c[0], cy = -b.c[2];
      return [r1(cx - d[0] * h), r1(cy - d[1] * h), r1(cx + d[0] * h), r1(cy + d[1] * h), r1(a.wid)];
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Putting a thing on a part's top ("park the car on the road")
// ---------------------------------------------------------------------------

/** A top to stand things on (three.js axes): a block's centre on the ground, its long axis, its length and width, and the height of its top. */
export type PlaceSurface = { c: [number, number]; u: [number, number]; len: number; wid: number; top: number };
export type PlaceBox = { min: Vec3; max: Vec3 };

/** The top surfaces of a part: its blocks whose tops are within 0.3 m of its highest, big enough to stand on. */
export function surfacesOf(blocks: readonly PartBlock[]): PlaceSurface[] {
  if (!blocks.length) return [];
  const top = Math.max(...blocks.map((b) => b.top));
  return blocks
    .filter((b) => b.top >= top - 0.3 && Math.min(b.lenX, b.lenZ) >= 0.2)
    .map((b) => { const a = longAxis(b); return { c: [b.c[0], b.c[2]] as [number, number], u: a.u, len: a.len, wid: a.wid, top: b.top }; });
}

export type PlaceOnInput = {
  surfaces: readonly PlaceSurface[];
  /** The thing's own footprint: its long side, short side, height, and its long axis on the ground now (three.js x, z). */
  foot: { len: number; wid: number; h: number; dir: [number, number] };
  /** "along": its long side down the surface's; "across": across it; null: it keeps its heading. */
  align: "along" | "across" | null;
  /** Where to be as close to as the surface allows (three.js x, z). */
  near: [number, number];
  /** What it must not overlap (other things, walls, the set's blocks that stand above the top). */
  obstacles: readonly PlaceBox[];
  /** Metres kept from each edge of the surface. */
  margin?: number;
  /** Whether a spot is seen from the shot camera; spots it sees win among near ones. */
  visible?: (box: PlaceBox) => boolean;
};
export type PlaceOnResult = { at: Vec3; dir: [number, number]; box: PlaceBox; surface: number; seen: boolean };

/**
 * The spot on one of the surfaces nearest `near` where the footprint fits
 * inside the edges and overlaps nothing that stands above the top, turned as
 * asked (the direction closest to its heading now, so a car keeps facing its
 * way). Null when no surface has room.
 */
export function placeOnSpot(i: PlaceOnInput): PlaceOnResult | null {
  const margin = i.margin ?? 0.15;
  const cands: { at: Vec3; dir: [number, number]; box: PlaceBox; d: number; surface: number }[] = [];
  i.surfaces.forEach((s, si) => {
    const u = s.u, v: [number, number] = [-u[1], u[0]];
    // The thing's direction on this surface.
    let dir: [number, number];
    if (i.align === "along" || i.align === "across") {
      const a = i.align === "along" ? u : v;
      dir = a[0] * i.foot.dir[0] + a[1] * i.foot.dir[1] >= 0 ? [a[0], a[1]] : [-a[0], -a[1]];
    } else dir = [i.foot.dir[0], i.foot.dir[1]];
    const side: [number, number] = [-dir[1], dir[0]];
    // Its half extents along the surface's axes.
    const eu = Math.abs(dir[0] * u[0] + dir[1] * u[1]) * i.foot.len / 2 + Math.abs(side[0] * u[0] + side[1] * u[1]) * i.foot.wid / 2;
    const ev = Math.abs(dir[0] * v[0] + dir[1] * v[1]) * i.foot.len / 2 + Math.abs(side[0] * v[0] + side[1] * v[1]) * i.foot.wid / 2;
    const ru = s.len / 2 - eu - margin, rv = s.wid / 2 - ev - margin;
    if (ru < 0 || rv < 0) return;
    // World half extents of the turned footprint (a box round it).
    const hx = Math.abs(dir[0]) * i.foot.len / 2 + Math.abs(side[0]) * i.foot.wid / 2;
    const hz = Math.abs(dir[1]) * i.foot.len / 2 + Math.abs(side[1]) * i.foot.wid / 2;
    const stepU = Math.max(0.25, (2 * ru) / 240), stepV = Math.max(0.25, (2 * rv) / 60);
    // Start from the point on the surface nearest `near`, and walk out from it.
    const rel = [i.near[0] - s.c[0], i.near[1] - s.c[1]];
    const nu = Math.max(-ru, Math.min(ru, rel[0] * u[0] + rel[1] * u[1]));
    const nv = Math.max(-rv, Math.min(rv, rel[0] * v[0] + rel[1] * v[1]));
    const us: number[] = [], vs: number[] = [];
    for (let a = -ru; a <= ru + 1e-9; a += stepU) us.push(a);
    for (let b = -rv; b <= rv + 1e-9; b += stepV) vs.push(b);
    us.push(nu); vs.push(nv);
    for (const a of us) for (const b of vs) {
      const x = s.c[0] + u[0] * a + v[0] * b, z = s.c[1] + u[1] * a + v[1] * b;
      const box: PlaceBox = { min: [x - hx, s.top, z - hz], max: [x + hx, s.top + i.foot.h, z + hz] };
      cands.push({ at: [x, s.top, z], dir, box, d: Math.hypot(x - i.near[0], z - i.near[1]), surface: si });
    }
  });
  cands.sort((p, q) => p.d - q.d);
  const clear = (b: PlaceBox) => !i.obstacles.some((o) => o.max[1] > b.min[1] + 0.05 && o.min[1] < b.max[1] - 0.02 && o.max[0] > b.min[0] + 0.02 && o.min[0] < b.max[0] - 0.02 && o.max[2] > b.min[2] + 0.02 && o.min[2] < b.max[2] - 0.02);
  let firstClear: (typeof cands)[number] | null = null;
  let tried = 0;
  for (const c of cands) {
    if (!clear(c.box)) continue;
    if (!firstClear) firstClear = c;
    if (!i.visible) break;
    // A spot the camera sees, among the near ones (up to 20 clear spots, and no more than 6 m further than the nearest).
    if (i.visible(c.box)) return { at: c.at, dir: c.dir, box: c.box, surface: c.surface, seen: true };
    if (++tried >= 20 || c.d > firstClear.d + 6) break;
  }
  return firstClear ? { at: firstClear.at, dir: firstClear.dir, box: firstClear.box, surface: firstClear.surface, seen: !i.visible } : null;
}

// ---------------------------------------------------------------------------
// A saved scene's parts
// ---------------------------------------------------------------------------

/**
 * Whether a part missing from a saved scene was deleted there. A scene saved
 * with parts lists the ones it knew (`partKeys`): missing and listed =
 * deleted; missing and not listed = new since (the set was edited) and kept.
 * A scene from before parts (no list) had one "The place": its parts are
 * there when it was, and all gone when it had been deleted.
 */
export function partGoneInSaved(key: string, saved: { keys: ReadonlySet<string>; partKeys: readonly string[] | null; hadPlace: boolean }): boolean {
  if (saved.keys.has(key)) return false;
  return saved.partKeys ? saved.partKeys.includes(key) : !saved.hadPlace;
}

/** A part's blocks as the spec places them (every copy; turned about Y only, as a set's flat pieces are): what the engine reads off its meshes, for the tests and the server. */
export function specPartBlocks(spec: Pick<SetSpec, "objects">, part: Pick<StudioPart, "members">): PartBlock[] {
  return part.members.map(([oi, c]) => {
    const o = spec.objects[oi];
    const off = o.repeat ? o.repeat.offset : [0, 0, 0];
    const ry = (o.rotation[1] * Math.PI) / 180;
    return {
      c: [o.position[0] + off[0] * c, o.position[1] + off[1] * c, o.position[2] + off[2] * c] as Vec3,
      lenX: Math.max(o.size[0], 0.01),
      lenZ: Math.max(o.size[2], 0.01),
      ax: [Math.cos(ry), -Math.sin(ry)] as [number, number],
      top: copyBox(o, c).max[1],
    };
  });
}
