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

/** One character in a take, and the photo of theirs that was actually sent. */
export type CastPhoto = { characterId: string; photoPath: string };

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
  /**
   * THE PHOTO THAT WAS SENT (2026-09-22). The face used to be read against
   * the character's photo #1 whatever the take was given — while the Recast
   * door lets a person choose which photo goes (recast/actions.ts, the
   * `chosen` photo), so a take made from photo #3 was judged against photo #1
   * and the number said nothing about what was asked. A storage path under
   * character-references; the runner uses it only while it is still one of
   * that character's photos, and falls back to photo #1 otherwise.
   */
  photoPath?: string;
  /**
   * EVERY CHARACTER IN THE TAKE (2026-09-22), each with the photo sent for
   * them. A take with two characters used to be scored against the first
   * one alone, and the card showed that one number as if it covered both.
   * With a cast, each character is read at the start, the middle and the end
   * on their own.
   */
  cast?: CastPhoto[];
};

/** The most characters one take carries (recast/actions.ts slices the cast to four). */
export const MAX_CAST = 4;

function validCast(cast: unknown): CastPhoto[] {
  if (!Array.isArray(cast)) return [];
  const seen = new Set<string>();
  const out: CastPhoto[] = [];
  for (const entry of cast) {
    const c = entry as Partial<CastPhoto> | null;
    if (!c || typeof c.characterId !== "string" || typeof c.photoPath !== "string") continue;
    if (!c.characterId || !c.photoPath || seen.has(c.characterId)) continue;
    seen.add(c.characterId);
    out.push({ characterId: c.characterId, photoPath: c.photoPath });
    if (out.length === MAX_CAST) break;
  }
  return out;
}

/**
 * The lock a Recast take hands saveVideoJob (the contract with
 * recast/actions.ts, 2026-09-22): EVERY take with a character in it is read
 * whole, whatever the recast_lock switch says, against the photos that were
 * actually sent. The switch decides only the refund — and only where ONE
 * face is cast, because with several in the frame a miss cannot be pinned on
 * the take rather than on the reading. Undefined when nobody is cast.
 */
export function recastTakeLock(input: { cast: CastPhoto[]; threshold: number; lockOn: boolean }): IdentityLock | undefined {
  const cast = validCast(input.cast);
  if (cast.length === 0) return undefined;
  return {
    threshold: input.threshold,
    refund: input.lockOn && cast.length === 1 && input.threshold > 0,
    photoPath: cast[0].photoPath,
    cast,
  };
}

/**
 * A lock that reads and records and never refunds: what a character video
 * that reached the runner WITHOUT a lock is judged under (2026-09-22). Since
 * 2026-09-18 every lane that renders a character hands one over, except
 * where it chose not to — Recast with its lock switch off, and Recast with
 * several characters in one take — so those were read on one middle frame
 * while every composer video got three. The bar is 0, the gate's own "off":
 * nothing can miss, so nothing can be refunded on it.
 */
export function recordOnlyLock(): IdentityLock {
  return { threshold: 0, refund: false };
}

/** One character whose face is read, and the photo to read it against when one was recorded. */
export type ScoredMember = { characterId: string; photoPath: string | null };

/**
 * Whose face a finished video is read against.
 *
 *   - the lock's cast, when the lane recorded one: each character with the
 *     photo sent for them
 *   - otherwise, where the video is judged character by character
 *     (`wholeCast` — it came without a lock, so no lane chose one character
 *     for it), every character the row lists
 *   - otherwise the row's own character, exactly as before
 *
 * The row's own character is first, so it is the one the row's score and
 * its identityAttempts describe, as they always have.
 */
