// Product checks: the verdict rules (spec §1.8 "Frame verdict rules" and
// "Shot and ad verdicts", as corrected by synthesis v2 #7, #15, #16 and N2).
// "Product Lock" is this module's internal name only; no customer copy says
// "locked" (spec §0; operator, 2026-09-26: say "Match" and "Checked at 3
// moments per shot").
//
// RECORD-ONLY. Every verdict here is computed, stored and shown as
// information. Nothing in this module re-shoots, refunds or blocks a spend:
// the operator decided on 2026-09-26 that there is no re-shoot before the
// checker is calibrated, and no refund for a miss. The one thing a verdict
// may drive before calibration is the campaign's single house-paid repaint
// of a STILL (synthesis v2 #15; press-tour/campaign-machine.ts decides it),
// which costs the person nothing and claims nothing.
// `product_lock_calibrated` stays off until the hand-labelled gate passes
// (calibration.ts).
//
// THE RULES, per frame (a still is one frame; a filmed 5 s shot is read at
// 3 moments, sampling.ts):
//
//   T0 locate — is there a product in the PRODUCT'S ROLE in this frame
//   (held, presented, the subject), whether or not it looks like ours
//   (v2 #16: "is there a product in the role" is asked separately from "is
//   it ours")? Where is it? A frame where it is unclear, too small (under
//   MIN_COVERAGE of the frame) or not boxed is EXCLUDED: never a miss.
//
//   T1 words (text-match.ts) — the confirmed strings read on the crop
//   (≥ 0.85), and any line the product does not carry (a conflict).
//
//   T2 meaning (judge.ts) — is it the SAME product: match, mismatch, or
//   not readable, with a confidence.
//
//   Escalation (escalate.ts) — a second reading by a different model, at
//   most MAX_ESCALATIONS_PER_AD per ad, for the frames where T1 and T2
//   disagree or T2 says mismatch with nothing to back it.
//
//   match        T2 (or the readings' majority) says match, AND there are
//                no confirmed strings, or one is read (≥ 0.85), or the
//                label is not in view.
//   didnt_match  NEEDS TWO INDEPENDENT SIGNALS: T2 mismatch plus a
//                conflicting line, or T2 mismatch plus an escalated
//                mismatch (spec), or — when the escalation was asked to
//                settle a T1/T2 disagreement — the conflicting line plus the
//                escalated mismatch. A single model reading never fails a
//                frame (the current scorer swings ~5.5 points between two
//                readings of one picture: expression-set.ts:152-157). The
//                words count as a signal only when they are UNMIXED: a
//                confirmed string read beside a stray line (AI stills often
//                garble secondary text) backs neither side, and a T2
//                mismatch against it goes to a second reading (PT-02).
//                BLUR IS NEVER A MISS: a blurred frame that would be a
//                mismatch is not_readable.
//   not_readable everything else: blur, small, occluded, an unresolved
//                disagreement, the label in view but no confirmed word read.
//   absent       T0 found no product in the role (and the whole frame's
//                words don't contradict it). Blur applies here too: a
//                blurred frame with nothing found is excluded, never a
//                missing product, and is not sent for a second reading
//                (PT-03).
//   not_checked  a reader was unreachable, out of time, or out of balance.
//
// Per shot: THE WORST MOMENT, in the order didnt_match > product_missing >
// not_checked > not_readable > match, over the moments that were judged
// (excluded and absent moments are not judged). A shot whose plan requires
// the product (required_label / required_shape) and in which NO moment
// showed it is `product_missing` — v2 #16 — when the absence is backed by
// two moments, or on a single still by a second reading; otherwise
// not_readable. A shot planned without the product (`absent`) is not
// checked at all. One addition to the spec: a `required_label` shot whose
// label was never actually read (every judged moment matched only because
// the label was out of view) is not_readable, not match — a shot planned to
// show the label cannot claim "Match" on a label nobody read.
//
// Per ad: the worst shot, counting only shots whose plan shows the product.
//
// Pure, alias-free: tested as it is.

