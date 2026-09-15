// A take in Helios (2026-09-15): a clip, not a still. The person frames
// where the move ENDS while an earlier still marks where it STARTS; Helios
// shoots the end frame with the start still riding as its look (same world,
// same person, look-sheet.ts), then a start-and-end-frame video lane
// animates between the two rendered stills. Two engines since 2026-09-15
// (operator: "wire both", after vetoing Kling): Gemini Omni Flash 1.1 is
// the take, Veo 3.1 the premium take — both probed live with two real
// Helios frames before they were offered (42 s and 53 s, no policy refusal
// on the person, both frames honoured; docs/ASTRA_SETS.md). Pure and
// relative-import only: the test holds each engine's model, length and
// prompt to what the action sends, and the quote to what the server will
// charge.

import type { SendQuoteInput } from "../generations/quote";
import { cleanText } from "./set-spec";
import { SET_DIRECTION_MAX_CHARS } from "./set-config";
import { FILM_MOVE_WORDS, FILM_TEXTURE_WORDS, type FilmMove, type FilmTexture } from "./moves";

export type SetTakeEngine = "omni" | "veo";

/**
 * One fixed length per engine, priced before the word is given. Omni takes
 * its short 5 s (catalogue durations 5/8/10); Veo's shortest ladder step
 * above a blink is its own 8 s default (4/6/8) — and at $0.40/s the length
 * IS the price difference, so the number sits on the button either way.
 */
export const SET_TAKE_ENGINES = {
  omni: { model: "gemini-omni", seconds: 5 },
  veo: { model: "veo", seconds: 8 },
} as const satisfies Record<SetTakeEngine, { model: string; seconds: number }>;

export const SET_TAKE_DEFAULT_ENGINE: SetTakeEngine = "omni";

export function isSetTakeEngine(v: unknown): v is SetTakeEngine {
  return v === "omni" || v === "veo";
}

export const SET_TAKES_PER_10_MIN = 4;

/**
 * The take's prompt: the move between the frames, and the person's own
 * direction. The frames carry the composition; the words carry the motion.
 * This goes through the video lane's ordinary drafting and gates, like any
 * other clip.
 */
export function buildSetTakePrompt(
  direction: string,
  // A film beat's move and textures (moves.ts, Helios Cinema 2026-09-15):
  // the frames hold where the move starts and ends; these words say the path
  // between, and what no path can hold. Picacho's own fixed sentences.
  motion: { move?: FilmMove | null; textures?: readonly FilmTexture[] } = {},
): string {
  const said = cleanText(direction, SET_DIRECTION_MAX_CHARS);
  return [
    "One continuous shot, no cuts: the camera moves from the first frame to the last frame, inside the same place.",
    motion.move ? FILM_MOVE_WORDS[motion.move] : "",
    ...(motion.textures ?? []).map((t) => FILM_TEXTURE_WORDS[t]),
    said.length > 0 ? said : "The person carries the moment naturally.",
    "Keep the person, the clothes and the place exactly as the frames show them.",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * What the take's VIDEO leg will cost, as quoteSend prices it on the
 * server: the engine's model at its fixed length with a start and end
 * frame riding. framePicked stays true for both engines — quoteSend adds a
 * surcharge only where the frame lane really bills above the base weight
 * (Kling's did; Omni's and Veo's frame lanes bill their base per-second
 * rate, so the surcharge helper prices them at zero). The end still is
 * priced separately as the one image it is.
 */
export function takeQuoteInput(engine: SetTakeEngine = SET_TAKE_DEFAULT_ENGINE): SendQuoteInput {
  return {
    contentType: "video",
    videoModelId: SET_TAKE_ENGINES[engine].model,
    videoDurationSeconds: SET_TAKE_ENGINES[engine].seconds,
    videoResolution: null,
    storyboardTotalSeconds: null,
    referencePhotoCount: 0,
    framePicked: true,
    continuationSourceSeconds: null,
    dialoguePresent: false,
    renderCount: 1,
  };
}
