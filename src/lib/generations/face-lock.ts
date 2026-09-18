import type { SupabaseClient } from "@supabase/supabase-js";
import { MODEL_CAPABILITIES } from "./send-plan";
import { resolveIdentityThresholdSetting } from "./identity-gate";

// EVERY CHARACTER CLIP, JUDGED WHOLE (2026-09-18).
//
// Until today one frame spoke for a whole character video: the middle one,
// scored against the identity photo. Only Mystique's lock (recast/store.ts)
// read the start and the end too. The operator's own read of production the
// same day: 6 of 51 delivered character videos carried any face score at
// all, and 2 of those 6 were plainly the wrong person (18 and 17). A product
// that sells "the same face every time" cannot know it from one frame, and
// cannot promise it from none.
//
// So every character video now carries the lock job-runner already knows how
// to honour (JobRow.payload.identityLock): the face is read at the start, the
// middle and the end, and the LOWEST of those is what the row records —
// "the face held all the way through" is a promise about the worst frame,
// not the luckiest one.
//
// Alias-free, like identity-gate.ts and send-plan.ts, so it can be tested
// without booting Supabase or fal.

export type IdentityLock = {
  /** The identity gate's bar (Admin > Settings). 0 means the gate is off. */
  threshold: number;
  /**
   * Whether a miss is refunded. A business decision — see
   * VIDEO_FACE_REFUND_FLAG — so it rides the payload rather than being
   * assumed by the runner.
   */
  refund: boolean;
  /**
   * Don't read the opening frame. On a first-frame lane frame one IS a
   * picture whose face we already know: the character's own reference photo
   * (it would score ~100 against itself and prove nothing — frame-url.ts) or
   * the opening frame opening-frame.ts made and already checked. Reading it
   * again costs a frame grab and a scorer call to learn nothing.
   */
  skipFirst?: boolean;
};

/** The feature_flags row that turns a miss into a refund. Inserted OFF. */
export const VIDEO_FACE_REFUND_FLAG = "video_face_refund";

/** Whether this lane hands the model a picture AS frame one. */
export function isFirstFrameLane(modelId: string): boolean {
  const caps = (MODEL_CAPABILITIES as Record<string, (typeof MODEL_CAPABILITIES)[keyof typeof MODEL_CAPABILITIES] | undefined>)[
    modelId
  ];
  return caps?.identity.mechanism === "first-frame";
}

/**
 * The lock every character video carries, or undefined when there is no
 * character to hold (a characterless render has no face to judge).
 *
 * The refund only ever applies with the gate ON. A threshold of 0 is the
 * gate's kill switch (identity-gate.ts), under which nothing can miss — and
 * a refund switch that could fire with the gate off would be a promise with
 * no bar under it.
 */
export function characterVideoLock(input: {
  hasCharacter: boolean;
  modelId: string;
  threshold: number;
  refundOn: boolean;
}): IdentityLock | undefined {
  if (!input.hasCharacter) return undefined;
  return {
    threshold: input.threshold,
    refund: input.refundOn && input.threshold > 0,
    ...(isFirstFrameLane(input.modelId) ? { skipFirst: true } : {}),
  };
}

/**
 * The identity gate's bar, read the way the render lane reads it: an absent
 * row means the migration never ran, which resolves to OFF.
 */
export async function readIdentityThreshold(supabase: SupabaseClient): Promise<number> {
  try {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "identity_gate_threshold")
      .maybeSingle<{ value: string | null }>();
    return resolveIdentityThresholdSetting(data ? { value: data.value } : null);
  } catch {
    return resolveIdentityThresholdSetting(null);
  }
}

/** A feature_flags row, read fail-closed: any error or absence is OFF. */
export async function flagOn(supabase: SupabaseClient, key: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("feature_flags")
      .select("enabled")
      .eq("key", key)
      .maybeSingle<{ enabled: boolean }>();
    if (error || !data) return false;
    return data.enabled === true;
  } catch {
    return false;
  }
}
