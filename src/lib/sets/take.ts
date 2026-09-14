// A take in Helios (2026-09-15): a clip, not a still. The person frames
// where the move ENDS while an earlier still marks where it STARTS; Helios
// shoots the end frame with the start still riding as its look (same world,
// same person, look-sheet.ts), then Kling 1.6's start-and-end-frame lane
// animates between the two rendered stills. Pure and relative-import only:
// the test holds the model, the length and the prompt to what the action
// sends, and the quote to what the server will charge.

import type { SendQuoteInput } from "../generations/quote";
import { cleanText } from "./set-spec";
import { SET_DIRECTION_MAX_CHARS } from "./set-config";

/** Start/end frames are Kling 1.6's lane (generations/actions.ts refuses them anywhere else). */
export const SET_TAKE_MODEL = "kling";
/** One length for every take, the model's short default: priced before the word is given. */
export const SET_TAKE_SECONDS = 5;
export const SET_TAKES_PER_10_MIN = 4;

/**
 * The take's prompt: the move between the frames, and the person's own
 * direction. The frames carry the composition; the words carry the motion.
 * This goes through the video lane's ordinary drafting and gates, like any
 * other clip.
 */
export function buildSetTakePrompt(direction: string): string {
  const said = cleanText(direction, SET_DIRECTION_MAX_CHARS);
  return [
    "One continuous shot, no cuts: the camera moves from the first frame to the last frame, inside the same place.",
    said.length > 0 ? said : "The person carries the moment naturally.",
    "Keep the person, the clothes and the place exactly as the frames show them.",
  ].join(" ");
}

/**
 * What the take's VIDEO leg will cost, as quoteSend prices it on the
 * server: Kling at the take's length with a start and end frame riding
 * (the frame surcharge included). The end still is priced separately as
 * the one image it is.
 */
export function takeQuoteInput(): SendQuoteInput {
  return {
    contentType: "video",
    videoModelId: SET_TAKE_MODEL,
    videoDurationSeconds: SET_TAKE_SECONDS,
    videoResolution: null,
    storyboardTotalSeconds: null,
    referencePhotoCount: 0,
    framePicked: true,
    continuationSourceSeconds: null,
    dialoguePresent: false,
    renderCount: 1,
  };
}