export function scoringCast(input: {
  lock: IdentityLock | null;
  characterProfileId: string | null;
  characterProfileIds: readonly string[] | null;
  wholeCast: boolean;
}): ScoredMember[] {
  const cast = validCast(input.lock?.cast);
  if (cast.length > 0) {
    const own = cast.findIndex((c) => c.characterId === input.characterProfileId);
    const ordered = own > 0 ? [cast[own], ...cast.filter((_, i) => i !== own)] : cast;
    return ordered.map((c) => ({ characterId: c.characterId, photoPath: c.photoPath }));
  }
  const listed = input.wholeCast ? (input.characterProfileIds ?? []).filter((id) => typeof id === "string" && id) : [];
  const ids = [...new Set([...(input.characterProfileId ? [input.characterProfileId] : []), ...listed])].slice(0, MAX_CAST);
  const sent = typeof input.lock?.photoPath === "string" && input.lock.photoPath ? input.lock.photoPath : null;
  return ids.map((id) => ({ characterId: id, photoPath: id === input.characterProfileId ? sent : null }));
}

/**
 * The photo to read a face against: the one that was sent, while it is
 * still one of the character's photos; otherwise photo #1, the one the
 * product calls the identity photo. Null when the character has none.
 */
export function identityPhotoFor(photos: readonly string[] | null | undefined, sent: string | null | undefined): string | null {
  const list = (photos ?? []).filter((p) => typeof p === "string" && p);
  if (list.length === 0) return null;
  return sent && list.includes(sent) ? sent : list[0];
}

/** What the scorer says about one frame (providers/openai.ts scoreIdentityMatch). */
export type FaceVerdict = { score: number; notes: string; unusable: boolean; faceVisible: boolean };

/**
 * Whether a reading judged a face at all. An unusable frame says nothing
 * about the face — a clip may open or close on black by design — and neither
 * does a frame with no face in it (scorer p2, 2026-09-18): the character
 * walking away from the camera is a shot, not a wrong person.
 */
export function judgesFace(v: FaceVerdict | null | undefined): v is FaceVerdict {
  return v !== null && v !== undefined && !v.unusable && v.faceVisible !== false;
}

/** One character's reading: [start, middle, end], null where a frame was not read. */
export type FaceRead = { characterId: string; name: string; verdicts: (FaceVerdict | null)[] };

/** A character's line in the take report. `scores` are in clip order; null where no face was judged. */
export type TakeReportFace = { characterId: string; name: string; lowest: number | null; scores: (number | null)[] };

/** The three moments of one character, and the lowest of those that judged a face. */
export function faceMoments(read: FaceRead): TakeReportFace {
  const verdicts = [0, 1, 2].map((i) => read.verdicts[i] ?? null);
  const scores = verdicts.map((v) => (judgesFace(v) ? v.score : null));
  const judged = scores.filter((s): s is number => s !== null);
  return { characterId: read.characterId, name: read.name, lowest: judged.length > 0 ? Math.min(...judged) : null, scores };
}

/** The note a row carries when no frame showed the face. */
export const NO_FACE_NOTE = "No frame showed the character's face, so it could not be judged.";

/**
 * What the row records from a finished video's readings, and whether a miss
 * is refunded — the runner's decision, pulled out so it can be tested
 * (job-runner.ts cannot be loaded by vitest).
 *
 * Written only when the row's own character's MIDDLE frame came back, as it
 * always was: that reading is the one an unlocked row records, and the one
 * every row's scorer provenance comes from.
 *
 * Under a lock the row records the WORST judged frame of the whole cast,
 * because "the face held all the way through" is a promise about the worst
 * frame, not the luckiest one; without one it records the middle frame
 * exactly as it always has. With no frame showing a face, nothing was
 * judged: no score, and nothing can miss.
 *
 * The refund needs the lock's refund AND exactly one character: with several
 * in the frame a low number may be the reading's confusion, not the take's.
 *
 * `worstScore` is the runner's own reduction — the least score any judged
 * frame of the cast gave, null when none did (castScores below, then
 * Math.min) — so the row's number and this decision are the same number.
 */
