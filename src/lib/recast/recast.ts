// Recast — "Mystique" on the door (the operator's working title, 2026-09-17;
// the name lives in the route and the dictionary, nowhere else, so changing
// it never touches a stored id).
//
// THE JOB: a clip of someone performing goes in, the same performance comes
// out with a saved character in their place — the acting, the timing and the
// sound kept. It is the answer to Higgsfield's Genjutsu, whose point the
// Recce missed: the performance is the product.
//
// THREE JOBS, not one. Two were found by the 2026-09-17 probe (one photo of
// Eva through the same 3 s performance on both engines, which did different
// things), the third by the 2026-09-18 probe:
//
//   scene   The character stands INSIDE the clip: its room, its light, its
//           framing, its sound. Kling O3 Edit, since 2026-09-19 — see THE
//           DISSOLVE below for why it is no longer Wan.
//   motion  The character's PHOTO comes alive with the clip's performance;
//           the photo's world and shape are kept, the clip's are left
//           behind. Kling V3 Motion Control.
//   world   The performance is kept and EVERYTHING ELSE is redrawn from
//           words — the same moves on a rainy neon street, or as a painting.
//           Luma Ray 3.2.
//
//           What this job does NOT do, measured rather than assumed: it does
//           not hold the performer's face. The same clip and the same words
//           were sent at flex_2, adhere_2 and adhere_3 on 2026-09-18 and all
//           three came back with the motion, the timing and the framing
//           intact and a DIFFERENT person in them. So it is sold as what it
//           is — the style swap, where a new look is the point — and never
//           as "your character, restyled". A job that promised a face it
//           cannot keep would be the exact lie this door exists to avoid.
//
// HOW LONG A TAKE ACTUALLY TAKES, measured on one 3.0 s / 72-frame clip
// (2026-09-17/18), because it is what sets each job's ceiling: the runner
// writes a job off at 45 minutes, so an engine may only be offered for
// lengths whose worst case lands well inside that.
//
//   Kling V3 MC Pro            152 s   ≈ 50 s per clip-second → 30 s ≈ 25 min
//   Luma Ray 3.2 v2v           153 s   fixed 5 s / 10 s slots
//   Wan 2.2 Animate Replace    304 s   ≈ 100 s per clip-second → 10 s ≈ 17 min
//   Wan 2.2 Animate Move       792 s   NOT OFFERED — 10 s would be ~55 min
//   DreamActor v2            >1200 s   NOT OFFERED — cheapest of all at
//     $0.05/s and it held Eva well, but over twenty minutes for three
//     seconds cannot be sold at any length here. It is the only engine on
//     the list that also animates animals and drawings, so it is worth
//     coming back to behind a cap of its own once its real curve is known.
//
// THE DISSOLVE (2026-09-19, the operator's second real take: "Mid video the
// added character got dissolved"). Wan Animate Replace is given ONE front
// photo. It held his character's face while the performer faced the camera;
// the moment the performer turned his back and walked into the crowd, Wan had
// nothing saying what the back of the character's head looks like and fell
// back to the source performer's buzz cut — the character dissolved into the
// man he replaced. That is the engine's limit, not a setting.
//
// Probed on HIS clip, first 10 s, with Eva (long red hair — the hardest back
// view there is), against the two engines that re-render the whole clip from
// SEVERAL photos of the character:
//
//   Kling O3 Edit Pro     held her through the whole turn · 1916×1080 ·
//                         559 s · ledger 12 units × $0.14 = $1.68
//   Happy Horse Edit      held her through the whole turn, kept even the
//                         cigarette · 1278×720 · 223 s · ledger 20.04 units
//                         × $0.14 = $2.81 — DOUBLE its page's "$0.14 /
//                         second" at 720p, so it is not offered
//
// Unit prices from fal's own pricing API (api.fal.ai/v1/models/pricing),
// units from its ledger — the page alone would have mispriced Happy Horse by
// half. Wan's two scene engines stay in the table, RETIRED: takes made with
// them still list and still name their engine in History, and no new take
// can be started on them.
//
// Pure and alias-free on purpose: the door quotes with this, the action
// charges with it, and recast.test.ts audits both against the prices read
// at source. Change a price and its test together.
//
// MONEY, read from fal's model pages 2026-09-17/18 (their words):
//   Kling V3 Motion Control Pro   "Your request will cost $0.168 per second."
//   Kling V3 Motion Control Std   "Your request will cost $0.126 per second."
//   DreamActor v2                 "Your request will cost $0.05 per second."
//   Wan 2.2 Animate Replace/Move  "720p: $0.08 per video second … 580p: $0.06
//     … 480p: $0.04" and "Video seconds (billed) = total frames ÷ 16"
//   Luma Ray 3.2 video-to-video   "For 5s video your request will cost $0.72
//     for 540p, $1.08 for 720p … For 10s, $1.44 at 540p, $2.16 at 720p"
//
// and CHECKED against fal's own ledger for the probe's requests: Wan billed
// 4.5 units for a 72-frame clip (72 ÷ 16) and Kling billed 3 for the same
// 3.0 s clip — the clip's length once, not input plus output the way
// Seedance bills a video reference. So there are three ways to be billed
// here, and each engine says which one it is.
//
// Credits are the catalogue's own rule — provider cost over the $0.28 basis,
// rounded up (video-models.ts) — restated here as a number because that
// module pulls the whole catalogue in; the test pins the two equal.

import { CHAIN_LOOK_PLACEHOLDER, CHAIN_MAX_SECONDS, chainBilledSeconds } from "../generations/chain";

export const RECAST_COST_BASIS_USD_PER_CREDIT = 0.28;

/** How tightly the world job holds the source. See recastRequestBody. */
export const RECAST_WORLD_EDIT_STRENGTH = "adhere_2";