import type { Verdict } from "../press-tour/campaign-types";
import {
  REASON_BLURRED,
  REASON_FACE_DIFFERENT,
  REASON_FACE_NOT_CHECKED,
  REASON_FACE_NOT_SEEN,
  REASON_LABEL_DIFFERENT,
  REASON_LABEL_UNREADABLE,
  REASON_NOT_CHECKED,
  REASON_NOT_IN_PLAN,
  REASON_NOT_YOUR_PRODUCT,
  REASON_PRODUCT_MISSING,
  REASON_TOO_SMALL,
  REASON_UNSURE,
} from "./messages";
import type { LabelReadout } from "./text-match";

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** A located product smaller than this share of the frame is excluded, never a miss (spec §1.8 T0). */
export const MIN_COVERAGE = 0.06;
/** A T2 mismatch below this confidence goes to a second reading first (spec §1.8 "Escalation"). */
export const LOW_CONFIDENCE = 70;
/** Second readings per ad, at most (spec §1.8). Once used up, an unresolved frame is not_readable. */
export const MAX_ESCALATIONS_PER_AD = 2;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** What the plan says a shot shows (spec §1.4: each shot records product_visibility). */
export const PRODUCT_VISIBILITIES = ["required_label", "required_shape", "absent"] as const;
export type ProductVisibility = (typeof PRODUCT_VISIBILITIES)[number];

export function parseProductVisibility(raw: unknown): ProductVisibility | null {
  return typeof raw === "string" && (PRODUCT_VISIBILITIES as readonly string[]).includes(raw) ? (raw as ProductVisibility) : null;
}

export type Presence = "yes" | "no" | "unclear";
export type BoxConfidence = "high" | "medium" | "low";
/** A box on a frame, each value 0..1 of the frame's width or height. */
export type Box = { x: number; y: number; w: number; h: number };

/** T0: what the locate reading said. */
export type LocateReading = {
  /** Is there a product in the product's role (held, presented, the subject)? Ours or not. */
  present: Presence;
  box: Box | null;
  boxConfidence: BoxConfidence;
  blurred: boolean;
};

/** One aspect of the product as a reader saw it. */
export type Aspect = "ok" | "off" | "unseen";
export type JudgeVerdict = "match" | "mismatch" | "not_readable";

/** T2 (and the escalated second reading): what a vision reader said about the crop. */
export type JudgeReading = {
  verdict: JudgeVerdict;
  shape: Aspect;
  label: Aspect;
  logo: Aspect;
  colour: Aspect;
  labelInView: boolean;
  blurred: boolean;
  /** 0..100. */
  confidence: number;
  /** One short English line for Admin; never shown to a customer. */
  note: string;
};

/** The second reading also answers whether the product is in its role at all (it sees the whole frame). */
export type EscalationReading = JudgeReading & { present: Presence };

/** Every signal one frame produced. `undefined` = that step did not run; `null` = it ran and got no answer. */
export type FrameSignals = {
  locate: LocateReading | null;
  /** The located box's share of the frame (after any segmentation), or null when nothing was boxed. */
  coverage: number | null;
  /** T1 on the crop. */
  label: LabelReadout | null | undefined;
  /** T1 on the whole frame, read when T0 found nothing: a confirmed word there means T0 missed it. */
  wholeFrameLabel?: LabelReadout | null;
  /** T2 on the crop. */
  judge: JudgeReading | null | undefined;
  /** The second reading, when one was asked for. */
  escalation?: EscalationReading | null;
};

/** The card's words, as the rules need them. */
export type CardText = {
  /** The person's confirmed label strings. */
  expected: readonly string[];
  noReadableText: boolean;
};

export type FrameVerdict = "match" | "didnt_match" | "not_readable" | "absent" | "excluded" | "not_checked";
export const FRAME_VERDICTS: readonly FrameVerdict[] = ["match", "didnt_match", "not_readable", "absent", "excluded", "not_checked"];

/** T1's position: the words read agree (match), disagree (conflict), both, or say nothing. */
export type WordsSignal = "match" | "conflict" | "mixed" | "silent" | "unread";

export type FrameOutcome = {
  verdict: FrameVerdict;
  /** The customer sentence (messages.ts), or null for a match. */
  reason: string | null;
  /** T0 found nothing and a second reading agreed: lets a single still be product_missing. */
  absenceConfirmed: boolean;
  /** A confirmed string was read on this frame (≥ 0.85). */
  labelRead: boolean;
  words: WordsSignal;
  /** What the readings settled on, before the two-signal and blur rules. */
  resolved: JudgeVerdict | "unresolved" | null;
};

// ---------------------------------------------------------------------------
// One frame
// ---------------------------------------------------------------------------

function outcome(verdict: FrameVerdict, reason: string | null, extra: Partial<FrameOutcome> = {}): FrameOutcome {
  return { verdict, reason, absenceConfirmed: false, labelRead: false, words: "unread", resolved: null, ...extra };
}

