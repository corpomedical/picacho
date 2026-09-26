// Which thing an eye-line or a focus pull is on, in a paint prompt's words
// (Helios Cut 4, step B5, 2026-09-26 — operator: "resume").
//
// A still said "They look at the box 1.9 × 0.5 × 3.7 m, their eyes on it":
// the size of whichever block the menu stored, a block the model was told
// never to draw. Now, where SET_THING_WORDS_OPEN allows (admins until the
// proof stills, set-shot-prompt.ts), it says what the thing is in
// Picacho's own closed words (thing-words.ts): "the red car", and where
// two things share a kind and a colour, where it stands — "the red car at
// the right of the frame, nearest the camera", through the still's camera
// as the sheets name things (elements.ts elementPlaces), or, out of the
// frame or in a take (whose camera moves), which side of the figure it is
// on (people.ts sideOf). A thing whose own sheet rides drawn grey has no
// colour in the sketch, so it is named by its place alone, in the sheet's
// own words. Never a name (the owner's decision D2).
//
// Built here, outside people.ts and furniture.ts, and handed into
// gazeWords and rackWords as a phrase (critic item 6): people.ts imports
// nothing at run time, and furniture.ts can't import elements.ts, which
// reads it through film.ts.
//
// Pure, relative imports only.

import { colourWord, type ColourId } from "./colour-words";
import { elementPlaces, largestBlockOf, setOwnBlocks, type SetElement } from "./elements";
import { placedCopies, type LookSet, type ShotCamera } from "./look-cutout";
import { sideOf } from "./people";
import { thingPhraseText, type ThingPhrase } from "./thing-words";

export type ThingPhraseOpts = {
  /** The still's camera, for the frame's thirds (elements.ts elementPlaces); null in a take, whose camera moves. */
  camera: ShotCamera | null;
  /** Where the figure stands, for the side a thing is on. */
  mark: { x: number; z: number; facingDeg: number };
  /** Things whose own sheet rides drawn grey in the sketch: named without a colour. */
  grey?: ReadonlySet<string>;
};

const colourOf = (el: Pick<SetElement, "members">, spec: Pick<LookSet, "objects">): ColourId => {
  const largest = largestBlockOf(el, spec.objects) ?? el.members[0][0];
  return colourWord(spec.objects[largest]?.color ?? "");
};

/**
 * The words for the thing block `index` belongs to, or null to keep
 * today's words (its shape and size). `spec` is the set as this frame shows
 * it (movers.ts: a driven car stands where the beat put it); `els` are the
 * set's things (setElements of the arrangement, as planShotSheets reads
 * them).
 *
 * - A thing: "the {colour} {car|vehicle|object}". When another thing has
 *   the same kind and colour, or its sheet rides grey, where it is: the
 *   third of the frame and, with others seen in that third, its rank from
 *   the camera; out of the frame or without a camera, the side of the
 *   figure it is on.
 * - A block of the set itself: "the {colour} structure" when no other block
 *   of the set itself has its colour; otherwise null — "the grey structure"
 *   would name nothing on a set built of grey.
 */
export function thingPhrase(index: number, spec: LookSet, els: readonly SetElement[], opts: ThingPhraseOpts): string | null {
  const o = spec.objects[index];
  if (!o) return null;
  const el = els.find((e) => e.members.some(([m]) => m === index));
  if (!el) {
    const colour = colourWord(o.color);
    const same = setOwnBlocks(spec, els).some((i) => i !== index && colourWord(spec.objects[i].color) === colour);
    return same ? null : thingPhraseText({ colour, kind: "structure", place: null });
  }
  const colour = colourOf(el, spec);
  const grey = opts.grey?.has(el.key) === true;
  const twins = els.filter((e) => e.kind === el.kind && colourOf(e, spec) === colour).length > 1;
  let place: ThingPhrase["place"] = null;
  if (grey || twins) {
    const places = opts.camera ? elementPlaces(spec, els, opts.camera) : [];
    const here = places.find((p) => p.key === el.key);
    if (here && here.seen) {
      const inThird = places.filter((p): p is Extract<typeof p, { seen: true }> => p.seen && p.across === here.across).sort((a, b) => a.depthM - b.depthM);
      place = { third: here.across, rank: inThird.length > 1 ? inThird.findIndex((p) => p.key === el.key) : null };
    } else {
      // Where it stands in this frame's set: its blocks as placed, not its key's centre.
      const copies = placedCopies(spec.objects, spec.bounds).filter((c) => el.members.some(([m, k]) => m === c.object && k === c.copy));
      const x = copies.length ? (Math.min(...copies.map((c) => c.min[0])) + Math.max(...copies.map((c) => c.max[0]))) / 2 : el.centre[0];
      const z = copies.length ? (Math.min(...copies.map((c) => c.min[2])) + Math.max(...copies.map((c) => c.max[2]))) / 2 : el.centre[2];
      place = { side: sideOf(opts.mark, { x, z }) };
    }
  }
  return thingPhraseText({ colour: grey ? null : colour, kind: el.kind, place });
}
