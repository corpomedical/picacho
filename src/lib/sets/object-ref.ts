// Eye-lines and focus pulls that follow the thing (Helios Cut 4, step A9;
// operator, 2026-09-26: "resume").
//
// An eye-line at one of the set's things (people.ts Gaze) and a beat's rack
// of focus (furniture.ts FilmRack) are stored by BLOCK NUMBER: the index of
// one of the set's objects. An Astra change rewrites the whole set, and a
// rewrite that reorders the objects, or a rebuild that replaces a thing's
// blocks, left that number on whatever block now stands there — the stage
// drew her looking at a barrier and the still's words named its size.
//
// Now a pick keeps the THING too: `key`, its setElements key, beside the
// index, in the same `{at:"object"}` / `{to:"object"}` shape, so code from
// before this step reads the index and ignores the key (rollback-safe,
// critic item 21). When the set changes, the page follows each one here:
// the thing is found again by resolvePhotos' own rules (its exact key; else
// the same blocks moved; else a thing of the same family where it stood),
// and the index moves to that thing's block — the very block when it is
// still there, else one the words name the same (its shape and size), else
// the thing's largest. What was on a block of the set itself (structure has
// no thing and no key) keeps its block where that block can still be told
// apart, and its number otherwise (critic item 7). When the thing is gone,
// the ref is lost, and the page clears it and says so.
//
// A ref stored without a key keeps none: following never adds one, so an
// Undo that brings the set back brings back the very same refs, and a
// saved film keeps its clips. Read from the blocks, never from words.
//
// Pure and relative-import only: the page and the server share it.

import { resolvePhotos, setElements, type SetElement } from "./elements";
import type { FilmRack } from "./furniture";
import type { Gaze } from "./people";
import type { SetObject, SetSpec } from "./set-spec";

export type ObjectRef = { index: number; key?: string };

/** The thing a block is part of (setElements' members), or null: structure is no thing. */
export function thingOfBlock(els: readonly SetElement[], index: number): SetElement | null {
  return els.find((e) => e.members.some(([o]) => o === index)) ?? null;
}

/** A block picked now (a menu, the chat): its number, and the key of the thing it is part of, if any. */
export function keyedRef(index: number, els: readonly SetElement[]): ObjectRef {
  const el = thingOfBlock(els, index);
  return el ? { index, key: el.key } : { index };
}

/**
 * A block picked from a menu, as a stored ref: the ref already there when
 * it is on that very block (a pick of the chosen row changes nothing, so a
 * film beat keeps its clip), else the block with its thing's key.
 */
export function pickedRef<T extends ObjectRef>(current: T | null, index: number, els: readonly SetElement[]): T | ObjectRef {
  return current && current.index === index ? current : keyedRef(index, els);
}

/** Where a thing stands now, by resolvePhotos' rules (exact key, same blocks moved, same family where it stood), or null. */
export function findThingNow(key: string, els: readonly SetElement[]): SetElement | null {
  const held = resolvePhotos(els, [{ refId: "follow", anchor: key, slot: 1, at: 0, url: "" }]).held[0];
  return held ? (els.find((e) => e.key === held.key) ?? null) : null;
}

const sameBlock = (a: SetObject | undefined, b: SetObject | undefined): boolean => a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b);
/** Named alike in the words: the same shape and the same size to the words' one decimal (people.ts, furniture.ts thingWords). */
const namedAlike = (a: SetObject, b: SetObject): boolean => a.shape === b.shape && a.size.every((n, i) => Math.round(n * 10) === Math.round(b.size[i] * 10));

/** The thing's largest block by volume (turn-plan.ts largestObjectOf's rule), or null. */
export function largestBlockOf(el: Pick<SetElement, "members">, objects: readonly Pick<SetObject, "size">[]): number | null {
  let best: number | null = null;
  let volume = -1;
  for (const [o] of el.members) {
    const size = objects[o]?.size;
    if (!size) continue;
    const v = size[0] * size[1] * size[2];
    if (v > volume) {
      volume = v;
      best = o;
    }
  }
  return best;
}

type Side = { spec: Pick<SetSpec, "objects">; els: readonly SetElement[] };

/**
 * A ref after the set changed from `before` to `after`: on the same thing's
 * block, on the same block of the set, or null when what it was on is gone.
 * Its key, if it had one, becomes the thing's key now; a ref with no key
 * keeps none.
 */
