// A take's words as its brand check reads them (Helios Cut 1, 2026-09-25;
// operator: "GO ahead"). Relative imports only; a module of its own because
// take.ts cannot import set-shot-prompt.ts (set-shot-prompt → elements →
// film → take would be a cycle).
//
// A take's prompt is Picacho's own fixed sentences round the person's
// direction (take.ts buildSetTakePrompt): "One continuous shot, no cuts…",
// the move and texture sentences (moves.ts), the rack (furniture.ts), the
// eye-line (people.ts) and "Keep the person, the clothes…". A still's brand
// check already reads its prompt without its own fixed sentences
// (set-shot-prompt.ts stripSetShotScaffold, pipeline.ts setShot); a take's
// did not, so the classifier — or its keyword fallback when the classifier
// is down — judged Picacho's sentences as the person's words, against the
// operator's 16 brand rules.
//
// The strip matches exact sentences and anchored patterns only: the check
// may never read less than the model is sent, except Picacho's own words. A
// direction that merely opens like one of them ("During the move she
// laughs", "Camera: she waves") is kept whole.

import { SET_TAKE_FIXED_SENTENCES } from "./take";
import { FILM_MOVE_WORDS, FILM_TEXTURE_WORDS } from "./moves";
import { RACK_SENTENCE } from "./furniture";
import { SET_SHOT_GAZE_SENTENCE } from "./set-shot-prompt";

/** The take's words with Picacho's fixed sentences taken out: the person's own direction, as a brand rule should read it. */
export function stripSetTakeScaffold(prompt: string): string {
  let out = prompt;
  for (const fixed of [...SET_TAKE_FIXED_SENTENCES, ...Object.values(FILM_MOVE_WORDS), ...Object.values(FILM_TEXTURE_WORDS)]) out = out.split(fixed).join(" ");
  out = out.replace(RACK_SENTENCE, " ");
  out = out.replace(SET_SHOT_GAZE_SENTENCE, " ");
  return out.replace(/\s+/g, " ").trim();
}