export type RecastJob = "scene" | "motion" | "world" | "restage";
export type RecastEngine =
  | "h3-768"
  | "h3-480"
  | "kling-edit"
  | "wan-scene-720"
  | "wan-scene-480"
  | "kling-pro"
  | "kling-std"
  | "luma-720"
  | "luma-540";

export type RecastEngineSpec = {
  job: RecastJob;
  /** The job's first choice, or its cheaper pass. */
  tier: "full" | "lite";
  /** What generations.video_model_id / model_id record. Never renamed once rows exist. */
  modelId: string;
  /** The engine's own name — History's detail line and provider errors. */
  label: string;
  endpoint: string;
  usdPerBilledSecond: number;
  /**
   * seconds   the clip's length, rounded up (Kling, DreamActor)
   * frames16  the clip's frames ÷ 16 (Wan — 30 fps footage bills ~1.9× its length)
   * bucket    a 5 s or 10 s slot, whatever the clip's length (Luma)
   */
  billedBy: "seconds" | "frames16" | "bucket";
  /** Wan's and Luma's output size; the others take none. */
  resolution?: "480p" | "540p" | "720p";
  /** Takes a written brief. Kling and Luma do; Wan and DreamActor have no prompt field. */
  takesDirection: boolean;
  /**
   * The longest brief this engine is sent, in characters (2026-09-22, read
   * from fal's own schemas that day): Kling O3 Edit's and V3 Motion
   * Control's prompt stop at 2,500, Luma Ray 3.2's at 6,000. H3 takes
   * 50,000 and is given at most 6,000 — no brief of ours comes near it, and
   * a cap nobody will ever meet is not a cap. The brief is composed to fit
   * (recast-brief.ts), so the request body never has to cut it: a cut from
   * the end is a cut into the person's own direction, which stands last.
   * Wan takes no prompt; its number bounds the copy that is stored.
   */
  promptMax: number;
  /**
   * Takes extra photos of the character for identity (Kling's `elements`:
   * one frontal image plus 1–3 more angles). The rest see one photo.
   */
  takesMorePhotos: boolean;
  /** Carries the clip's own sound through. */
  keepsSound: boolean;
  /** No new take may start on it; kept so the takes it made still list and name it. */
  retired?: true;
  /**
   * What the engine refuses, so the clip is brought inside it before it is
   * sent (trim-run.ts re-encodes every clip for such an engine, cut or not).
   * Kling O3 Edit's schema, read 2026-09-19: 720–3840 px on each side,
   * 24–60 fps. The operator's own source was 61 fps and 324 px tall.
   */
  accepts?: { minSide: number; maxSide: number; minFps: number; maxFps: number };
  /**
   * Past its own 15 s the engine renders the take in chained pieces
   * (chain.ts) — the only engine measured to carry a character across a
   * piece's opening second, 2026-09-19.
   */
  chains?: true;
  /**
   * The clip is a REFERENCE, not a canvas: this engine rebuilds the scene
   * from it, so the camera and the staging can be directed — and the clip's
   * own performance is NOT kept (2026-09-20). Its references are billed in
   * tokens beside the output seconds (recastReferenceCostUsd).
   */
  restages?: true;
  /**
   * The engine's hard ceiling on the clip it is SENT, in seconds, measured
   * on the file. H3 refused a 0–15 s window (2026-09-20: "Video duration
   * exceeds the maximum allowed. Maximum is 15.0 seconds.") — a cut's last
   * audio packet ends a few hundredths past its video, and fal measures the
   * container. So the clip sent is cut a tenth under it (trim.ts).
   */
  maxSendSeconds?: number;
};

/** H3's own prompt takes 50,000 characters (its schema); ours stop at the same 6,000 Luma's do. */
const RECAST_H3_PROMPT_MAX = 6000;

