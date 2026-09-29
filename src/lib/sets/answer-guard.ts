// A new set answer from Astra, parsed and held to the cast (Helios Studio
// stage 9, 2026-09-29 — operator picked "Protect cars too"). Stage 8 cut a
// repeat back when its last copy stood on one of the cast's marks
// (marks.ts trimRepeatsOnMarks, inside the normaliser). A car, a vehicle or
// another thing of the cast with no mark under it was not protected: the
// race track's stray 20 m wall stood through half its car either way. Here,
// after the normaliser, the same rule is held to the set's things
// (elements.ts): a repeat whose LAST copy blocks a thing its FIRST copy does
// not is cut back to the copies before it. A copy in the middle of a row
// stays. Only answers from Astra come through here (a build or an edit), so
// every set already saved reads back byte for byte. Its own module because
// elements.ts reads set-spec.ts at runtime.
//
// Relative imports only, so the tests import it directly.

import { setElements } from "./elements";
import { blockerAt, blockers, type Blocker } from "./marks";
import { parseSetSpecText, type NormaliseResult, type SetObject, type SetSpec } from "./set-spec";

/**
 * Whether a copy stands in a thing: any of five points of the thing's
 * footprint — its middle, and its corners drawn a quarter of the way in —
 * is inside what the copy blocks (marks.ts blockerAt, the test a mark
 * uses). A dune a towel lies on, or a wall a car only touches, does not.
 */
function standsIn(list: Blocker[], t: { min: number[]; max: number[] }): boolean {
  if (!list.length) return false;
  const cx = (t.min[0] + t.max[0]) / 2, cz = (t.min[2] + t.max[2]) / 2;
  const hx = ((t.max[0] - t.min[0]) / 2) * 0.75, hz = ((t.max[2] - t.min[2]) / 2) * 0.75;
  const points: [number, number][] = [[cx, cz], [cx - hx, cz - hz], [cx + hx, cz - hz], [cx - hx, cz + hz], [cx + hx, cz + hz]];
  return points.some((pt) => blockerAt(pt, list) !== null);
}

/**
 * Cuts back every repeat whose last copy blocks one of the set's things
 * (a car, a vehicle, an object of the cast) that its first copy does not.
 * Only a copy that would block a standing person counts (marks.ts
 * blockers: a kerb, a rug, a low stage never do). A thing the repeat is
 * itself part of is never its own obstacle. Returns the new objects (the
 * same array when nothing changed) and how many repeats were cut.
 */
export function trimRepeatsOnCast(spec: Pick<SetSpec, "objects" | "bounds">, previous?: Pick<SetSpec, "objects">): { objects: SetObject[]; trimmed: number } {
  // An edit hands back the whole set: a repeat it left exactly as it was is the person's set, not this answer's step too far.
  const kept = new Set((previous?.objects ?? []).map(sameRepeat));
  const things = setElements(spec);
  if (!things.length) return { objects: spec.objects as SetObject[], trimmed: 0 };
  let objects = spec.objects as SetObject[];
  let trimmed = 0;
  spec.objects.forEach((o, index) => {
    const count = o.repeat?.count ?? 1;
    if (!o.repeat || count < 2 || kept.has(sameRepeat(o))) return;
    const off = o.repeat.offset;
    const at = (k: number): Blocker[] => blockers([{ ...o, position: [o.position[0] + k * off[0], o.position[1] + k * off[1], o.position[2] + k * off[2]], repeat: null }]);
    const first = at(0), last = at(count - 1);
    if (!last.length) return;
    // A wall along the set's edge is its walls, whatever is mounted on it: only a last copy standing in from
    // the edge (the race track's stood 46 m in) can be the step too far.
    const lx = o.position[0] + (count - 1) * off[0], lz = o.position[2] + (count - 1) * off[2];
    if (Math.min(spec.bounds.x / 2 - Math.abs(lx), spec.bounds.z / 2 - Math.abs(lz)) < EDGE_M) return;
    // A thing the repeat builds is never its obstacle: any thing holding one of its copies (a row of chairs,
    // each seat a copy), or a car or vehicle built from its first copy (its own wheels). A last copy that only
    // joined a car's group because it stands inside the car is exactly what this looks for.
    const own = (t: (typeof things)[number]) =>
      t.members.some(([m, c]) => m === index && (t.kind === "object" || c === 0));
    const hit = things.some((t) => !own(t) && standsIn(last, t) && !standsIn(first, t));
    if (!hit) return;
    if (objects === spec.objects) objects = [...spec.objects];
    objects[index] = { ...o, repeat: count - 1 > 1 ? { count: count - 1, offset: off } : null };
    trimmed++;
  });
  return { objects, trimmed };
}

/** How far in from the set's edge a last copy must stand to be held to the cast. */
export const EDGE_M = 1.5;

/** What makes a repeat the same one: its shape, size, place, turn and repeat. */
function sameRepeat(o: SetObject): string {
  return JSON.stringify([o.shape, o.size, o.position, o.rotation, o.repeat]);
}

/**
 * Astra's answer (a build or an edit) as a set: parsed, normalised as a
 * fresh answer, and held to its cast. `previous`, for an edit, is the copy
 * Astra was handed: a repeat it hands back unchanged is left as it was.
 */
export function parseAstraSetText(text: string, previous?: Pick<SetSpec, "objects">): NormaliseResult {
  const parsed = parseSetSpecText(text);
  if (!parsed.ok) return parsed;
  const cast = trimRepeatsOnCast(parsed.spec, previous);
  if (!cast.trimmed) return parsed;
  return { ok: true, spec: { ...parsed.spec, objects: cast.objects }, notes: [...parsed.notes, "repeat_on_cast_trimmed"] };
}
