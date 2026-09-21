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

import { SET_SHAPES, cleanText, type SetLayout } from "./set-spec";
import { SET_DIRECTION_MAX_CHARS } from "./set-config";
import { RIG_FIXED_SENTENCES, RIG_NUMBERED_SENTENCE } from "./rig";
import { RIG_BLADES, bladesWords } from "./furniture";
import { VEHICLE_SENTENCE } from "./vehicles";
import { TIME_OF_DAY_SENTENCE } from "./time-of-day";

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
 * The look (2026-09-11, operator's choice; 2026-09-12, what rides; since
 * 2026-09-14, the object sheet): the set's objects, cut out of an earlier
 * still onto plain grey (look-cutout.ts) and then drawn four ways on grey by
 * the image model (look-sheet.ts) — front three-quarter, side, rear
 * three-quarter, rear — so the car, the furniture and the finishes are the
 * same objects from shot to shot, from whichever side the new frame sees
 * them. Handed the whole earlier still, GPT Image copied its camera, framing
 * and background too, whatever the words said (4 of 4 orderings and
 * wordings, 2026-09-12). Handed one cutout, from one side, it kept the
 * design only while the new frame saw the same side: the operator's fourth
 * still, shot from behind with a front three-quarter cutout, came back as a
 * different car (2026-09-14). Handed the sheet, the still from behind came
 * back as that car's own rear — the twin exhausts, the light bar, the wing —
 * and a still from the front as its front (GPT Image 2.5 Sunburst,
 * 2026-09-14). Described by what it shows, not by position: the reference
 * photos arrive character first. The sheet carries no person — the cutout
 * it is drawn from has every person's region cleared out of it
 * (look-cutout.ts, look-people.ts), and the sheet is asked for none — so the
 * sentence says nothing of one.
 */
export const LOOK_SENTENCE =
  "One reference photo is a design sheet of objects from this same place: each shown several times on a plain grey ground, from different sides. Draw each of them exactly as it looks there — its shape, design, colour, materials and details — in the place, at the size and turned the way the layout sketch shows it, seen from the sketch's camera. Take nothing else from that photo: not its layout, angle, crop, framing or light." +
  // Added 2026-09-18, after a front-on shot came back as the car's rear: the
  // sheet is a two-by-two grid (look-sheet.ts LOOK_SHEET_PROMPT) whose cells
  // are three sides out of four REAR-ward, so a model that takes the sheet
  // whole is pulled to the back of a thing. The measured sentence above is
  // untouched; this says which cell to read. Unproven on a render.
  " That sheet is a two-by-two grid: top left the object's front three-quarter, top right its side, bottom left its rear three-quarter, bottom right its rear. Read whichever of the four shows the side the layout sketch sees, and never another.";

/**
 * The source photograph (2026-09-15): a photo set's shot now carries the
 * very photo the set was built from, beside the sketch. Until it did, the
 * render only inherited the photo through Astra's words — and everything
 * the words didn't pin drifted: the operator's pyramid-tile wall art came
 * back as flat squares, the sea view as trees, the cove ceiling as plain
 * (the Cream Corner Sitting Room, docs/ASTRA_SETS.md). The sentence gives
 * the photo one job — materials, colours, finishes, details — and keeps
 * the camera, framing and light the sketch's; anyone in the photograph is
 * named out of the shot, the same boundary the look sheet keeps.
 */
export const SOURCE_PHOTO_SENTENCE =
  "One reference photo is a real photograph of this same location. Wherever the sketch and the photograph show the same thing — walls, floor, ceiling, windows, furniture, what hangs or stands anywhere — copy the photograph's materials, colours, finishes and details exactly. Take the camera, framing, crop and light from the sketch, never from the photograph. If anyone appears in the photograph, they are not in this shot: take only the place from it.";

// What the sketch IS, said truthfully (2026-09-18). It called itself "a grey
// 3D mock-up" while build-scene.ts sketchMaterialFor draws every thing in its
// own colour, flat and untextured — so the model was told to discount the one
// piece of evidence that says which way a thing faces. On a car those colours
// are the white lamps at the nose, the red ones at the tail and the dark
// canopy between; without them a block car is the same silhouette either way
// (the operator's front-on shot came back as the car's rear, 2026-09-18).
const SKETCH_SENTENCES = [
  "The attached layout sketch is a flat, untextured 3D mock-up of the location in block colours — a guide to composition and to what each thing is, not a style reference.",
  "Its colours are each thing's own: read them as evidence of what a thing is and which way round it stands — a lamp, a window, a badge, the light at one end of a vehicle and not the other — and draw the real thing they stand for, never these flat colours as a style.",
  "Match its camera position, lens, framing, horizon and the direction of its light exactly.",
  "Every object in it is a rough stand-in built from simple blocks: keep each one's place, size and orientation, but draw the real thing it stands for, with its true shape, detail and materials, at full size. Never reproduce the blocky shapes; nothing may look like a toy, a model or a miniature.",
];
// The band (rig.ts letterbox, 2026-09-17): in a rig format other than the
// square, the model draws a 3:2 (or 2:3) picture and the server cuts the
// centred band out of it (frame-cut.ts). The model used to compose for the
// whole render, knowing nothing of the band, and the operator's two stills
// came back with the head in the strip that was cut away. The sketch now
// carries the strips painted dark, and this says what they are.
const BAND_ROWS_SENTENCE =
  "The sketch has a plain dark band across its top and another across its bottom: those bands lie outside the picture. Compose the whole shot inside the lit band between them — the whole person, head to feet as the sketch places them, and everything that matters — and draw the two bands exactly as they are, plain dark and the same size, with nothing in them.";
