// A thing in a paint prompt's words, as Picacho's own closed words (Helios
// Cut 4, step B5, 2026-09-26 — operator: "resume"). A leaf module: it
// imports only the colour words, so furniture.ts (a take's rack, which
// film.ts and so elements.ts read) can hold its rack sentence to exactly
// these forms without an import cycle (critic item 6).
//
// A phrase is made only of words on the lists below: "the", one of the
// fifteen colour words (colour-words.ts), a kind (car, vehicle, object, or
// structure for a block of the set itself), and at most one place — a
// third of the frame, with its rank from the camera as the sheets say it
// (elements.ts planSheets), or which side of the figure it is on
// (people.ts sideOf). No name, and no word a model wrote, can ever be one:
// the owner's decision D2 keeps names out of paint prompts. THING_PHRASE_PATTERN
// is every phrase thingPhraseText can write, so a sentence built around one
// can be matched whole and nothing looser (set-shot-prompt.ts
// SET_SHOT_GAZE_SENTENCE, furniture.ts RACK_SENTENCE): the brand check reads
// anything else.
//
// Pure, relative imports only.

import { COLOUR_IDS, type ColourId } from "./colour-words";

/** A third of the frame, as the sheets name a thing (elements.ts planSheets): the same words. */
export const FRAME_THIRD_WORDS = { left: "at the left of the frame", middle: "in the middle of the frame", right: "at the right of the frame" } as const;
export type FrameThird = keyof typeof FRAME_THIRD_WORDS;
/** Its rank from the camera among the things seen in its third, as the sheets say it. */
export const CAMERA_RANK_WORDS = ["nearest the camera", "second from the camera", "third from the camera", "fourth from the camera", "fifth from the camera", "sixth from the camera"] as const;
/** What a thing is: elements.ts ElementKind, or a block of the set itself. */
export const THING_PHRASE_KINDS = ["car", "vehicle", "object", "structure"] as const;
export type ThingPhraseKind = (typeof THING_PHRASE_KINDS)[number];
/** Which side of the figure it is on, by the figure's own front (people.ts sideOf). */
export const THING_SIDE_WORDS = { ahead: "ahead of them", left: "to their left", right: "to their right", behind: "behind them" } as const;
export type ThingSide = keyof typeof THING_SIDE_WORDS;

/** A phrase, before it is words: its colour (null when its own sheet rides drawn grey), its kind, and at most one place. */
export type ThingPhrase = {
  colour: ColourId | null;
  kind: ThingPhraseKind;
  place: { third: FrameThird; rank: number | null } | { side: ThingSide } | null;
};

/** The phrase in words: "the red car", "the red car at the right of the frame, nearest the camera", "the car to their left". */
export function thingPhraseText(p: ThingPhrase): string {
  const what = `the ${p.colour ? `${p.colour} ` : ""}${p.kind}`;
  if (!p.place) return what;
  if ("side" in p.place) return `${what} ${THING_SIDE_WORDS[p.place.side]}`;
  const rank = p.place.rank !== null && p.place.rank >= 0 && p.place.rank < CAMERA_RANK_WORDS.length ? `, ${CAMERA_RANK_WORDS[p.place.rank]}` : "";
  return `${what} ${FRAME_THIRD_WORDS[p.place.third]}${rank}`;
}

const either = (xs: readonly string[]) => `(?:${xs.join("|")})`;
/**
 * Every phrase thingPhraseText can write, as a regular expression's source:
 * no anchors and no flags, for a sentence to put round it. Only the lists'
 * own words; a colour or a place that is not on them does not match.
 */
export const THING_PHRASE_PATTERN =
  `the (?:${either(COLOUR_IDS)} )?${either(THING_PHRASE_KINDS)}` +
  `(?: ${either(Object.values(FRAME_THIRD_WORDS))}(?:, ${either(CAMERA_RANK_WORDS)})?| ${either(Object.values(THING_SIDE_WORDS))})?`;
