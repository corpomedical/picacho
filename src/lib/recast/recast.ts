// Recast — "Mystique" on the door (the operator's working title,
// 2026-09-17; the name lives in the dictionary and the route, nowhere
// else, so changing it never touches a stored id).
//
// THE JOB: a clip of someone performing goes in, the same performance
// comes out with a saved character in their place — the acting, the
// timing and the sound kept. It is the answer to Higgsfield's Genjutsu,
// whose point the Recce missed: the performance is the product.
//
// TWO JOBS, NOT TWO RIVAL ENGINES. The 2026-09-17 probe put one photo of
// Eva through the same 3 s performance on both engines and they did
// different things — the same two things Genjutsu sells as its two modes:
//
//   "scene"   Wan 2.2 Animate Replace. The character stands INSIDE the
//             clip: its room, its light, its framing, its sound. Out came
//             720×1280 at the clip's 24 fps, sound kept, in 304 s.
//   "motion"  Kling V3 Motion Control. The character's PHOTO comes alive
//             with the clip's performance: the photo's world and framing
//             are kept, the clip's scene is gone. Out came 1936×1072 (the
//             photo's shape, not the clip's), sound kept, in 152 s.
//
// Pure and alias-free on purpose: the door quotes with this, the action
// charges with it, and recast.test.ts audits both against the prices read
// at source.
//
// MONEY, read from fal's model pages 2026-09-17 (their words):
//   Kling V3 Motion Control Pro       "Your request will cost $0.168 per second."
//   Kling V3 Motion Control Standard  "Your request will cost $0.126 per second."
//   Wan 2.2 Animate Replace           "720p: $0.08 per video second … 480p:
//     $0.04 per video second" and "Video seconds (billed) = total frames ÷ 16"
// and CHECKED against fal's own ledger for the probe's two requests the
// same day: Wan billed 4.5 units for the 72-frame clip (72 ÷ 16), Kling
// billed 3 units for the 3.0 s clip — the clip's length once, not input
// plus output the way Seedance bills a video reference.
//
// So Wan's price follows the clip's FRAMES, not its length: ten seconds of
// 30 fps footage bills 18.75 "video seconds". The frame count is read from
// the file (mp4-probe.ts); a file that will not give one is priced at
// 60 fps, the safe direction to be wrong in.
//
// Credits are the catalogue's own rule — provider cost over the $0.28
// basis, rounded up (video-models.ts) — restated here as a number because
// that module pulls the whole catalogue in; the test pins the two equal.

export const RECAST_COST_BASIS_USD_PER_CREDIT = 0.28;

export type RecastMode = "scene" | "motion";
export type RecastEngine = "wan-720" | "wan-480" | "kling-pro" | "kling-std";

export type RecastEngineSpec = {
  mode: RecastMode;
  /** The mode's first choice, or its cheaper pass. */
  tier: "full" | "lite";
  /** What generations.video_model_id / model_id record. Never renamed once rows exist. */
  modelId: string;
  /** The engine's own name — History's detail line and provider errors. */
  label: string;
  endpoint: string;
  usdPerBilledSecond: number;
  /** Kling bills the clip's seconds; Wan bills frames ÷ 16. */
  billedBy: "seconds" | "frames16";
  /** Wan's output size; Kling takes none. */
  resolution?: "480p" | "720p";
};

export const RECAST_ENGINES: Record<RecastEngine, RecastEngineSpec> = {
  "wan-720": {
    mode: "scene",
    tier: "full",
    modelId: "recast-wan-720",
    label: "Wan 2.2 Animate Replace 720p",
    endpoint: "fal-ai/wan/v2.2-14b/animate/replace",
    usdPerBilledSecond: 0.08,
    billedBy: "frames16",
    resolution: "720p",
  },
  "wan-480": {
    mode: "scene",
    tier: "lite",
    modelId: "recast-wan-480",
    label: "Wan 2.2 Animate Replace 480p",
    endpoint: "fal-ai/wan/v2.2-14b/animate/replace",
    usdPerBilledSecond: 0.04,
    billedBy: "frames16",
    resolution: "480p",
  },
  "kling-pro": {
    mode: "motion",
    tier: "full",
    modelId: "recast-kling-pro",
    label: "Kling V3 Motion Control Pro",
    endpoint: "fal-ai/kling-video/v3/pro/motion-control",
    usdPerBilledSecond: 0.168,
    billedBy: "seconds",
  },
  "kling-std": {
    mode: "motion",
    tier: "lite",
    modelId: "recast-kling-std",
    label: "Kling V3 Motion Control",
    endpoint: "fal-ai/kling-video/v3/standard/motion-control",
    usdPerBilledSecond: 0.126,
    billedBy: "seconds",
  },
};