function wordsSignal(label: LabelReadout | null | undefined): WordsSignal {
  if (!label) return "unread";
  const conflict = label.conflict !== null;
  if (label.matched && conflict) return "mixed";
  if (label.matched) return "match";
  if (conflict) return "conflict";
  return "silent";
}

/** The words' vote in a disagreement: only an unmixed reading votes. */
function wordsVote(words: WordsSignal): JudgeVerdict | null {
  return words === "match" ? "match" : words === "conflict" ? "mismatch" : null;
}

/**
 * A reader's verdict as the rules use it. Once calibrated, a mismatch below
 * the Admin's minimum confidence counts as not readable
 * (product_lock_min_confidence; 0 = ignored, as it is while record-only).
 */
function effective(reading: JudgeReading, minConfidence: number): JudgeVerdict {
  if (reading.verdict === "mismatch" && minConfidence > 0 && reading.confidence < minConfidence) return "not_readable";
  return reading.verdict;
}

/** The readings' settled verdict: T2 alone, or the majority of T2, the words and the second reading. */
function resolve(
  t2: JudgeVerdict,
  words: WordsSignal,
  escalation: EscalationReading | null | undefined,
  minConfidence: number,
): JudgeVerdict | "unresolved" {
  const vote = wordsVote(words);
  if (escalation === undefined) return t2;
  if (escalation === null) {
    // Asked and unanswered: a disagreement it was meant to settle stays open.
    return vote !== null && vote !== t2 ? "unresolved" : t2;
  }
  const e = effective(escalation, minConfidence);
  const votes = [t2, e, vote].filter((v): v is JudgeVerdict => v !== null);
  const mismatches = votes.filter((v) => v === "mismatch").length;
  const matches = votes.filter((v) => v === "match").length;
  if (mismatches >= 2) return "mismatch";
  if (matches >= 2) return "match";
  return e === t2 ? t2 : "unresolved";
}

/** The rules for one frame. Pure; `minConfidence` is 0 while record-only. */
export function frameVerdict(signals: FrameSignals, card: CardText, opts: { minConfidence?: number } = {}): FrameOutcome {
  const minConfidence = Math.max(0, Math.min(100, opts.minConfidence ?? 0));
  const { locate } = signals;
  if (!locate) return outcome("not_checked", REASON_NOT_CHECKED);

  if (locate.present === "no") {
    // A confirmed word read on the whole frame says the product IS there
    // and the locate reading missed it: not a missing product.
    if (signals.wholeFrameLabel?.matched) return outcome("not_readable", REASON_UNSURE, { labelRead: true });
    const second = signals.escalation;
    if (second && second.present !== "no") return outcome("not_readable", REASON_UNSURE);
    // Blur is never a miss, and a missing product is one (PT-03): a blurred
    // frame where nothing was found is excluded, not absent.
    if (locate.blurred || second?.blurred) return outcome("excluded", REASON_BLURRED);
    return outcome("absent", REASON_PRODUCT_MISSING, { absenceConfirmed: !!second && second.present === "no" });
  }
  if (locate.present === "unclear") return outcome("excluded", REASON_UNSURE);
  if (!locate.box || signals.coverage === null) return outcome("excluded", REASON_TOO_SMALL);
  if (signals.coverage < MIN_COVERAGE) return outcome("excluded", REASON_TOO_SMALL);

  const judge = signals.judge;
  if (!judge) return outcome("not_checked", REASON_NOT_CHECKED);
  const needsWords = card.expected.length > 0;
  // The words are needed whenever the card has confirmed strings; a card
  // with no readable text still reads them, for conflicts, but can do without.
  if (needsWords && !signals.label) return outcome("not_checked", REASON_NOT_CHECKED);

  const words = wordsSignal(signals.label);
  const labelRead = !!signals.label?.matched;
  // Only unmixed words are a signal for a miss (PT-02): a confirmed string
  // read beside a stray line votes for neither side (wordsVote).
  const conflict = words === "conflict";
  const escalation = signals.escalation;
  const blurred = judge.blurred || locate.blurred || !!escalation?.blurred;
  const t2 = effective(judge, minConfidence);
  const resolved = resolve(t2, words, escalation, minConfidence);
  const base = { labelRead, words, resolved };

  if (resolved === "mismatch") {
    const e = escalation ? effective(escalation, minConfidence) : null;
    const signalsForMiss = [t2 === "mismatch", conflict, e === "mismatch"].filter(Boolean).length;
    if (signalsForMiss >= 2) {
      if (blurred) return outcome("not_readable", REASON_BLURRED, base);
      return outcome("didnt_match", conflict ? REASON_LABEL_DIFFERENT : REASON_NOT_YOUR_PRODUCT, base);
    }
    return outcome("not_readable", blurred ? REASON_BLURRED : REASON_UNSURE, base);
  }
  if (resolved === "match") {
    const labelInView = judge.labelInView || !!escalation?.labelInView;
    if (!needsWords || labelRead || !labelInView) return outcome("match", null, base);
    return outcome("not_readable", blurred ? REASON_BLURRED : REASON_LABEL_UNREADABLE, base);
  }
  return outcome("not_readable", blurred ? REASON_BLURRED : REASON_UNSURE, base);
}