export const RECAST_ENGINES: Record<RecastEngine, RecastEngineSpec> = {
  // RESTAGE (2026-09-20). The operator asked his clip to be re-staged — "start
  // focused on Eva and the camera zooms out", "Eva has her arms crossed" — and
  // an EDIT engine cannot do either: it keeps the performance and the camera
  // by design, so it silently ignored both ("the engine we are using is 100%
  // not fit for the job"). This one is the other family: the clip is a
  // REFERENCE, the characters are references, and the words direct the camera
  // and the staging. Probed the same day on his own 15 s window: the zoom-out,
  // the crossed arms, the Cleopatra styling and a courtyard of Anubis, first
  // try, 31 seconds, ~$1.07 for 5 s at 768p.
  //
  // WHAT IT DOES NOT DO, and is never sold as doing: keep the clip's own
  // performance. Into the clip is still the only job that promises that.
  "h3-768": {
    job: "restage",
    tier: "full",
    modelId: "recast-h3-768",
    label: "MiniMax H3 Max Reference to Video",
    endpoint: "minimax/h3-max/reference-to-video",
    // Read at source 2026-09-20: "$0.08 per second at 768p". References are
    // billed on top, in tokens — recastReferenceCostUsd.
    usdPerBilledSecond: 0.08,
    billedBy: "seconds",
    resolution: "720p",
    takesDirection: true,
    promptMax: RECAST_H3_PROMPT_MAX,
    takesMorePhotos: true,
    keepsSound: false,
    restages: true,
    maxSendSeconds: 15,
  },
  "h3-480": {
    job: "restage",
    tier: "lite",
    modelId: "recast-h3-480",
    label: "MiniMax H3 Max Reference to Video 480p",
    endpoint: "minimax/h3-max/reference-to-video",
    usdPerBilledSecond: 0.05,
    billedBy: "seconds",
    resolution: "480p",
    takesDirection: true,
    promptMax: RECAST_H3_PROMPT_MAX,
    takesMorePhotos: true,
    keepsSound: false,
    restages: true,
    maxSendSeconds: 15,
  },
  "kling-edit": {
    job: "scene",
    tier: "full",
    modelId: "recast-kling-edit",
    label: "Kling O3 Edit Pro",
    endpoint: "fal-ai/kling-video/o3/pro/video-to-video/edit",
    // $0.14 a unit (pricing API), 12 units for a 10.0 s take (ledger): the
    // page's "$0.168 for every second of video you generated", exactly.
    usdPerBilledSecond: 0.168,
    billedBy: "seconds",
    takesDirection: true,
    promptMax: 2500,
    takesMorePhotos: true,
    keepsSound: true,
    accepts: { minSide: 720, maxSide: 3840, minFps: 24, maxFps: 60 },
    chains: true,
  },
  "wan-scene-720": {
    job: "scene",
    tier: "full",
    modelId: "recast-wan-720",
    label: "Wan 2.2 Animate Replace 720p",
    endpoint: "fal-ai/wan/v2.2-14b/animate/replace",
    usdPerBilledSecond: 0.08,
    billedBy: "frames16",
    resolution: "720p",
    takesDirection: false,
    promptMax: 2500,
    takesMorePhotos: false,
    keepsSound: true,
    retired: true,
  },
  "wan-scene-480": {
    job: "scene",
    tier: "lite",
    modelId: "recast-wan-480",
    label: "Wan 2.2 Animate Replace 480p",
    endpoint: "fal-ai/wan/v2.2-14b/animate/replace",
    usdPerBilledSecond: 0.04,
    billedBy: "frames16",
    resolution: "480p",
    takesDirection: false,
    promptMax: 2500,
    takesMorePhotos: false,
    keepsSound: true,
    retired: true,
  },
  "kling-pro": {
    job: "motion",
    tier: "full",
    modelId: "recast-kling-pro",
    label: "Kling V3 Motion Control Pro",
    endpoint: "fal-ai/kling-video/v3/pro/motion-control",
    usdPerBilledSecond: 0.168,
    billedBy: "seconds",
    takesDirection: true,
    promptMax: 2500,
    takesMorePhotos: true,
    keepsSound: true,
  },
  "kling-std": {
    job: "motion",
    tier: "lite",
    modelId: "recast-kling-std",
    label: "Kling V3 Motion Control",
    endpoint: "fal-ai/kling-video/v3/standard/motion-control",
    usdPerBilledSecond: 0.126,
    billedBy: "seconds",
    takesDirection: true,
    promptMax: 2500,
    takesMorePhotos: true,
    keepsSound: true,
  },
  "luma-720": {
    job: "world",
    tier: "full",
    modelId: "recast-luma-720",
    label: "Luma Ray 3.2 720p",
    endpoint: "luma/agent/ray/v3.2/video-to-video",
    usdPerBilledSecond: 0.216,
    billedBy: "bucket",
    resolution: "720p",
    takesDirection: true,
    promptMax: 6000,
    takesMorePhotos: false,
    keepsSound: false,
  },
  "luma-540": {
    job: "world",
    tier: "lite",
    modelId: "recast-luma-540",
    label: "Luma Ray 3.2 540p",
    endpoint: "luma/agent/ray/v3.2/video-to-video",
    usdPerBilledSecond: 0.144,
    billedBy: "bucket",
    resolution: "540p",
    takesDirection: true,
    promptMax: 6000,
    takesMorePhotos: false,
    keepsSound: false,
  },
};

/** The longest brief any engine is sent — what a take's stored copy of its brief is bounded at. */
export const RECAST_PROMPT_MAX_CHARS = Math.max(...Object.values(RECAST_ENGINES).map((spec) => spec.promptMax));

/**
 * A brief brought inside an engine's prompt, counted the way the engines
 * count — in characters, not in UTF-16 halves. A plain `.slice` counts an
 * emoji as two, and a brief composed to fit by characters could lose its
 * last words (the person's direction) to the difference.
 */
export function recastFitPrompt(brief: string, max: number): string {
  const points = Array.from(brief);
  return points.length > max ? points.slice(0, max).join("") : brief;
}

/** What the door OFFERS, in order. Retired engines are not in it. */
export const RECAST_ENGINE_ORDER: RecastEngine[] = ["kling-edit", "h3-768", "h3-480", "kling-pro", "kling-std", "luma-720", "luma-540"];
export const RECAST_JOB_ORDER: RecastJob[] = ["scene", "restage", "motion", "world"];
/**
 * Every model id this lane has EVER recorded — retired ones included, so a
 * take made on Wan before 2026-09-19 still lists on the door and still names
 * its engine in History.
 */
export const RECAST_MODEL_IDS: string[] = (Object.keys(RECAST_ENGINES) as RecastEngine[]).map((e) => RECAST_ENGINES[e].modelId);

/**
 * Whether a job puts someone or something INTO the take — a character, or an
 * image the person adds. Restyle takes neither: its new look is said, never
 * shown.
 */
export function recastTakesCast(job: RecastJob): boolean {
  return job !== "world";
}

/**
 * Whether several characters can share ONE take — "One video, everyone in
 * it" — rather than one take each. Into the clip since 2026-09-19; Restage
 * since 2026-09-21 ("Still when selecting two characters in Restage it gives
 * me 2 takes"), whose engine names every reference picture on its own.
 * Photo to life builds the frame from one picture; Restyle casts nobody.
 */
export function recastCastsTogether(job: RecastJob): boolean {
  return job === "scene" || job === "restage";
}

