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

import { quoteSend, type SendQuoteInput } from "../generations/quote";
import { cleanText } from "./set-spec";
import { SET_DIRECTION_MAX_CHARS } from "./set-config";
import { FILM_MOVE_WORDS, FILM_TEXTURE_WORDS, type FilmMove, type FilmTexture } from "./moves";
import type { RigFormat } from "./rig";
import type { VideoAspectRatio } from "../generations/aspect-ratio";

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

/**
 * The shape a take's clip is asked for: its still's own (2026-09-25). The
 * engines offer two, read at source that day (fal's llms.txt pages):
 *
 * - Gemini Omni Flash 1.1 image-to-video: aspect_ratio "16:9" | "9:16",
 *   default "16:9", and no audio parameter.
 * - Veo 3.1 first-last-frame: aspect_ratio "auto" | "16:9" | "9:16",
 *   default "auto". fal.ts deliberately leaves it unsent, so the frames
 *   decide; the ratio here is what the row records for it.
 *
 * Neither renders a square or anything wider than 16:9: square and 4:3
 * stills make the engine invent the sides, Scope and Flat the top and
 * bottom. The page plays those last three inside their band (set-view.tsx
 * takeBand); the square it does not, which is why a new set frames in 16:9
 * (rig.ts NEW_SET_RIG). A Helios take's words never turn this ratio
 * (generations/actions.ts heliosTake).
 */
export function takeAspectRatio(format: RigFormat): VideoAspectRatio {
  return format === "vertical" ? "9:16" : "16:9";
}

/**
 * The presses a person may START in ten minutes — a take, a clip rendered
 * again, or a film's Render (its beats count once, actions.ts takeWork,
 * 2026-09-25). Counted at the press's first paid step, after every stop
 * Helios makes for free, so a stop costs no slot.
 */
export const SET_TAKES_PER_10_MIN = 4;

// Picacho's own fixed sentences in a take's words (2026-09-25): the brand
// check reads the take without them (take-scaffold.ts), as it reads a still
// without its own (set-shot-prompt.ts stripSetShotScaffold).
export const TAKE_ONE_SHOT = "One continuous shot, no cuts: the camera moves from the first frame to the last frame, inside the same place.";
export const TAKE_NATURAL = "The person carries the moment naturally.";
export const TAKE_KEEP = "Keep the person, the clothes and the place exactly as the frames show them.";
export const SET_TAKE_FIXED_SENTENCES: readonly string[] = [TAKE_ONE_SHOT, TAKE_NATURAL, TAKE_KEEP];

/**
 * The take's prompt: the move between the frames, and the person's own
 * direction. The frames carry the composition; the words carry the motion.
 * It reaches the video model as written (takeInSet sets prompt_is_final,
 * 2026-09-21): the drafter rewrote it into vivid sentences of its own and
 * lost the move. The gates still run, brand rules included — on the
 * person's words only (pipeline.ts setTake, take-scaffold.ts, 2026-09-25).
 */
export function buildSetTakePrompt(
  direction: string,
  // A film beat's move and textures (moves.ts, Helios Cinema 2026-09-15):
  // the frames hold where the move starts and ends; these words say the path
  // between, and what no path can hold. Picacho's own fixed sentences.
  motion: { move?: FilmMove | null; textures?: readonly FilmTexture[]; rack?: string; gaze?: string } = {},
): string {
  const said = cleanText(direction, SET_DIRECTION_MAX_CHARS);
  return [
    TAKE_ONE_SHOT,
    motion.move ? FILM_MOVE_WORDS[motion.move] : "",
    ...(motion.textures ?? []).map((t) => FILM_TEXTURE_WORDS[t]),
    // The rack of focus (cut C, furniture.ts rackWords): where the focus travels during the move.
    motion.rack ?? "",
    // The eye-line at the end (cut D, people.ts gazeWords): where the person looks by the last frame.
    motion.gaze ?? "",
    // Closed with a full stop when it has none, as a still's words are
    // (set-shot-prompt.ts): the first real film's words would otherwise run
    // into the next sentence, "…to the car Keep the person…" (2026-09-21).
    said.length > 0 ? (/[.!?…"”')\]]$/.test(said) ? said : `${said}.`) : TAKE_NATURAL,
    TAKE_KEEP,
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

/**
 * What a set's still costs, as quoteSend prices it on the server: one image
 * (the shot action sends content_type image, and an image's weight does not
 * move with anything a still carries).
 */
export function stillQuoteInput(): SendQuoteInput {
  return {
    contentType: "image",
    videoModelId: "kling",
    videoDurationSeconds: 5,
    videoResolution: null,
    storyboardTotalSeconds: null,
    referencePhotoCount: 0,
    framePicked: false,
    continuationSourceSeconds: null,
    dialoguePresent: false,
    renderCount: 1,
  };
}

/**
 * What takes cost together, as the server charges them: `clips` clips on
 * the engine, `stills` of them ending on a still shot for them (a take, or
 * a film's beat rendered whole) and the rest on a still the set already has
 * (a clip rendered again). The price on the Take and Render buttons, and
 * what the server asks the person's balance for before the first is shot.
 */
export function takesCredits(engine: SetTakeEngine, count: { clips: number; stills: number }): number {
  return (
    count.clips * quoteSend(takeQuoteInput(engine)).totalCredits + count.stills * quoteSend(stillQuoteInput()).totalCredits
  );
}

/**
 * What a take was rendered from: the still it starts on, the still it ends
 * on, its person, engine and direction — enough to render its clip again
 * between the same two frames (takeInSet's endGenerationId), paying for the
 * clip alone. Kept on the take's row (shot-take.ts), so a take that failed
 * on an earlier visit offers it too.
 */
export type TakeSource = { start: string; end: string; characterId: string; direction: string; engine: SetTakeEngine };

/**
 * The takes whose clip may be rendered again: failed, with their frames
 * known — and not tried again already. Another take between the same two
 * stills that has not failed is that clip rendering or rendered, and a
 * second press would pay for it twice.
 */
export function retryableTakes(
  shots: readonly { generationId: string; kind: string; status: string; takeFrom: TakeSource | null }[],
): Set<string> {
  const pairOf = (f: TakeSource | null) => (f ? `${f.start} ${f.end}` : null);
  const tried = new Set<string>();
  for (const sh of shots) {
    const pair = sh.kind === "take" && sh.status !== "failed" ? pairOf(sh.takeFrom) : null;
    if (pair) tried.add(pair);
  }
  const out = new Set<string>();
  for (const sh of shots) {
    if (sh.kind !== "take" || sh.status !== "failed") continue;
    const pair = pairOf(sh.takeFrom);
    if (pair && !tried.has(pair)) out.add(sh.generationId);
  }
  return out;
}