export function followObjectRef<T extends ObjectRef>(ref: T, before: Side, after: Side): ObjectRef | null {
  const was: SetObject | undefined = before.spec.objects[ref.index];
  const key = ref.key ?? thingOfBlock(before.els, ref.index)?.key ?? null;
  if (key !== null) {
    const el = findThingNow(key, after.els);
    if (!el) return null;
    const members = [...new Set(el.members.map(([o]) => o))];
    let index: number | null = members.includes(ref.index) && sameBlock(after.spec.objects[ref.index], was) ? ref.index : null;
    if (index === null) index = members.find((o) => sameBlock(after.spec.objects[o], was)) ?? null;
    if (index === null && was) {
      // Named alike, nearest to where the block would stand if the thing moved as a whole.
      const from = before.els.find((e) => e.key === key) ?? thingOfBlock(before.els, ref.index);
      const shift = from ? [0, 1, 2].map((i) => el.centre[i] - from.centre[i]) : [0, 0, 0];
      const aim = [0, 1, 2].map((i) => was.position[i] + shift[i]);
      const dist = (o: number) => Math.hypot(...[0, 1, 2].map((i) => after.spec.objects[o].position[i] - aim[i]));
      const alike = members.filter((o) => namedAlike(after.spec.objects[o], was)).sort((a, b) => dist(a) - dist(b) || a - b);
      index = alike[0] ?? null;
    }
    if (index === null) index = largestBlockOf(el, after.spec.objects);
    if (index === null) return null;
    return ref.key !== undefined ? { index, key: el.key } : { index };
  }
  // A block of the set itself: that block where it stands, else the one
  // block just like it, else its number while the set still has one.
  if (sameBlock(after.spec.objects[ref.index], was)) return { index: ref.index };
  if (was) {
    const like = after.spec.objects.flatMap((o, i) => (sameBlock(o, was) ? [i] : []));
    if (like.length === 1) return { index: like[0] };
  }
  return ref.index < after.spec.objects.length ? { index: ref.index } : null;
}

/** What following the set's change did to the page's eye-line and its film's beats. */
export type FollowedRefs = {
  gaze: Gaze | null;
  beats: { rack: FilmRack | null; gaze: Gaze | null }[];
  /** What was on a thing that is gone, cleared: the eye-line (the page's or a beat's), a beat's focus pull. */
  lost: { gaze: boolean; rack: boolean };
  /** Whether anything differs from what was handed in. */
  changed: boolean;
};

/**
 * The page's eye-line and every beat's focus pull and eye-line, followed
 * from `before` to `after` (followObjectRef). The camera, a point and the
 * figure are untouched. Hands back what it was given, value for value,
 * when nothing moved.
 */
export function followRefs(
  before: Pick<SetSpec, "objects" | "bounds">,
  after: Pick<SetSpec, "objects" | "bounds">,
  gaze: Gaze | null,
  beats: readonly { rack: FilmRack | null; gaze: Gaze | null }[],
): FollowedRefs {
  const b: Side = { spec: before, els: setElements(before) };
  const a: Side = { spec: after, els: setElements(after) };
  const lost = { gaze: false, rack: false };
  const followGaze = (g: Gaze | null): Gaze | null => {
    if (!g || g.at !== "object") return g;
    const ref = followObjectRef(g, b, a);
    if (!ref) {
      lost.gaze = true;
      return null;
    }
    return { at: "object", ...ref };
  };
  const followRack = (r: FilmRack | null): FilmRack | null => {
    if (!r || r.to !== "object") return r;
    const ref = followObjectRef(r, b, a);
    if (!ref) {
      lost.rack = true;
      return null;
    }
    return { to: "object", ...ref };
  };
  const nextGaze = followGaze(gaze);
  const nextBeats = beats.map((x) => ({ rack: followRack(x.rack), gaze: followGaze(x.gaze) }));
  const same = (p: unknown, q: unknown) => JSON.stringify(p) === JSON.stringify(q);
  const changed = !same(nextGaze, gaze) || nextBeats.some((x, i) => !same(x.rack, beats[i].rack) || !same(x.gaze, beats[i].gaze));
  return {
    gaze: same(nextGaze, gaze) ? gaze : nextGaze,
    beats: nextBeats.map((x, i) => ({ rack: same(x.rack, beats[i].rack) ? beats[i].rack : x.rack, gaze: same(x.gaze, beats[i].gaze) ? beats[i].gaze : x.gaze })),
    lost,
    changed,
  };
}