export const RECAST_ENGINE_ORDER: RecastEngine[] = ["wan-720", "wan-480", "kling-pro", "kling-std"];
export const RECAST_MODE_ORDER: RecastMode[] = ["scene", "motion"];
export const RECAST_MODEL_IDS: string[] = RECAST_ENGINE_ORDER.map((e) => RECAST_ENGINES[e].modelId);

export function recastEnginesOf(mode: RecastMode): RecastEngine[] {
  return RECAST_ENGINE_ORDER.filter((e) => RECAST_ENGINES[e].mode === mode);
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
// orientation, 340–3850 px a side, 100 MB. Ours is the tighter of theirs
// and the storage bucket's 50 MB; Wan documents no limits, so it rides the
// same ones — except length:
//
// SCENE TAKES STOP AT 10 s FOR NOW. Wan took 304 s for 72 frames. If that
// scales with frames, 30 s of phone footage is past the job runner's 45
// minute write-off — a take abandoned on our side while the provider
// finishes and bills it. Ten seconds keeps the worst case near twenty
// minutes. It is a guess until a longer real take is timed; then this is
// one number to change.
export const RECAST_MIN_SECONDS = 3;
export const RECAST_MAX_SECONDS = 30;
export const RECAST_MODE_MAX_SECONDS: Record<RecastMode, number> = { scene: 10, motion: 30 };
export const RECAST_MAX_BYTES = 50 * 1024 * 1024;
export const RECAST_MIN_SIDE_PX = 340;
export const RECAST_MAX_SIDE_PX = 3850;
export const RECAST_BUCKET = "recast-sources";

export type RecastClip = { seconds: number; frames: number | null; width: number; height: number; bytes: number };

export type RecastClipProblem = "too-short" | "too-long" | "too-big" | "too-small" | "too-large";

// A hair of tolerance: a "3 second" phone clip is often 2.97.
const SLACK = 0.05;

/** Limits every take shares, whatever the mode. */
export function recastClipProblem(clip: RecastClip): RecastClipProblem | null {
  if (!(clip.seconds >= RECAST_MIN_SECONDS - SLACK)) return "too-short";
  if (clip.seconds > RECAST_MAX_SECONDS + SLACK) return "too-long";
  if (clip.bytes <= 0 || clip.bytes > RECAST_MAX_BYTES) return "too-big";
  if (Math.min(clip.width, clip.height) < RECAST_MIN_SIDE_PX) return "too-small";
  if (Math.max(clip.width, clip.height) > RECAST_MAX_SIDE_PX) return "too-large";
  return null;
}

/** Whether this engine's mode takes a clip of this length. */
export function recastEngineFits(engine: RecastEngine, clip: Pick<RecastClip, "seconds">): boolean {
  return clip.seconds <= RECAST_MODE_MAX_SECONDS[RECAST_ENGINES[engine].mode] + SLACK;
}

const UNKNOWN_FPS_CEILING = 60;

/** What the provider will bill this clip as, in its own unit of seconds. */
export function recastBilledSeconds(engine: RecastEngine, clip: Pick<RecastClip, "seconds" | "frames">): number {
  if (RECAST_ENGINES[engine].billedBy === "seconds") return Math.ceil(clip.seconds - SLACK);
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
// before/after viewer finds a take's footage from its id alone and no
// column is needed. The id is minted when the upload is reserved and
// becomes the generation's id when the take starts.
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
 * The request each engine receives — the bodies the 2026-09-17 probe sent,
 * unchanged. Kling: the character's orientation follows the VIDEO (the mode
 * that takes 30 s and complex motion) and the clip's own sound rides. Wan
 * takes no sound switch and kept the sound anyway.
 */
export function recastRequestBody(engine: RecastEngine, input: { characterImageUrl: string; clipUrl: string }): Record<string, unknown> {
  const spec = RECAST_ENGINES[engine];
  if (spec.mode === "motion") {
    return {
      image_url: input.characterImageUrl,
      video_url: input.clipUrl,
      character_orientation: "video",
      keep_original_sound: true,
    };
  }
  return { image_url: input.characterImageUrl, video_url: input.clipUrl, resolution: spec.resolution };
}
