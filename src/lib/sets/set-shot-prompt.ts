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
// Two things the sketch cannot say for itself (the operator's first takes,
// 2026-09-11):
//   - Its objects are blocks. A car built from boxes, filling the frame, came
//     back as a boxy car that looked like a toy; the same car seen from
//     behind came back as an invented coupe. The sketch is a block model, so
//     the prompt says so: keep each object's place and size, draw the real
//     thing.
//   - Which way the figure faces. It has no face, so "facing the same way"
//     could not be read — a take came back as a back view looking nowhere in
//     particular. The facing is now put in the camera's own terms, worked out
//     from where the figure stands and faces and where the camera is.
//
// The description is the ONE piece of model-written text that reaches a
// render provider; it was gated when the set was built. The whole prompt is
// gated again by runGeneration, in the strict lane (an attachment rides),
// before any money moves.
//
// Relative imports only: tested without the "@/" alias.

import { cleanText, type SetLayout } from "./set-spec";
import { SET_DIRECTION_MAX_CHARS } from "./set-config";

const DEG = Math.PI / 180;

/**
 * How the figure's body is turned, as the camera sees it: "faces the camera",
 * "is in profile, facing frame left", "has their back to the camera"... Null
 * when there is no camera pose, or the camera stands on the figure's spot.
 */
export function describeFacing(layout: Pick<SetLayout, "mark" | "camera"> | null): string | null {
  const camera = layout?.camera;
  if (!layout || !camera) return null;
  const { mark } = layout;
  const toCamX = camera.position[0] - mark.x;
  const toCamZ = camera.position[2] - mark.z;
  const toCamLen = Math.hypot(toCamX, toCamZ);
  if (toCamLen < 0.05) return null;
  const faceX = Math.sin(mark.facingDeg * DEG);
  const faceZ = Math.cos(mark.facingDeg * DEG);
  const cos = (faceX * toCamX + faceZ * toCamZ) / toCamLen;
  const angle = Math.acos(Math.max(-1, Math.min(1, cos))) / DEG;
  if (angle < 22.5) return "faces the camera";
  if (angle >= 157.5) return "has their back to the camera";
  // Screen right is the camera's view direction turned a quarter clockwise,
  // seen from above: for a camera looking along -Z it is +X.
  let viewX = camera.target[0] - camera.position[0];
  let viewZ = camera.target[2] - camera.position[2];
  if (Math.hypot(viewX, viewZ) < 1e-6) {
    viewX = -toCamX;
    viewZ = -toCamZ;
  }
  const side = faceX * -viewZ + faceZ * viewX > 0 ? "right" : "left";
  if (angle < 67.5) return `is turned three-quarters toward the camera, facing frame ${side}`;
  if (angle < 112.5) return `is in profile, facing frame ${side}`;
  return `is turned three-quarters away from the camera, facing frame ${side}`;
}

/**
 * The look (2026-09-11, operator's choice): an earlier still from this set
 * rides beside the sketch, so the car, the furniture and the finishes are the
 * same objects from shot to shot — nothing in a set says which car it is, and
 * without it every still designed its own. Tested: the second angle kept the
 * first still's car, and also its person's dress — so the outfit carrying
 * over is said out loud, and only for the same character; for another
 * character the person in it is fenced off entirely. Described by what it
 * shows, not by position: the reference photos arrive character first.
 */
function lookSentences(look: { sameCharacter: boolean; savedOutfit?: boolean } | null | undefined): string[] {
  if (!look) return [];
  return [
    "One reference photo is an earlier still from this same set, a finished photograph of the place: everything in it is the same object here, so keep each one's design, colour, materials and details exactly as they are there. Take nothing else from it: not its camera, framing or light.",
    !look.sameCharacter
      ? "The person in it is someone else: take nothing about them from it."
      : look.savedOutfit
        ? // The character's saved outfit photo rides too and decides the
          // clothes (hasSavedOutfit): a second clothing instruction here would
          // leave the model to pick one.
          "The person in it is the same person, but take what they wear from the outfit photo, and their face, hair and features only from the character photos."
        : "The person in it is the same person: unless 'In this frame' says what they wear, dress them as they are dressed there. Their face, hair and features still come only from the character photos.",
  ];
}

export function buildSetShotPrompt(input: {
  description: string;
  direction: string;
  lifted?: boolean;
  layout?: Pick<SetLayout, "mark" | "camera"> | null;
  look?: { sameCharacter: boolean; savedOutfit?: boolean } | null;
}): string {
  const description = cleanText(input.description, 300);
  const direction = cleanText(input.direction, SET_DIRECTION_MAX_CHARS);
  const facing = describeFacing(input.layout ?? null);
  return [
    "The attached layout sketch is a grey 3D mock-up of the location — a guide to composition, not a style reference.",
    "Match its camera position, lens, framing, horizon and the direction of its light exactly.",
    "Every object in it is a rough stand-in built from simple blocks: keep each one's place, size and orientation, but draw the real thing it stands for, with its true shape, detail and materials, at full size. Never reproduce the blocky shapes; nothing may look like a toy, a model or a miniature.",
    // Only when exposure.ts lifted this set's sketch so its layout reads: the
    // scene itself is not brighter for it. For a daylit set it would be false.
    input.lifted
      ? "The sketch is lit brighter than the real scene so its layout can be read: take the time of day, how dark it is and the colour of the light from the description, not from the sketch."
      : "",
    description ? `Render the location photorealistically, as it really looks: ${description}` : "Render the location photorealistically, as it really looks.",
    ...lookSentences(input.look),
    facing
      ? `The person stands where the grey figure stands, at its scale; their body ${facing}.`
      : "The person stands where the grey figure stands, at its scale, facing the same way.",
    direction ? `In this frame: ${direction}` : "",
    "Wherever they are looking, make it unmistakable: turn the head and eyes to it.",
    "The grey figure has no face, hair or clothing to copy: take the person's face, hair and features only from the character photos.",
    "No text, logos or brand names anywhere in the picture.",
  ]
    .filter(Boolean)
    .join(" ");
}
