// Which scorer produced an identity score.
//
// Its own alias-free module so it can be unit-tested — same reasoning as
// refund-rules.ts; providers/openai.ts pulls in the fetch wrapper and cannot
// be imported from a test.
//
// Added 2026-09-07. Until now a match_score was a bare number with no
// provenance. The model is read from an env var that can change under us, and
// the scoring prompt has been edited more than once — so two scores recorded a
// month apart were not necessarily comparable, and nothing in the row said so.
// That quietly ruins the one dataset in this product that compounds with use:
// every stored score becomes unattributable to the thing that produced it.
//
// The fix is cheap and only works going forward, which is the argument for
// doing it now rather than when the data matters.

/**
 * Bump whenever the scoring prompt changes in a way that could move a score.
 *
 * This is a JUDGEMENT, not a hash: reflowing a sentence does not change what
 * the model is being asked, but changing what counts against the score does.
 * When in doubt, bump — a false split is recoverable by merging two versions
 * during analysis, while a missed one silently pools incomparable numbers.
 */
//
// p2 (2026-09-18): the scorer also says whether ANY of the person's face is
// visible, and a frame without one no longer counts as a miss. Found on the
// first side-by-side of the opening frame: a clip in which the character
// walks away from the camera scored 18 on the frame showing the back of her
// head — not a wrong face, no face at all. Once every character clip is
// judged by its worst frame, that is a false miss on a shot that was fine.
export const IDENTITY_PROMPT_REVISION = 2;

/** Fallback when OPENAI_MODEL is unset — must match providers/openai.ts. */
export const DEFAULT_SCORER_MODEL = "gpt-5.4-mini";

/**
 * The stamp stored beside every score, e.g. "gpt-5.4-mini/p1".
 *
 * Model first because it is the coarser split, and the two are separated so a
 * reader can group by either half without parsing a date.
 */
export function identityScorerVersion(model?: string | null): string {
  const resolved = (model ?? "").trim() || DEFAULT_SCORER_MODEL;
  return `${resolved}/p${IDENTITY_PROMPT_REVISION}`;
}

// THE PRODUCT CHECKER'S STAMP (Press Tour, 2026-09-26: spec §1.8 "Add
// PRODUCT_PROMPT_REVISION to scorer-version.ts"). Every row of
// product_frame_checks carries it beside its numbers, for the same reason as
// the identity stamp above: a calibration set pooled across two prompts, or
// two readers, measures neither. The identity prompt is NOT reused for
// products (it tells the model clothing and setting must not lower a score).
//
// p1 (2026-09-26): locate (is a product in the role, where) and judge (is
// it the same product) on the judge model; the words read by the label
// reader; a second reading on the escalation model.
export const PRODUCT_PROMPT_REVISION = 1;

/** The stamp stored beside every product check, e.g. "gemini-3.1-flash-lite+claude-sonnet-5/p1". */
export function productScorerVersion(judgeModel: string, escalationModel: string): string {
  const judge = judgeModel.trim() || "unknown";
  const second = escalationModel.trim() || "unknown";
  return `${judge}+${second}/p${PRODUCT_PROMPT_REVISION}`;
}