/**
 * ONE REPLACEMENT PER TAKE (2026-09-23). Whether this take's cast puts a
 * character over a WHOLE GROUP — a crowd, a row, a class, as the read itself
 * judged it — and over somebody else in the same take.
 *
 * Paid for three times over on one 15 s stretch of a school courtyard, a man
 * in a white shirt in front of about forty boys. Asked on its own, replacing
 * the man held: he became the character where he stood, wore what the words
 * asked for, and the boys behind him kept their own faces, their ties and
 * their crest through the hard bow at the end. Asked to replace the man AND
 * turn all forty boys into someone else in the same take, the same stretch
 * came back with the character twice over — once where the man stood, once
 * where a front-row boy stood — and the boys fell back to themselves at that
 * bow, a second and a half before the end.
 *
 * So it is not the words: the words that failed here are the words that
 * worked alone. It is how much ONE take will carry. A group is a take's only
 * replacement; anyone else goes in a take of their own, which is the person's
 * own press to make — nothing here reassigns a role or splits a take behind
 * them.
 *
 * TWO REPLACEMENTS, AND ONLY WHERE THAT WAS MEASURED. What the money bought
 * is two people being replaced at once, on Into the clip, whose engine edits
 * the person's own footage. So this asks about replacements only:
 *
 *   a character the words merely PUT INTO the clip carries no tag, takes
 *   nobody's place, and is not counted — the sentence the person is shown,
 *   "your character turns up twice, once in their place and once in the
 *   crowd", says nothing that is true of them;
 *
 *   Restage is left alone. It casts from reference pictures instead of
 *   editing the footage, two characters in ONE Restage take were built on
 *   purpose (2026-09-21), and nothing was measured on that engine — a
 *   refusal we cannot show a render for is a feature taken away on a hunch.
 *
 * Given the job, the tags the take really casts (null where the words give
 * someone their part), and the tags the read marked as many.
 */
export function recastCrowdSharesTake(job: RecastJob, castTags: readonly (string | null)[], groupTags: ReadonlySet<string>): boolean {
  if (job !== "scene") return false;
  const replaced = castTags.filter((tag): tag is string => tag !== null);
  return replaced.length > 1 && replaced.some((tag) => groupTags.has(tag));
}

/**
 * What a take still needs before it can start. NOT LOCKED TO CHARACTERS
 * (2026-09-19, the operator: "make it that the user can upload an image and
 * that they can only use prompt to change whatever they want. Do not lock it
 * just on characters"):
 *
 *   scene   a character, OR words saying what should change — images the
 *           person adds ride along with either, and are named in the words
 *   motion  a picture to bring to life: a character's photo, or an image of
 *           the person's own (the engine builds the whole frame from it)
 *   world   nothing more — its look is words, and it has a default
 */
export function recastMissing(job: RecastJob, given: { characters: number; images: number; words: boolean }): "words" | "picture" | null {
  // Restage asks the same as Into the clip: someone to put in it, or words
  // saying what to build.
  if (job === "scene" || job === "restage") return given.characters > 0 || given.words ? null : "words";
  if (job === "motion") return given.characters > 0 || given.images > 0 ? null : "picture";
  return null;
}

// IMAGES THE PERSON ADDS (2026-09-19). Anything — a person, an outfit, a
// product, a place — uploaded the way every composer photo is (the
// chat-attachments bucket, the owner's own folder) and named in their words
// as "image 1", "image 2".
//
// How many: Kling O3 Edit takes FOUR references in all ("Maximum 4 total
// (elements + reference images) when using video", its schema), and a cast
// character takes one of them. Photo to life takes one picture.
export const RECAST_MAX_IMAGES = 3;
/** Restage takes nine reference images in all (its schema), characters and added images together. */
export const RECAST_RESTAGE_MAX_IMAGES = 9;

/**
 * How many added images a Restage take can still carry: nine pictures in
 * all, and every photo of every character in the take is one of them —
 * never more than the three a person can add.
 */
export function recastRestageImageRoom(photosPerCharacter: number[]): number {
  const photos = photosPerCharacter.reduce((sum, n) => sum + Math.max(1, n), 0);
  return Math.max(0, Math.min(RECAST_MAX_IMAGES, RECAST_RESTAGE_MAX_IMAGES - photos));
}
/** Every reference one Into the clip take can carry: characters and added images together (O3 Edit's schema). */
export const RECAST_MAX_REFERENCES = 4;
export const RECAST_IMAGE_BUCKET = "chat-attachments";

/**
 * How many images a take can still carry beside the characters in it — one
 * reference each. Several characters share one take only in Into the clip.
 */
export function recastImageRoom(charactersInTake: number, chained = false): number {
  // A long take spends one of the four on the still at each switch — the
  // last finished frame, which is what keeps a later part on the take's own
  // look (chain.ts ChainState.look, 2026-09-20).
  return Math.max(0, Math.min(RECAST_MAX_IMAGES, RECAST_MAX_REFERENCES - charactersInTake - (chained ? 1 : 0)));
}

/**
 * Whether a take of MORE THAN ONE PART can carry this cast (2026-09-22):
 * every character in it is one of the four references (an element or a
 * one-photo image, one place either way) and every later part needs one
 * more for the still at its switch. Four characters left the still no
 * place, and the request body silently sliced it off — a later part told,
 * in its own words, to follow a finished frame it was never sent. Such a
 * cast is refused before any credit moves; up to 15 s, in one piece, four
 * still fit. Added images are already fitted by recastImageRoom(n, true).
 */
export function recastChainFits(charactersInTake: number): boolean {
  return charactersInTake + 1 <= RECAST_MAX_REFERENCES;
}
// The tighter of the two engines' own limits, read from fal's schemas the same
// day: O3 Edit's references ≥ 300 px a side and ≤ 10 MB, V3 Motion Control's
// picture 340–3850 px; both between 0.4 and 2.5 wide for their height.
export const RECAST_IMAGE_MIN_SIDE_PX = 340;
export const RECAST_IMAGE_MAX_SIDE_PX = 3850;
export const RECAST_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const RECAST_IMAGE_MIN_RATIO = 0.4;
export const RECAST_IMAGE_MAX_RATIO = 2.5;
/** What an image that has to be redrawn is redrawn to fit inside. */
export const RECAST_IMAGE_SEND_MAX_PX = 2048;