const BAND_COLUMNS_SENTENCE =
  "The sketch has a plain dark band down its left side and another down its right: those bands lie outside the picture. Compose the whole shot inside the lit band between them — the whole person, head to feet as the sketch places them, and everything that matters — and draw the two bands exactly as they are, plain dark and the same size, with nothing in them.";
// Only when exposure.ts lifted this set's sketch so its layout reads: the
// scene itself is not brighter for it. For a daylit set it would be false.
const LIFTED_SENTENCE =
  "The sketch is lit brighter than the real scene so its layout can be read: take the time of day, how dark it is and the colour of the light from the description, not from the sketch.";
// A rig light scheme (rig.ts, Helios Cinema 2026-09-15) re-lights the set
// for the frame: the sketch shows the scheme's light, so the description's
// hour must give way to it, lifted sketch or not.
const LIFTED_RIG_SENTENCE =
  "The sketch is lit brighter than the real scene so its layout can be read: take the light's direction from the sketch, and its mood, hour and colour from the light described below.";
const LIGHT_WINS_SENTENCE = "Where the description's hour or light differs from the light described below, the light below wins.";
// The hour the STAGE drew (time-of-day.ts hourWords) against the hour Astra
// wrote: the description is the set as built, the rig can stage another, and
// until 2026-09-18 only the description reached the model.
const HOUR_WINS_SENTENCE = "Where the description's hour differs from the time of day above, the hour above wins.";
const RENDER_PREFIX = "Render the location photorealistically, as it really looks";
const GAZE_SENTENCE = "Wherever they are looking, make it unmistakable: turn the head and eyes to it.";
const FACE_SENTENCE = "The grey figure has no face, hair or clothing to copy: take the person's face, hair and features only from the character photos.";
const NO_TEXT_SENTENCE = "No text, logos or brand names anywhere in the picture.";

/** Every fixed sentence a Set shot's prompt is built from: Picacho's words, never the person's or Astra's. */
export const SET_SHOT_FIXED_SENTENCES: readonly string[] = [
  ...SKETCH_SENTENCES,
  BAND_ROWS_SENTENCE,
  BAND_COLUMNS_SENTENCE,
  LIFTED_SENTENCE,
  `${RENDER_PREFIX}:`,
  `${RENDER_PREFIX}.`,
  HOUR_WINS_SENTENCE,
  LOOK_SENTENCE,
  SOURCE_PHOTO_SENTENCE,
  GAZE_SENTENCE,
  FACE_SENTENCE,
  NO_TEXT_SENTENCE,
];

/**
 * The rig's fixed sentences (rig.ts, Helios Cinema): every look's block and
 * its pushed strength, the frame's cut, and the two that hand the light to
 * the rig. A shot carries only the few its rig asks for.
 */
// The blades' four sentences ride the focus words with the number baked in
// (rig.ts :854, furniture.ts bladesWords) — found leaking through the strip
// on every shot with a stop and blades set (2026-09-19, the launch-day
// failed-render hunt): a fixed sentence the list did not know.
export const SET_SHOT_RIG_SENTENCES: readonly string[] = [
  LIFTED_RIG_SENTENCE,
  LIGHT_WINS_SENTENCE,
  ...RIG_FIXED_SENTENCES,
  ...RIG_BLADES.map((n) => bladesWords(n)),
];

// The two sentences Picacho writes ABOUT THE PERSON, anchored to every form
// they can take: the facings describeFacing can name, and the eye-lines
// people.ts gazeWords can write (its shape vocabulary and its numbers,
// which r1 prints with at most one decimal).
//
// Anchored because they used to be `[^.]*` and `.*?\.`, matched anywhere in
// the prompt with the g flag: a direction of the person's own that merely
// opened a sentence with "They look" — or an Astra description that did —
// was deleted from what the BRAND-RULE CHECK reads, while the model was
// sent it whole (found reviewing Helios, fixed 2026-09-18). The check may
// never read less than the model is sent, except Picacho's own words.
const GAZE_N = "\\d+(?:\\.\\d)?";
const SET_SHOT_GAZE_SENTENCE = new RegExp(
  "(?:By the end of the shot they|They) look " +
    "(?:straight into the camera, eyes to the lens" +
    `|at the (?:${SET_SHAPES.join("|")}) ${GAZE_N} × ${GAZE_N} × ${GAZE_N} m, their eyes on it` +
    `|(?:straight ahead of them|back over their shoulder|off to their (?:left|right)), at something ${GAZE_N} m away, out of the frame` +
    ")\\.",
  "g",
);
const FIGURE_FACING_SENTENCE =
  /The person stands where the grey figure stands, at its scale(?:, facing the same way|; their body (?:faces the camera|has their back to the camera|is in profile, facing frame (?:left|right)|is turned three-quarters (?:toward|away from) the camera, facing frame (?:left|right)))\./g;