export function faceRecord(input: { lock: IdentityLock | null; reads: FaceRead[]; worstScore: number | null }): {
  write: boolean;
  matchScore: number | null;
  matchNotes: string | null;
  refund: boolean;
} {
  const middle = input.reads[0]?.verdicts[1] ?? null;
  if (!middle) return { write: false, matchScore: null, matchNotes: null, refund: false };

  if (!input.lock) {
    // `unusable` is deliberately NOT acted on here, unlike the image lane
    // which auto-fails and refunds a blank frame. On video it would be
    // reading one still and condemning a whole clip on it — a mid-clip cut
    // to black is a real thing a prompt can ask for. Recorded in the notes.
    const matchScore = middle.faceVisible === false ? null : middle.score;
    const matchNotes = middle.unusable
      ? `${middle.notes || "Scored from the middle frame."} (Frame read as blank or unusable.)`.slice(0, 500)
      : matchScore === null
        ? NO_FACE_NOTE
        : middle.notes || null;
    return { write: true, matchScore, matchNotes, refund: false };
  }

  const worst = input.worstScore;
  if (worst === null) return { write: true, matchScore: null, matchNotes: NO_FACE_NOTE, refund: false };
  const judged = input.reads.flatMap((r) => r.verdicts.filter(judgesFace));
  // The note of the frame that set the number, not the middle one's — a
  // clip whose end drifted should say what drifted at the end.
  const lowest = judged.find((v) => v.score === worst);
  const matchNotes = (
    input.reads.length > 1
      ? `Lowest of ${judged.length} readings with a face, across ${input.reads.length} characters. ${lowest?.notes || ""}`
      : `Lowest of ${judged.length} frames with a face. ${lowest?.notes || ""}`
  )
    .trim()
    .slice(0, 500);
  const refund = input.lock.refund && input.reads.length === 1 && worst < input.lock.threshold;
  return { write: true, matchScore: worst, matchNotes, refund };
}

/** Every score a judged frame gave, across the whole cast — what the row's worst is taken from. */
export function castScores(reads: FaceRead[]): number[] {
  return reads.flatMap((r) => r.verdicts.filter(judgesFace).map((v) => v.score));
}

// --- THE TAKE REPORT (2026-09-22) ------------------------------------------
//
// A Recast take's card used to show a bare "face 94" — the middle frame, of
// the first character, against photo #1. Every take is now read whole and
// each character on their own, and the result rides the take's pipeline_log
// as one step for the door to read:
//
//   { step: "take-report", detail, report: { faces: [{ characterId, name, lowest, scores }] } }
//
// `scores` are the start, the middle and the end, null where no face was
// judged; `lowest` is the least of them, null when none was — the card's
// "face not checked". `name` is "" when the reading did not finish.
//
// `detail` is there for every surface that already reads a step: History
// renders each step's detail through localizeServerText, which cannot take a
// step without one. It is a plain sentence, registered for translation.
//
// RECORD ONLY. Nothing is refunded or re-shot on this report; the lock (and
// its switch) is still the only thing that can give a credit back.

/** The step's name in pipeline_log. */
export const TAKE_REPORT_STEP = "take-report";

/** The step's sentence, as History shows it — mapped for translation in lib/i18n/server-text.ts. */
export const TAKE_REPORT_DETAIL = "Each face was checked at the start, the middle and the end of the take.";

export type TakeReportStep = {
  step: typeof TAKE_REPORT_STEP;
  detail: string;
  report: { faces: TakeReportFace[] };
};

/** The report step for a take's readings. */
export function takeReportStep(reads: FaceRead[]): TakeReportStep {
  return { step: TAKE_REPORT_STEP, detail: TAKE_REPORT_DETAIL, report: { faces: reads.map(faceMoments) } };
}

/**
 * Work that may not hold anything up: resolves to `fallback` when it fails
 * or runs past `ms`. The face reading runs after the take is already
 * delivered, but the caller that delivered it (fal's webhook, the door's
 * poll) still waits for it — so it gets a ceiling as well as its own
 * per-call timeouts.
 */
export function withinBudget<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([work.catch(() => fallback), late]).finally(() => clearTimeout(timer));
}

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