/** Whether an image, at the size it DISPLAYS (EXIF turned), can be sent at all. Nothing redrawing it could fix. */
export function recastImageUsable(size: { width: number; height: number }): boolean {
  const { width, height } = size;
  if (!(width > 0 && height > 0)) return false;
  if (Math.min(width, height) < RECAST_IMAGE_MIN_SIDE_PX) return false;
  const ratio = width / height;
  return ratio >= RECAST_IMAGE_MIN_RATIO && ratio <= RECAST_IMAGE_MAX_RATIO;
}

/**
 * Whether the file can go to the engine exactly as it was uploaded: a JPEG or
 * PNG, upright as stored (an engine may ignore EXIF and see a phone portrait
 * sideways), inside the size and weight limits. Anything else is redrawn to a
 * plain JPEG first — which is also how a WebP or an AVIF gets in.
 */
export function recastImageSendsAsIs(image: { format: string; bytes: number; width: number; height: number; orientation: number }): boolean {
  return (
    (image.format === "jpeg" || image.format === "png") &&
    image.orientation <= 1 &&
    image.bytes <= RECAST_IMAGE_MAX_BYTES &&
    Math.max(image.width, image.height) <= RECAST_IMAGE_MAX_SIDE_PX
  );
}

export function recastEnginesOf(job: RecastJob): RecastEngine[] {
  return RECAST_ENGINE_ORDER.filter((e) => RECAST_ENGINES[e].job === job);
}

export function recastEngineFor(job: RecastJob, tier: "full" | "lite"): RecastEngine {
  return recastEnginesOf(job).find((e) => RECAST_ENGINES[e].tier === tier) ?? recastEnginesOf(job)[0];
}

/** An engine a NEW take may start on — offered, never retired. */
export function parseRecastEngine(raw: unknown): RecastEngine | null {
  return typeof raw === "string" && (RECAST_ENGINE_ORDER as string[]).includes(raw) ? (raw as RecastEngine) : null;
}

/** Any engine this lane ever used, retired or not — for reading takes back. */
export function recastEngineOfModel(modelId: string | null | undefined): RecastEngine | null {
  return (Object.keys(RECAST_ENGINES) as RecastEngine[]).find((e) => RECAST_ENGINES[e].modelId === modelId) ?? null;
}

/** The engine's name for a stored model id — History's engine line. */
export function recastEngineLabel(modelId: string | null | undefined): string | null {
  const engine = recastEngineOfModel(modelId);
  return engine ? RECAST_ENGINES[engine].label : null;
}

// The clip. Kling's schema (read 2026-09-17): 3.0–30.05 s in video
// orientation, 340–3850 px a side, 100 MB; DreamActor's: 30 s, 200–2048 px.
// Ours is the tighter of theirs and the storage bucket's 50 MB.
export const RECAST_MIN_SECONDS = 3;
export const RECAST_MAX_SECONDS = 30;
export const RECAST_MAX_BYTES = 50 * 1024 * 1024;
export const RECAST_MIN_SIDE_PX = 340;
export const RECAST_MAX_SIDE_PX = 3850;
export const RECAST_BUCKET = "recast-sources";

// What each job will take.
//
// SCENE STOPS AT 10 s FOR NOW. Wan took 304 s for 72 frames (2026-09-17
// probe). If that scales with frames, 30 s of phone footage is past the job
// runner's 45 minute write-off — a take abandoned on our side while the
// provider finishes and bills it. Ten seconds keeps the worst case near
// twenty minutes. A guess until a longer real take is timed; then it is one
// number to change.
//
// WORLD STOPS AT 10 s because Luma's own duration is a 5 s or 10 s slot.
// SCENE STOPS AT 15 s — Kling O3 Edit's own limit (3–15.05 s in its schema).
// Measured 559 s for 10 s (2026-09-19), so 15 s lands near 14 minutes, well
// inside the runner's 45-minute write-off. (Until 2026-09-19 it was 10 s, set
// by Wan's speed.)
//
// …AND PAST 15 s THE TAKE IS CHAINED (chain.ts, the same day): rendered in up
// to three pieces, each opening on the last second of the one before and
// switching to the footage at its stillest moment, then joined. The runner's
// write-off clock restarts with every piece, so the 45 minutes apply to one
// piece at a time. 30 s is the chain's ceiling, and Genjutsu's.
export const RECAST_JOB_MAX_SECONDS: Record<RecastJob, number> = { scene: CHAIN_MAX_SECONDS, motion: 30, world: 10, restage: 15 };

// RESTAGE, priced whole (2026-09-20). Its references are billed beside the
// output: every request carries 4,096 tokens free, then $0.02 per 1,000.
// From fal’s own table that day — a 16:9 reference video is 12,096 tokens at
// 2 s, 32,256 at 5 s, 67,536 at 10 s and 102,816 at 15 s for 768p/1080p, and
// 4,680 / 12,480 / 26,130 / 39,780 at 480p — the worst per-second rate is
// taken, so a quote is never under the bill. A reference image is counted at
// its dearest shape, 16:9 at 1,824 tokens.
export const RECAST_REFERENCE_FREE_TOKENS = 4096;
export const RECAST_REFERENCE_USD_PER_1K = 0.02;
export const RECAST_REFERENCE_IMAGE_TOKENS = 1824;
const REFERENCE_VIDEO_TOKENS_PER_SECOND: Record<"480p" | "720p", number> = { "480p": 2652, "720p": 6854 };

/** What the references on a restage cost on top of its seconds. */
export function recastReferenceCostUsd(input: { seconds: number; resolution: "480p" | "720p"; images: number }): number {
  const tokens = Math.ceil(input.seconds) * REFERENCE_VIDEO_TOKENS_PER_SECOND[input.resolution] + input.images * RECAST_REFERENCE_IMAGE_TOKENS;
  return (Math.max(0, tokens - RECAST_REFERENCE_FREE_TOKENS) * RECAST_REFERENCE_USD_PER_1K) / 1000;
}

/** The output this engine renders for a window: its own 5–15 s, whole seconds. */
export function recastRestageSeconds(windowSeconds: number): number {
  return Math.min(15, Math.max(5, Math.round(windowSeconds)));
}