/**
 * The prompt's fixed sentences — Picacho's own words, the same in every Set
 * shot — with the description and the person's direction left in place.
 * The pipeline's brand-rule check reads a Set shot through this (2026-09-14):
 * the operator's fourth still lost an attempt to "No copyrighted characters",
 * the classifier's evidence being the sentence about the grey figure and the
 * character photos. Those sentences are not the person's, and not what a
 * brand rule is about.
 */
export function stripSetShotScaffold(prompt: string): string {
  let out = prompt;
  for (const fixed of [...SET_SHOT_FIXED_SENTENCES, ...SET_SHOT_RIG_SENTENCES]) out = out.split(fixed).join(" ");
  out = out.replace(RIG_NUMBERED_SENTENCE, " ");
  // The hour, whose numbers are the sun's (time-of-day.ts): Picacho's words,
  // so the brand-rule check must not read them as the person's.
  out = out.replace(TIME_OF_DAY_SENTENCE, " ");
  out = out.replace(FIGURE_FACING_SENTENCE, " ");
  out = out.replace(SET_SHOT_GAZE_SENTENCE, " ");
  // Which way each vehicle faces (vehicles.ts vehicleWords, 2026-09-21), anchored.
  out = out.replace(VEHICLE_SENTENCE, " ");
  return out.replace(/\s+/g, " ").trim();
}

export function buildSetShotPrompt(input: {
  description: string;
  direction: string;
  lifted?: boolean;
  layout?: Pick<SetLayout, "mark" | "camera"> | null;
  /**
   * The look, when one rides. What rides is always the cutout, whoever
   * stood in the still it was cut from, so any value standing for it will
   * do: only whether it rides changes the words.
   */
  look?: object | null;
  /** Whether the set's source photograph rides (a photo set's shots). */
  sourcePhoto?: boolean;
  /** The rig's sentences for this frame (rig.ts rigSentences), in order; none when the rig asks for nothing. */
  rig?: readonly string[];
  /** Whether the rig re-lights the frame (a light scheme is on). */
  rigLight?: boolean;
  /** The hour the stage drew, in Picacho's words (time-of-day.ts hourWords); "" says nothing. */
  hour?: string;
  /** The eye-line (cut D, people.ts gazeWords): where the person looks; "" says nothing. */
  gaze?: string;
  /** The band's strips on the sketch (rig.ts bandSide): across the top and bottom, down the sides, or none. */
  band?: "rows" | "columns" | null;
  /** Which way each vehicle in the frame faces (vehicles.ts vehicleWords), in the camera's terms. */
  vehicles?: readonly string[];
}): string {
  const description = cleanText(input.description, 300);
  const direction = cleanText(input.direction, SET_DIRECTION_MAX_CHARS);
  const facing = describeFacing(input.layout ?? null);
  return [
    ...SKETCH_SENTENCES,
    input.band === "rows" ? BAND_ROWS_SENTENCE : input.band === "columns" ? BAND_COLUMNS_SENTENCE : "",
    // Right after the blocks are called stand-ins: which way each car's
    // front is, before anything else is said about the place (2026-09-21).
    ...(input.vehicles ?? []),
    // A staged hour reads like a light plot here: the sketch's own light is
    // the hour's, so the description's hour is not what to believe.
    input.lifted ? (input.rigLight || input.hour ? LIFTED_RIG_SENTENCE : LIFTED_SENTENCE) : "",
    description ? `${RENDER_PREFIX}: ${description}` : `${RENDER_PREFIX}.`,
    input.hour ?? "",
    input.hour ? HOUR_WINS_SENTENCE : "",
    input.rigLight && !input.lifted ? LIGHT_WINS_SENTENCE : "",
    ...(input.rig ?? []),
    input.look ? LOOK_SENTENCE : "",
    input.sourcePhoto ? SOURCE_PHOTO_SENTENCE : "",
    facing
      ? `The person stands where the grey figure stands, at its scale; their body ${facing}.`
      : "The person stands where the grey figure stands, at its scale, facing the same way.",
    input.gaze ?? "",
    // Closed with a full stop when it has none: the words reader hands its
    // direction back bare, and be0a3eaa's prompt read "a helmet on her hand
    // Wherever they are looking" as one sentence (2026-09-15).
    direction ? `In this frame: ${/[.!?…"”')\]]$/.test(direction) ? direction : `${direction}.`}` : "",
    GAZE_SENTENCE,
    FACE_SENTENCE,
    NO_TEXT_SENTENCE,
  ]
    .filter(Boolean)
    .join(" ");
}