// ---------------------------------------------------------------------------
// Which frames get the second reading
// ---------------------------------------------------------------------------

/**
 * Whether a frame should get a second reading, and how urgently (lower
 * first), or null. The caller spends at most MAX_ESCALATIONS_PER_AD per ad,
 * most urgent first:
 *   1  T2 says mismatch while the confirmed words were read on it (alone,
 *      or beside a stray line);
 *   2  T2 says match while a line the product doesn't carry was read and
 *      no confirmed word was;
 *   3  T2 says mismatch with nothing to back it (the least confident
 *      first) — without this a shape-only drift, or any product with no
 *      readable text, could never be a miss;
 *   4  (a single still, when asked) T0 found no product in a shot that
 *      must show it: the second reading confirms or refutes the absence.
 * A blurred frame is never escalated: blur can't become a miss, so the
 * reading would buy nothing.
 */
export function escalationPriority(
  signals: FrameSignals,
  card: CardText,
  opts: { confirmAbsence?: boolean; minConfidence?: number } = {},
): number | null {
  const minConfidence = Math.max(0, Math.min(100, opts.minConfidence ?? 0));
  const { locate, judge } = signals;
  if (!locate) return null;
  if (locate.present === "no") {
    // A blurred absence can't become a miss (PT-03): the reading would buy nothing.
    if (!opts.confirmAbsence || signals.wholeFrameLabel?.matched || locate.blurred) return null;
    return 4;
  }
  if (locate.present !== "yes" || !locate.box || signals.coverage === null || signals.coverage < MIN_COVERAGE) return null;
  if (!judge) return null;
  if (card.expected.length > 0 && !signals.label) return null;
  if (judge.blurred || locate.blurred) return null;
  const t2 = effective(judge, minConfidence);
  const words = wordsSignal(signals.label);
  // A confirmed word read beside a stray line is a disagreement with a T2
  // mismatch like a clean read is (PT-02): the second reading settles it.
  if (t2 === "mismatch" && (words === "match" || words === "mixed")) return 1;
  if (t2 === "match" && words === "conflict") return 2;
  if (t2 === "mismatch" && words !== "conflict") return 3 + Math.max(0, Math.min(100, judge.confidence)) / 1000;
  return null;
}

// ---------------------------------------------------------------------------
// One shot, one ad
// ---------------------------------------------------------------------------

/** Worst first: the order a shot and an ad take their verdict in. */
export const VERDICT_SEVERITY: Record<Verdict, number> = {
  didnt_match: 5,
  product_missing: 4,
  not_checked: 3,
  not_readable: 2,
  match: 1,
  no_one_in_shot: 0,
};

export function worseVerdict(a: Verdict, b: Verdict): Verdict {
  return VERDICT_SEVERITY[b] > VERDICT_SEVERITY[a] ? b : a;
}

export type ShotOutcome = {
  verdict: Verdict;
  reason: string | null;
  /** The moment the verdict came from (0-based), or null when none did. */
  worst: number | null;
  /** Moments that were judged (not excluded, absent or unchecked). */
  judged: number;
  /** False for a shot the plan shows without the product: nothing was checked. */
  productExpected: boolean;
};

