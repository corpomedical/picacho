// The prompt a still shot in a Set sends (2026-09-10), built on the server
// from the Set's saved description and the person's own words for the frame.
//
// It rides an ordinary image take: the character's saved photo is the
// identity reference, and the square snapshot of the set rides beside it as
// a "reference" attachment — which the pipeline already tells the image
// model to use as the prompt says, and not to copy "unless the prompt asks
// for that" (pipeline.ts). This prompt is where it asks: match the sketch's
// camera and layout, render the place for real, and take the person from
// the character photos only. The pipeline then adds its own line that every
// other reference photo is the person.
//
// The description is the ONE piece of model-written text that reaches a
// render provider; it was gated when the set was built. The whole prompt is
// gated again by runGeneration, in the strict lane (an attachment rides),
// before any money moves.
//
// Relative imports only: tested without the "@/" alias.

import { cleanText } from "./set-spec";
import { SET_DIRECTION_MAX_CHARS } from "./set-config";

export function buildSetShotPrompt(input: { description: string; direction: string; lifted?: boolean }): string {
  const description = cleanText(input.description, 300);
  const direction = cleanText(input.direction, SET_DIRECTION_MAX_CHARS);
  return [
    "The attached layout sketch is a grey 3D mock-up of the location — a guide to composition, not a style reference.",
    "Match its camera position, lens, framing, horizon and the direction of its light exactly.",
    // Only when exposure.ts lifted this set's sketch so its layout reads: the
    // scene itself is not brighter for it. For a daylit set it would be false.
    input.lifted
      ? "The sketch is lit brighter than the real scene so its layout can be read: take the time of day, how dark it is and the colour of the light from the description, not from the sketch."
      : "",
    description ? `Render the location photorealistically, as it really looks: ${description}` : "Render the location photorealistically, as it really looks.",
    "The person stands where the grey figure stands, at its scale, facing the same way.",
    direction ? `In this frame: ${direction}` : "",
    "The grey figure has no face, hair or clothing to copy: take the person's face, hair and features only from the character photos.",
    "No text, logos or brand names anywhere in the picture.",
  ]
    .filter(Boolean)
    .join(" ");
}