/** The page's eye-line and its film's beats' refs, as followRefs takes and hands them. */
export type RefsState = { gaze: Gaze | null; beats: { rack: FilmRack | null; gaze: Gaze | null }[] };

/**
 * The refs after an Undo takes the set from `from` back to `to`. Where the
 * change being undone followed them (`edit`: the refs as it found them,
 * and as it left them) and nothing has moved one since, that one goes back
 * to exactly what it was — an Undo restores the page as it stood, and a
 * film beat its very ref, so its clip stays its own. One already back to
 * what the change found stays. Anything else, or anything with no record,
 * is followed back like any change (followRefs). `keepGaze`: the page's
 * eye-line is already the one from before the change (a turn's Undo put
 * it back with the rest of the turn) and is left as it is.
 */
export function followRefsBack(
  from: Pick<SetSpec, "objects" | "bounds">,
  to: Pick<SetSpec, "objects" | "bounds">,
  current: RefsState,
  edit: { was: RefsState; now: RefsState } | null,
  keepGaze = false,
): FollowedRefs {
  const back = followRefs(from, to, current.gaze, current.beats);
  const same = (p: unknown, q: unknown) => JSON.stringify(p) === JSON.stringify(q);
  const aligned = edit !== null && current.beats.length === edit.now.beats.length && edit.was.beats.length === edit.now.beats.length;
  const lost = { gaze: false, rack: false };
  function pick<T extends Gaze | FilmRack>(cur: T | null, rec: { now: T | null; was: T | null } | null, followed: T | null, kind: "gaze" | "rack"): T | null {
    if (rec && same(cur, rec.now)) return rec.was;
    if (rec && same(cur, rec.was)) return cur;
    const onThing = cur !== null && ("at" in cur ? cur.at === "object" : cur.to === "object");
    if (onThing && followed === null) lost[kind] = true;
    return followed;
  }
  const gaze = keepGaze ? current.gaze : pick(current.gaze, edit ? { now: edit.now.gaze, was: edit.was.gaze } : null, back.gaze, "gaze");
  const beats = current.beats.map((x, i) => ({
    rack: pick(x.rack, aligned ? { now: edit!.now.beats[i].rack, was: edit!.was.beats[i].rack } : null, back.beats[i].rack, "rack"),
    gaze: pick(x.gaze, aligned ? { now: edit!.now.beats[i].gaze, was: edit!.was.beats[i].gaze } : null, back.beats[i].gaze, "gaze"),
  }));
  const changed = !same(gaze, current.gaze) || beats.some((x, i) => !same(x.rack, current.beats[i].rack) || !same(x.gaze, current.beats[i].gaze));
  return { gaze, beats, lost, changed };
}

/**
 * A ref as the server reads it against the saved set (actions.ts, a still's
 * eye-line and a take's rack and eye-line): when its key names a thing the
 * set has, exactly, and its block is not one of that thing's, the block
 * number drifted (a page that had not seen the change), so it is read as
 * that thing's largest block. Every other ref — no key, a key the set no
 * longer has exactly, a block of that very thing — is read by its number,
 * as before. The words' form never changes.
 */
export function atThingNow<T extends ObjectRef>(ref: T, els: readonly SetElement[], objects: readonly Pick<SetObject, "size">[]): T {
  if (ref.key === undefined) return ref;
  const el = els.find((e) => e.key === ref.key);
  if (!el || el.members.some(([o]) => o === ref.index)) return ref;
  const index = largestBlockOf(el, objects);
  return index === null ? ref : { ...ref, index };
}

/** atThingNow for an eye-line or a focus pull as stored, which may be on no thing at all (the camera, a point, the figure). */
export function onThingNow<T extends Gaze | FilmRack>(r: T | null, els: readonly SetElement[], objects: readonly Pick<SetObject, "size">[]): T | null {
  if (r === null) return null;
  if ("at" in r ? r.at !== "object" : r.to !== "object") return r;
  return atThingNow(r as T & ObjectRef, els, objects);
}
