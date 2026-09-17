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
//           framing, its sound. Wan 2.2 Animate Replace.
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

export const RECAST_COST_BASIS_USD_PER_CREDIT = 0.28;

/** How tightly the world job holds the source. See recastRequestBody. */
export const RECAST_WORLD_EDIT_STRENGTH = "adhere_2";

export type RecastJob = "scene" | "motion" | "world";
export type RecastEngine =
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
   * Takes extra photos of the character for identity (Kling's `elements`:
   * one frontal image plus 1–3 more angles). The rest see one photo.
   */
  takesMorePhotos: boolean;
  /** Carries the clip's own sound through. */
  keepsSound: boolean;
};

export const RECAST_ENGINES: Record<RecastEngine, RecastEngineSpec> = {
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
    takesMorePhotos: false,
    keepsSound: true,
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
    takesMorePhotos: false,
    keepsSound: true,
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
    takesMorePhotos: false,
    keepsSound: false,
  },
};

export const RECAST_ENGINE_ORDER: RecastEngine[] = [
  "wan-scene-720",
  "wan-scene-480",
  "kling-pro",
  "kling-std",
  "luma-720",
  "luma-540",
];
export const RECAST_JOB_ORDER: RecastJob[] = ["scene", "motion", "world"];
export const RECAST_MODEL_IDS: string[] = RECAST_ENGINE_ORDER.map((e) => RECAST_ENGINES[e].modelId);

/** The one job that recasts nobody — it rewrites the world around the performance. */
export function recastNeedsCharacter(job: RecastJob): boolean {
  return job !== "world";
}

export function recastEnginesOf(job: RecastJob): RecastEngine[] {
  return RECAST_ENGINE_ORDER.filter((e) => RECAST_ENGINES[e].job === job);
}

export function recastEngineFor(job: RecastJob, tier: "full" | "lite"): RecastEngine {
  return recastEnginesOf(job).find((e) => RECAST_ENGINES[e].tier === tier) ?? recastEnginesOf(job)[0];
}

export function parseRecastEngine(raw: unknown): RecastEngine | null {
  return typeof raw === "string" && Object.prototype.hasOwnProperty.call(RECAST_ENGINES, raw) ? (raw as RecastEngine) : null;
}

export function recastEngineOfModel(modelId: string | null | undefined): RecastEngine | null {
  return RECAST_ENGINE_ORDER.find((e) => RECAST_ENGINES[e].modelId === modelId) ?? null;
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
export const RECAST_JOB_MAX_SECONDS: Record<RecastJob, number> = { scene: 10, motion: 30, world: 10 };

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
  if (spec.billedBy === "seconds") return Math.ceil(clip.seconds - SLACK);
  if (spec.billedBy === "bucket") return recastLumaDuration(clip) === "10s" ? 10 : 5;
  const frames = clip.frames ?? Math.ceil(clip.seconds * UNKNOWN_FPS_CEILING);
  return frames / 16;
}

export function recastProviderCostUsd(engine: RecastEngine, clip: Pick<RecastClip, "seconds" | "frames">): number {
  return RECAST_ENGINES[engine].usdPerBilledSecond * recastBilledSeconds(engine, clip);
}

/** The take's price in credits: provider cost over the house basis, rounded up, never under one. */
export function recastCreditCost(engine: RecastEngine, clip: Pick<RecastClip, "seconds" | "frames">): number {
  // The epsilon keeps a cost of exactly one basis at one credit in floating point.
  return Math.max(1, Math.ceil(recastProviderCostUsd(engine, clip) / RECAST_COST_BASIS_USD_PER_CREDIT - 1e-9));
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

export function recastContainerOf(mimeType: string): RecastContainer | null {
  if (mimeType === "video/mp4") return "mp4";
  if (mimeType === "video/quicktime") return "mov";
  return null;
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
    brief?: string;
    clip?: Pick<RecastClip, "seconds">;
  },
): Record<string, unknown> {
  const spec = RECAST_ENGINES[engine];
  if (spec.job === "world") {
    return {
      video_url: input.clipUrl,
      prompt: input.brief ?? "",
      resolution: spec.resolution,
      duration: input.clip ? recastLumaDuration(input.clip) : "5s",
      edit_strength: RECAST_WORLD_EDIT_STRENGTH,
    };
  }
  if (spec.job === "scene") {
    return { image_url: input.characterImageUrl, video_url: input.clipUrl, resolution: spec.resolution };
  }
  const more = (input.morePhotoUrls ?? []).slice(0, 3);
  return {
    image_url: input.characterImageUrl,
    video_url: input.clipUrl,
    character_orientation: "video",
    keep_original_sound: true,
    ...(input.brief ? { prompt: input.brief.slice(0, 2500) } : {}),
    // Only when there are more angles to bind: with one photo the element
    // would say nothing the image_url does not already say. Kling allows one
    // element, and only in video orientation.
    ...(input.characterImageUrl && more.length > 0
      ? { elements: [{ frontal_image_url: input.characterImageUrl, reference_image_urls: more }] }
      : {}),
  };
}