export type RecastClip = { seconds: number; frames: number | null; width: number; height: number; bytes: number };

export type RecastClipProblem = "too-short" | "too-long" | "too-big" | "too-small" | "too-large";

// A hair of tolerance: a "3 second" phone clip is often 2.97.
const SLACK = 0.05;

/** Limits every take shares, whatever the job. */
export function recastClipProblem(clip: RecastClip): RecastClipProblem | null {
  if (!(clip.seconds >= RECAST_MIN_SECONDS - SLACK)) return "too-short";
  if (clip.seconds > RECAST_MAX_SECONDS + SLACK) return "too-long";
  if (clip.bytes <= 0 || clip.bytes > RECAST_MAX_BYTES) return "too-big";
  if (Math.min(clip.width, clip.height) < RECAST_MIN_SIDE_PX) return "too-small";
  if (Math.max(clip.width, clip.height) > RECAST_MAX_SIDE_PX) return "too-large";
  return null;
}

/** Whether this engine's job takes a clip of this length. */
export function recastEngineFits(engine: RecastEngine, clip: Pick<RecastClip, "seconds">): boolean {
  return clip.seconds <= RECAST_JOB_MAX_SECONDS[RECAST_ENGINES[engine].job] + SLACK;
}

const UNKNOWN_FPS_CEILING = 60;

/** Luma's slot for a clip: the 5 s one, or the 10 s one. */
export function recastLumaDuration(clip: Pick<RecastClip, "seconds">): "5s" | "10s" {
  return clip.seconds > 5 + SLACK ? "10s" : "5s";
}

/** What the provider will bill this clip as, in its own unit of seconds. */
export function recastBilledSeconds(engine: RecastEngine, clip: Pick<RecastClip, "seconds" | "frames">): number {
  const spec = RECAST_ENGINES[engine];
  // A chained take is billed piece by piece, overlap and rounding included —
  // priced at the most that can come to (chain.ts), which up to 15 s is the
  // plain ceiling below.
  if (spec.restages) return recastRestageSeconds(clip.seconds);
  if (spec.chains) return chainBilledSeconds(clip.seconds);
  if (spec.billedBy === "seconds") return Math.ceil(clip.seconds - SLACK);
  if (spec.billedBy === "bucket") return recastLumaDuration(clip) === "10s" ? 10 : 5;
  const frames = clip.frames ?? Math.ceil(clip.seconds * UNKNOWN_FPS_CEILING);
  return frames / 16;
}

export function recastProviderCostUsd(engine: RecastEngine, clip: Pick<RecastClip, "seconds" | "frames">, references = 0): number {
  const spec = RECAST_ENGINES[engine];
  const output = spec.usdPerBilledSecond * recastBilledSeconds(engine, clip);
  if (!spec.restages) return output;
  // The clip itself is one reference, and every photo another.
  return (
    output +
    recastReferenceCostUsd({
      seconds: recastRestageSeconds(clip.seconds),
      resolution: spec.resolution === "480p" ? "480p" : "720p",
      images: references,
    })
  );
}

/** The take's price in credits: provider cost over the house basis, rounded up, never under one. */
export function recastCreditCost(engine: RecastEngine, clip: Pick<RecastClip, "seconds" | "frames">, references = 0): number {
  // The epsilon keeps a cost of exactly one basis at one credit in floating point.
  return Math.max(1, Math.ceil(recastProviderCostUsd(engine, clip, references) / RECAST_COST_BASIS_USD_PER_CREDIT - 1e-9));
}

// The source clip's home: one object per take, named by the take — so the
// before/after viewer finds a take's footage from its id alone and no column
// is needed. The id is minted when the upload is reserved and becomes the
// generation's id when the take starts. A take made from ANOTHER take's
// footage (the motion library) stores no clip of its own and reads the
// source take's video instead.
export type RecastContainer = "mp4" | "mov";

export function recastSourcePath(userId: string, takeId: string, container: RecastContainer): string {
  return `${userId}/${takeId}.${container}`;
}

const SOURCE_PATH_RE = /^([0-9a-f-]{36})\/([0-9a-f-]{36})\.(mp4|mov)$/;

/** Reads a reserved path back; null for anything that is not exactly one of ours. */
export function parseRecastSourcePath(path: string): { userId: string; takeId: string; container: RecastContainer } | null {
  const m = SOURCE_PATH_RE.exec(path);
  return m ? { userId: m[1], takeId: m[2], container: m[3] as RecastContainer } : null;
}

// ANY VIDEO A PERSON HAS IN HAND (2026-09-25, operator: "Tried uploading a
// video to recast and it failed because of file formats"). The door took
// MP4 and MOV and nothing else — and only when the browser named the type,
// which it often does not for an .mkv or an .avi. Now the rest upload as
// they are and the server converts them to an H.264 MP4 (convert-run.ts)
// before anything is read for money, so a take still stands on an MP4 or a
// MOV and nothing downstream changed.
//
// The upload's type is recognised by what the browser says, and failing
// that by its name: a Windows browser calls an .mts "model/vnd.mts" and a
// .ts "video/vnd.dlna.mpeg-tts", and an .mkv is often "" (no type at all).
// Each format uploads under ONE type of ours — the one the bucket admits
// (recast-formats.sql) — whatever the browser called it.
export type RecastUploadFormat = RecastContainer | "webm" | "mkv" | "avi" | "wmv" | "flv" | "3gp" | "mpg" | "ts" | "ogv";

type RecastFormatSpec = { format: RecastUploadFormat; contentType: string; alsoTypes: string[]; extensions: string[] };

