// Per-account composer defaults (Settings → Generation, 2026-09-11) — the
// pure half: shape, validation, and how a stored preference resolves
// against what the composer can actually offer. Relative imports only, so
// vitest can load it (the repo's "@/" alias gotcha).
import type { VideoDurationOption } from "./providers/video-models";

export type AspectRatioPref = "16:9" | "9:16";

export type GenerationDefaults = {
  /** A video model id, or null for Picacho's default. */
  videoModel: string | null;
  aspectRatio: AspectRatioPref | null;
  /** Seconds, or null for the model's own default length. */
  durationSeconds: number | null;
  /** Generate a soundtrack with videos (models that can). */
  sound: boolean;
};

export const NO_DEFAULTS: GenerationDefaults = { videoModel: null, aspectRatio: null, durationSeconds: null, sound: true };

type ModelLike = { id: string; durations: readonly VideoDurationOption[] | VideoDurationOption[] };

/**
 * Validate a submitted set of defaults against the models this account may
 * pick. Returns the cleaned value, or an error code. A duration is only
 * valid for the chosen model (or, with no model chosen, for the default
 * model the composer will open on).
 */
export function validateGenerationDefaults(
  input: { videoModel: unknown; aspectRatio: unknown; durationSeconds: unknown; sound: unknown },
  offered: readonly ModelLike[],
  fallbackModelId: string,
): { ok: true; value: GenerationDefaults } | { ok: false; error: "model" | "aspect" | "duration" | "sound" } {
  const rawModel = typeof input.videoModel === "string" && input.videoModel.trim() ? input.videoModel.trim() : null;
  if (rawModel !== null && !offered.some((m) => m.id === rawModel)) return { ok: false, error: "model" };

  const rawAspect = typeof input.aspectRatio === "string" && input.aspectRatio ? input.aspectRatio : null;
  if (rawAspect !== null && rawAspect !== "16:9" && rawAspect !== "9:16") return { ok: false, error: "aspect" };

  let seconds: number | null = null;
  if (input.durationSeconds !== null && input.durationSeconds !== undefined && input.durationSeconds !== "") {
    const n = Number(input.durationSeconds);
    const model = offered.find((m) => m.id === (rawModel ?? fallbackModelId));
    if (!Number.isInteger(n) || !model || !model.durations.some((d) => d.seconds === n)) {
      return { ok: false, error: "duration" };
    }
    seconds = n;
  }

  if (typeof input.sound !== "boolean") return { ok: false, error: "sound" };

  return { ok: true, value: { videoModel: rawModel, aspectRatio: rawAspect as AspectRatioPref | null, durationSeconds: seconds, sound: input.sound } };
}

/**
 * What the composer opens on: the stored model when it is still offered
 * (a model can be retired or go dormant after someone picks it), otherwise
 * the global default; the stored length only when that model has it.
 */
export function resolveComposerDefaults(
  stored: GenerationDefaults,
  offered: readonly ModelLike[],
  globalDefaultModelId: string,
): { videoModelId: string; durationSeconds: number | null; aspectRatio: AspectRatioPref | null } {
  const modelOk = stored.videoModel !== null && offered.some((m) => m.id === stored.videoModel);
  const videoModelId = modelOk ? (stored.videoModel as string) : globalDefaultModelId;
  const model = offered.find((m) => m.id === videoModelId);
  const durationOk = stored.durationSeconds !== null && Boolean(model?.durations.some((d) => d.seconds === stored.durationSeconds));
  return { videoModelId, durationSeconds: durationOk ? stored.durationSeconds : null, aspectRatio: stored.aspectRatio };
}

/** Parse a profiles row (any shape, possibly missing columns) into defaults. */
export function defaultsFromRow(row: Record<string, unknown> | null | undefined): GenerationDefaults {
  if (!row) return NO_DEFAULTS;
  const aspect = row.default_aspect_ratio;
  const dur = row.default_video_duration;
  return {
    videoModel: typeof row.default_video_model === "string" && row.default_video_model ? row.default_video_model : null,
    aspectRatio: aspect === "16:9" || aspect === "9:16" ? aspect : null,
    durationSeconds: typeof dur === "number" && Number.isInteger(dur) ? dur : null,
    sound: row.video_sound !== false,
  };
}