/** The worst moment rule for one shot (or one still: one moment). */
export function shotVerdict(frames: readonly FrameOutcome[], visibility: ProductVisibility): ShotOutcome {
  if (visibility === "absent") return { verdict: "not_checked", reason: REASON_NOT_IN_PLAN, worst: null, judged: 0, productExpected: false };
  const judgedIdx = frames.map((f, i) => (f.verdict === "match" || f.verdict === "didnt_match" || f.verdict === "not_readable" ? i : -1)).filter((i) => i >= 0);
  const result = (verdict: Verdict, worst: number | null, reason: string | null): ShotOutcome => ({
    verdict,
    reason,
    worst,
    judged: judgedIdx.length,
    productExpected: true,
  });
  if (frames.length === 0) return result("not_checked", null, REASON_NOT_CHECKED);

  const miss = frames.findIndex((f) => f.verdict === "didnt_match");
  if (miss >= 0) return result("didnt_match", miss, frames[miss].reason);

  const absent = frames.map((f, i) => (f.verdict === "absent" ? i : -1)).filter((i) => i >= 0);
  const unchecked = frames.findIndex((f) => f.verdict === "not_checked");
  if (judgedIdx.length === 0 && unchecked < 0 && absent.length > 0) {
    // v2 #16: nothing judged, and the product is not in its role. Backed by
    // two moments, or by a second reading on a single still.
    const backed = absent.length >= 2 || absent.some((i) => frames[i].absenceConfirmed);
    return backed ? result("product_missing", absent[0], REASON_PRODUCT_MISSING) : result("not_readable", absent[0], REASON_UNSURE);
  }
  if (unchecked >= 0) return result("not_checked", unchecked, REASON_NOT_CHECKED);

  const unreadable = judgedIdx.find((i) => frames[i].verdict === "not_readable");
  if (unreadable !== undefined) return result("not_readable", unreadable, frames[unreadable].reason);
  if (judgedIdx.length === 0) {
    // spec §1.8: a required shot with no judged moment is not readable.
    const first = frames.findIndex((f) => f.verdict === "excluded");
    return result("not_readable", first >= 0 ? first : null, first >= 0 ? frames[first].reason : REASON_TOO_SMALL);
  }
  // The label a shot was planned to show must have been read somewhere in it.
  if (visibility === "required_label" && !judgedIdx.some((i) => frames[i].labelRead)) {
    return result("not_readable", judgedIdx[0], REASON_LABEL_UNREADABLE);
  }
  return result("match", null, null);
}

/**
 * A shot's rules need the words only when the card has any: a required_label
 * shot of a product with no readable text is judged like required_shape.
 */
export function visibilityForCard(visibility: ProductVisibility, card: CardText): ProductVisibility {
  return visibility === "required_label" && (card.noReadableText || card.expected.length === 0) ? "required_shape" : visibility;
}

/** The ad's verdict: the worst shot whose plan shows the product (spec §1.8). Null when none does. */
export function adVerdict(shots: readonly { verdict: Verdict; productExpected: boolean }[]): Verdict | null {
  let out: Verdict | null = null;
  for (const s of shots) {
    if (!s.productExpected) continue;
    out = out === null ? s.verdict : worseVerdict(out, s.verdict);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The face, from the existing identity scorer (providers/openai.ts
// scoreIdentityMatch), by face-lock.ts's rule: the lowest score among the
// moments that showed a face; a moment without one is not a miss.
// ---------------------------------------------------------------------------

export type FaceReading = { score: number; unusable: boolean; faceVisible: boolean } | null;

export type FaceOutcome = { verdict: Verdict; reason: string | null; lowest: number | null; judged: number };

/**
 * `threshold` is the identity gate's bar (identity_gate_threshold, read by
 * the caller). 0 is the gate's own "off": with no bar there is nothing to
 * pass or miss, so the face reads "Not checked".
 */
export function faceVerdict(readings: readonly FaceReading[], opts: { threshold: number }): FaceOutcome {
  const judged = readings.filter((r): r is NonNullable<FaceReading> => r !== null && !r.unusable && r.faceVisible !== false);
  if (judged.length === 0) {
    const noneAnswered = readings.every((r) => r === null);
    return noneAnswered
      ? { verdict: "not_checked", reason: REASON_FACE_NOT_CHECKED, lowest: null, judged: 0 }
      : { verdict: "not_readable", reason: REASON_FACE_NOT_SEEN, lowest: null, judged: 0 };
  }
  const lowest = Math.min(...judged.map((r) => r.score));
  if (!(opts.threshold > 0)) return { verdict: "not_checked", reason: REASON_FACE_NOT_CHECKED, lowest, judged: judged.length };
  return lowest >= opts.threshold
    ? { verdict: "match", reason: null, lowest, judged: judged.length }
    : { verdict: "didnt_match", reason: REASON_FACE_DIFFERENT, lowest, judged: judged.length };
}

/**
 * The minimum confidence the rules apply: the Admin's setting once the
 * checker is calibrated, 0 (ignored) while it is record-only.
 */
export function effectiveMinConfidence(calibrated: boolean, setting: unknown): number {
  if (!calibrated) return 0;
  const n = typeof setting === "number" ? setting : typeof setting === "string" ? Number(setting.trim()) : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}