const RECAST_FORMATS: RecastFormatSpec[] = [
  // An .m4v is an MP4 by another name, and uploads as one.
  { format: "mp4", contentType: "video/mp4", alsoTypes: ["video/x-m4v"], extensions: ["mp4", "m4v"] },
  { format: "mov", contentType: "video/quicktime", alsoTypes: [], extensions: ["mov", "qt"] },
  { format: "webm", contentType: "video/webm", alsoTypes: [], extensions: ["webm"] },
  { format: "mkv", contentType: "video/x-matroska", alsoTypes: ["video/matroska"], extensions: ["mkv"] },
  { format: "avi", contentType: "video/x-msvideo", alsoTypes: ["video/avi", "video/msvideo"], extensions: ["avi"] },
  { format: "wmv", contentType: "video/x-ms-wmv", alsoTypes: ["video/x-ms-asf"], extensions: ["wmv", "asf"] },
  { format: "flv", contentType: "video/x-flv", alsoTypes: [], extensions: ["flv"] },
  { format: "3gp", contentType: "video/3gpp", alsoTypes: ["video/3gpp2"], extensions: ["3gp", "3g2"] },
  { format: "mpg", contentType: "video/mpeg", alsoTypes: [], extensions: ["mpg", "mpeg"] },
  { format: "ts", contentType: "video/mp2t", alsoTypes: ["video/vnd.dlna.mpeg-tts", "model/vnd.mts"], extensions: ["ts", "mts", "m2ts"] },
  { format: "ogv", contentType: "video/ogg", alsoTypes: [], extensions: ["ogv"] },
];

/** Every type an upload is stored under — exactly the bucket's allowed list (recast-formats.sql). */
export const RECAST_UPLOAD_TYPES: string[] = RECAST_FORMATS.map((f) => f.contentType);

/** The file picker's filter: any video, plus the names a browser may not know as video. */
export const RECAST_UPLOAD_ACCEPT: string = ["video/*", ...RECAST_FORMATS.flatMap((f) => f.extensions.map((e) => `.${e}`))].join(",");

/**
 * What an upload is, from what the browser called it and, failing that, its
 * name. Null for anything that is neither — the file is refused before a
 * byte is sent.
 */
export function recastUploadFormatOf(file: { type: string; name: string }): { format: RecastUploadFormat; contentType: string } | null {
  const type = (typeof file?.type === "string" ? file.type : "").toLowerCase().split(";")[0].trim();
  const byType = RECAST_FORMATS.find((f) => f.contentType === type || f.alsoTypes.includes(type));
  if (byType) return { format: byType.format, contentType: byType.contentType };
  const ext = /\.([a-z0-9]{2,4})$/i.exec(typeof file?.name === "string" ? file.name : "")?.[1]?.toLowerCase() ?? "";
  const byName = RECAST_FORMATS.find((f) => f.extensions.includes(ext));
  return byName ? { format: byName.format, contentType: byName.contentType } : null;
}

/** Whether an upload is converted before it is read: everything but MP4 and MOV. */
export function recastFormatConverts(format: RecastUploadFormat): boolean {
  return format !== "mp4" && format !== "mov";
}

/**
 * Video codecs sent as they are, in an MP4 or a MOV. H.264 and HEVC —
 * what every phone and screen recorder makes. Anything else inside the
 * right box (an old camera's Motion JPEG, MPEG-4 Part 2, ProRes) is
 * converted like a foreign file. A codec the probe cannot name is sent as
 * it always was.
 */
const RECAST_SENDABLE_CODECS = new Set(["avc1", "avc3", "hvc1", "hev1"]);

export function recastCodecSends(codec: string | null): boolean {
  return codec === null || RECAST_SENDABLE_CODECS.has(codec);
}

export function recastUploadPath(userId: string, takeId: string, format: RecastUploadFormat): string {
  return `${userId}/${takeId}.${format}`;
}

const UPLOAD_PATH_RE = new RegExp(`^([0-9a-f-]{36})\\/([0-9a-f-]{36})\\.(${RECAST_FORMATS.map((f) => f.format).join("|")})$`);

/**
 * Reads back a path the door was given to upload to, whatever its format —
 * for the read and the discard. A TAKE is only ever started on
 * parseRecastSourcePath's MP4 or MOV, so a file that was never converted
 * cannot be sent to an engine.
 */
export function parseRecastUploadPath(path: string): { userId: string; takeId: string; format: RecastUploadFormat } | null {
  const m = UPLOAD_PATH_RE.exec(path);
  return m ? { userId: m[1], takeId: m[2], format: m[3] as RecastUploadFormat } : null;
}

/**
 * The request each engine receives — the bodies the probes sent, unchanged.
 *
 * Kling: the character's orientation follows the VIDEO (the mode that takes
 * 30 s and complex motion), the clip's own sound rides, the brief goes in the
 * prompt, and `elements` binds identity to up to four of the character's own
 * photos — one frontal plus three more angles — which is the one place a
 * Picacho character beats a stranger's single reference.
 *
 * Wan takes no prompt and no sound switch, and kept the sound anyway.
 * DreamActor trims its own one-second lead-in.
 * Luma edits the world from the brief and keeps the performance; its slot is
 * 5 s or 10 s. `edit_strength` is how tightly it holds the source, and the
 * 2026-09-18 probe settled two things about it: fal REFUSES the request when
 * `auto_controls` rides alongside it ("auto_controls=true cannot be combined
 * with edit_strength"), and at `flex_2` the edit rewrote the performer as
 * well as the street — the one thing this job may not do. So the strength is
 * sent alone, and it adheres.
 */
export function recastRequestBody(
  engine: RecastEngine,
  input: {
    clipUrl: string;
    characterImageUrl?: string;
    /** More angles of the same character, for the engines that bind identity. */
    morePhotoUrls?: string[];
    /** Images the person added, in order — @Image1… after a one-photo character's own. Into the clip only. */
    imageUrls?: string[];
    /**
     * Several characters in ONE take (Into the clip only), in cast order:
     * each one's front photo and its other angles. Takes the place of
     * characterImageUrl / morePhotoUrls.
     */
    ensemble?: { front: string; more: string[] }[];
    brief?: string;
    clip?: Pick<RecastClip, "seconds">;
  },
): Record<string, unknown> {
  const spec = RECAST_ENGINES[engine];
  if (spec.restages) {
    // The clip is Video 1 and every photo an Image, in the order the brief
    // names them; the words carry the camera and the staging. Its own output
    // length, 5–15 whole seconds (its schema), and no sound of the clip's.
    const images = [
      ...(input.ensemble ? input.ensemble.flatMap((p) => [p.front, ...p.more]) : input.characterImageUrl ? [input.characterImageUrl, ...(input.morePhotoUrls ?? [])] : []),
      ...(input.imageUrls ?? []),
    ].slice(0, RECAST_RESTAGE_MAX_IMAGES);
    return {
      prompt: recastFitPrompt(input.brief ?? "", spec.promptMax),
      // H3 rewrites the prompt before it renders ("balanced", its default).
      // Kept on (2026-09-22): switching it off is untested, and the one
      // Restage that came back right first try was sent this way. What it
      // rewrote the brief into comes back as the result's `expanded_prompt`.
      prompt_expansion_mode: "balanced",
      reference_video_urls: [input.clipUrl],
      ...(images.length > 0 ? { reference_image_urls: images } : {}),
      duration: recastRestageSeconds(input.clip?.seconds ?? 5),
      resolution: spec.resolution === "480p" ? "480P" : "768P",
      aspect_ratio: "adaptive",
    };
  }
  if (spec.job === "world") {
    return {
      video_url: input.clipUrl,
      prompt: recastFitPrompt(input.brief ?? "", spec.promptMax),
      resolution: spec.resolution,
      duration: input.clip ? recastLumaDuration(input.clip) : "5s",
      edit_strength: RECAST_WORLD_EDIT_STRENGTH,
    };
  }
  if (spec.job === "scene") {
    if (engine !== "kling-edit") {
      // A retired engine: kept only so the shape it was sent is on record.
      return { image_url: input.characterImageUrl, video_url: input.clipUrl, resolution: spec.resolution };
    }
    // Kling O3 Edit re-renders the whole clip with the character bound to
    // SEVERAL photos — which is what keeps them themselves when they turn
    // their back. One element (the front photo plus up to three more
    // angles), named @Element1 in the brief; a character with only one photo
    // is given it as @Image1 instead, because an element needs at least one
    // more angle than its front. The brief names the clip @Video1.
    //
    // Images the person added follow as @Image1… (after the one-photo
    // character's own @Image1), inside the four references the engine takes
    // in all. With no character and no image the body is the clip and the
    // words alone — a plain edit, which the schema allows (only prompt and
    // video_url are required).
    //
    // SEVERAL CHARACTERS IN ONE TAKE (2026-09-19, "Selecting two characters
    // still makes two videos separately"): each is bound the same way, in
    // cast order — @Element1, @Element2 for those with more angles, @Image1…
    // for those with one photo — the order recastCastTokens names them in.
    const people =
      input.ensemble ??
      (input.characterImageUrl ? [{ front: input.characterImageUrl, more: input.morePhotoUrls ?? [] }] : []);
    const elements = people
      .filter((p) => p.more.length > 0)
      .map((p) => ({ frontal_image_url: p.front, reference_image_urls: p.more.slice(0, 3) }))
      .slice(0, RECAST_MAX_REFERENCES);
    // The person's own images are capped on their own, and the still at the
    // switch rides AFTER them: capping them together dropped the still on a
    // long take with nobody cast and three images — the one shape whose
    // added images fill RECAST_MAX_IMAGES exactly — and the guard below then
    // failed the take after its credits were spent (review, 2026-09-22).
    const added = (input.imageUrls ?? []).filter((u) => u !== CHAIN_LOOK_PLACEHOLDER).slice(0, RECAST_MAX_IMAGES);
    const look = (input.imageUrls ?? []).includes(CHAIN_LOOK_PLACEHOLDER) ? [CHAIN_LOOK_PLACEHOLDER] : [];
    const images = [
      ...people.filter((p) => p.more.length === 0).map((p) => p.front),
      ...added,
      ...look,
    ].slice(0, RECAST_MAX_REFERENCES - elements.length);
    // THE STILL IS NEVER SLICED OFF (2026-09-22). A later part of a long
    // take is told, in its own words, that its last image IS the finished
    // frame it carries on from — the one thing that keeps it on the take's
    // look and off the footage's. It rides last, so the room slice above
    // is exactly where it would fall away without a word if a cast ever
    // grew past what a long take can carry. recastChainFits refuses such a
    // cast before any credit moves; here the body refuses too, rather than
    // send a part told to follow a picture it was never given.
    if ((input.imageUrls ?? []).includes(CHAIN_LOOK_PLACEHOLDER) && !images.includes(CHAIN_LOOK_PLACEHOLDER)) {
      throw new Error("A long take's part has no room left for the finished frame it carries on from.");
    }
    return {
      video_url: input.clipUrl,
      prompt: recastFitPrompt(input.brief ?? "", spec.promptMax),
      keep_audio: true,
      ...(elements.length > 0 ? { elements } : {}),
      ...(images.length > 0 ? { image_urls: images } : {}),
    };
  }
  const more = (input.morePhotoUrls ?? []).slice(0, 3);
  return {
    image_url: input.characterImageUrl,
    video_url: input.clipUrl,
    character_orientation: "video",
    keep_original_sound: true,
    ...(input.brief ? { prompt: recastFitPrompt(input.brief, spec.promptMax) } : {}),
    // Only when there are more angles to bind: with one photo the element
    // would say nothing the image_url does not already say. Kling allows one
    // element, and only in video orientation.
    ...(input.characterImageUrl && more.length > 0
      ? { elements: [{ frontal_image_url: input.characterImageUrl, reference_image_urls: more }] }
      : {}),
  };
}
