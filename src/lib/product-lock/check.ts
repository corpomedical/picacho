// The product checker's run: a painted still (checkStill), a filmed shot's
// moments (checkMoments), and the card self-test (selfTestCard) — spec
// §1.6, §1.8; synthesis v2 #7, #15, #16, N2.
//
// Per frame, in this order:
//   T0  locate (judge.ts): is a product in the role, where. A low-confidence
//       box may be tightened by segmentation (the existing SAM 2 helper,
//       providers/fal-segment.ts) when the caller wires it; otherwise the
//       box stands. The product is cropped locally with sharp (crop.ts).
//   T1  the words read on the crop (the existing label reader,
//       press-tour/ocr.ts) against the confirmed strings AND every line read
//       on the product's own reference photos (text-match.ts).
//   T2  the vision judge on the crop (judge.ts).
//   then at most `escalationsLeft` second readings for the frames that need
//   one most (escalate.ts), and the verdict rules (product-lock.ts).
// The face comes from the existing identity scorer (providers/openai.ts
// scoreIdentityMatch, wired by live.ts) at the same moments, judged by
// face-lock.ts's rule: the lowest score among moments that show a face.
//
// RECORD-ONLY: the result is information. Nothing here repaints, re-shoots,
// refunds or blocks anything; every frame read is written to
// product_frame_checks for Admin's calibration (records.ts).
//
// NOT CHECKED, NEVER A MISS: a missing key, an unreachable reader, a
// provider out of balance, an unreadable picture, or the shot running past
// its budget (CHECK_BUDGET_MS, face-lock.ts's 75 s) all read "Not checked".
//
// Every provider is a dependency (live.ts wires the real ones), so this
// file is alias-free and tested with fakes (check.test.ts).

import type { Verdict } from "../press-tour/campaign-types";
import type { ProductDna, ProductView } from "../press-tour/types";
import { coverageOf, cropFrame, prepareFrame, type PreparedFrame } from "./crop";
import type { CardForReaders, ReaderAnswer } from "./judge";
import {
  MAX_ESCALATIONS_PER_AD,
  escalationPriority,
  faceVerdict,
  frameVerdict,
  shotVerdict,
  visibilityForCard,
  type Box,
  type CardText,
  type EscalationReading,
  type FaceReading,
  type FrameOutcome,
  type FrameSignals,
  type JudgeReading,
  type LocateReading,
  type ProductVisibility,
  type WordsSignal,
} from "./product-lock";
import { REASON_LABEL_UNREADABLE, REASON_NOT_CHECKED } from "./messages";
import type { FrameCheckDraft, RecordContext } from "./records";
import { momentTimes } from "./sampling";
import { readLabel, type LabelReadout } from "./text-match";

/** A shot's whole check stops waiting after this (face-lock.ts: 75 s per shot). */
export const CHECK_BUDGET_MS = 75_000;
/** Frames read at once. */
const CONCURRENCY = 3;
/** The references shown to the readers are made this big (long edge). */
const REFERENCE_EDGE = 1024;
/** The card's chosen photos read for words, at most (card-service.ts ANGLES_MAX, and its logo crop). */
const MAX_TEXT_PHOTOS = 6;
/** The second reading's pictures (escalate.ts ESCALATION_IMAGE_EDGE). */
const ESCALATION_EDGE = 768;
/** A word reading is booked at Vision's list price (ocr.ts: $1.50 per 1,000; the first 1,000 a month are free). */
export const WORDS_USD = 0.0015;
/** A face reading is booked at its ceiling (build map §3.3: ≤ $0.011). */
export const FACE_USD = 0.011;
/** A segmentation is booked at its worst case (sets/look-cutout.ts: 30 s × $0.0008). */
export const SEGMENT_USD = 0.024;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** The product card as the checker needs it. */
export type CheckCard = {
  productId: string | null;
  name: string | null;
  labelStrings: readonly string[];
  noReadableText: boolean;
  dna: ProductDna | null;
  palette: readonly string[];
  /** The reference photos (any format sharp reads), the front first. At most 3 are shown to the readers. */
  references: readonly Buffer[];
  /** Every line read on the product's own photos (v2 #7). Null: read them now, once (≤ 6 × $0.0015). */
  referenceText: readonly string[] | null;
  /**
   * The photos whose printed words make that corpus when it is read now:
   * EVERY photo the person chose for the card (v2 #7), not only the few
   * shown to the readers (PT-04: a side panel's words read on a still are
   * the product's own, not a conflict). A null entry is a photo that could
   * not be opened: then no words at all rather than half of them. Left out:
   * the references themselves.
   */
  textPhotos?: readonly (Buffer | null)[];
};

/** The character to read the face against; null = no one is meant to be in the shot (a packshot). */
export type FaceInput = { identity: Buffer; traitSummary: string; threshold: number } | null;

type Common = {
  visibility: ProductVisibility;
  card: CheckCard;
  /** Left out: the face is not read. Null: nobody is meant to be in it ("No one in this shot"). */
  face?: FaceInput;
  /** Second readings this ad may still spend (MAX_ESCALATIONS_PER_AD across the ad; the caller carries the count). */
  escalationsLeft?: number;
  /** 0 while record-only (product-lock.ts effectiveMinConfidence). */
  minConfidence?: number;
  record?: RecordContext;
  budgetMs?: number;
};

export type StillInput = Common & { image: Buffer };
export type MomentsInput = Common &
  ({ video: Buffer; seconds: number; packshot?: boolean } | { frames: readonly { at: number; image: Buffer }[] });

export type MomentSignals = {
  at: number | null;
  verdict: FrameOutcome["verdict"];
  reason: string | null;
  presence: LocateReading["present"] | null;
  coverage: number | null;
  box: Box | null;
  words: WordsSignal;
  ocrBest: number | null;
  conflict: string | null;
  judge: { verdict: JudgeReading["verdict"]; confidence: number; labelInView: boolean; blurred: boolean } | null;
  escalated: boolean;
  face: number | null;
};

export type CheckSignals = {
  /** Every moment read, in order: the door's "Checked at N moments" comes from this count. */
  moments: MomentSignals[];
  /** The moment the product verdict came from, or null. */
  worst: number | null;
  faceLowest: number | null;
  escalationsUsed: number;
  /** What the check cost us (estimated from usage; ceilings where none was reported). */
  usd: number;
  scorerVersion: string;
  timedOut: boolean;
  /** Every line read on the reference photos, when this check read them (keep it for the next check). */
  referenceText: string[] | null;
};

export type CheckResult = {
  face?: Verdict;
  product: Verdict;
  /** One plain sentence (messages.ts) when something didn't match or couldn't be read; else null. */
  reason: string | null;
  signals: CheckSignals;
  /** False for a shot the plan shows without the product: nothing about the product was checked. */
  productExpected: boolean;
};

/** The words read on one picture, or null when the reader is unavailable. */
export type WordsAnswer = { lines: string[] } | null;
export type FaceAnswer = FaceReading;

export interface CheckDeps {
  locate(input: { frame: Buffer; references: readonly Buffer[] }): Promise<ReaderAnswer<LocateReading>>;
  judge(input: { crop: Buffer; references: readonly Buffer[]; card: CardForReaders }): Promise<ReaderAnswer<JudgeReading>>;
  escalate(input: { references: readonly Buffer[]; card: CardForReaders; crop: Buffer | null; frame: Buffer }): Promise<ReaderAnswer<EscalationReading>>;
  readWords(image: Buffer): Promise<WordsAnswer>;
  /** SAM fallback for a low-confidence box: the tighter box, or null to keep the reader's. */
  segment?(frame: PreparedFrame, box: Box): Promise<Box | null>;
  /** The identity scorer on one frame; null when it did not answer. */
  scoreFace?(frame: Buffer, identity: Buffer, traitSummary: string): Promise<FaceAnswer>;
  sampleMoments?(video: Buffer, times: readonly number[]): Promise<(Buffer | null)[]>;
  record?(ctx: RecordContext, drafts: FrameCheckDraft[]): Promise<unknown>;
  scorerVersion: string;
}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function deadline<T>(work: Promise<T>, ms: number): Promise<T | "late"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

function forReaders(card: CheckCard): CardForReaders {
  return { name: card.name, expected: card.labelStrings, noReadableText: card.noReadableText, dna: card.dna, palette: card.palette };
}

function cardText(card: CheckCard): CardText {
  return { expected: card.noReadableText ? [] : card.labelStrings, noReadableText: card.noReadableText };
}

type Prepared = { references: Buffer[]; small: Buffer[]; referenceText: string[] | null; readNow: boolean; usd: number };

async function prepareCard(card: CheckCard, deps: CheckDeps): Promise<Prepared> {
  const prepared = (await Promise.all(card.references.slice(0, 5).map((b) => prepareFrame(b, REFERENCE_EDGE)))).filter(
    (p): p is PreparedFrame => p !== null,
  );
  const small = (await Promise.all(prepared.slice(0, 3).map((p) => prepareFrame(p.bytes, ESCALATION_EDGE)))).filter(
    (p): p is PreparedFrame => p !== null,
  );
  if (card.referenceText) return { references: prepared.map((p) => p.bytes), small: small.map((p) => p.bytes), referenceText: [...card.referenceText], readNow: false, usd: 0 };
  // v2 #7: T1 compares against ALL text read from the reference photos
  // (every photo the person chose, when the caller sends them).
  const textSource: (PreparedFrame | null)[] = card.textPhotos
    ? await Promise.all(card.textPhotos.slice(0, MAX_TEXT_PHOTOS).map((b) => (b ? prepareFrame(b, REFERENCE_EDGE) : Promise.resolve(null))))
    : prepared;
  const readable = textSource.filter((p): p is PreparedFrame => p !== null);
  const reads = await Promise.all(readable.map((p) => deps.readWords(p.bytes)));
  const usd = reads.length * WORDS_USD;
  // Without every reference photo's words, a conflict can't be told from
  // the back of the pack: no words at all rather than half of them.
  const whole = readable.length === textSource.length && reads.every((r) => r !== null);
  const referenceText = whole ? reads.flatMap((r) => r!.lines) : null;
  return { references: prepared.map((p) => p.bytes), small: small.map((p) => p.bytes), referenceText, readNow: true, usd };
}

type FrameWork = {
  at: number | null;
  prepared: PreparedFrame | null;
  crop: PreparedFrame | null;
  signals: FrameSignals;
  face: FaceAnswer | undefined;
  usd: number;
};

async function readFrame(
  image: Buffer | null,
  at: number | null,
  card: CheckCard,
  prep: Prepared,
  deps: CheckDeps,
  face: FaceInput | undefined,
): Promise<FrameWork> {
  const work: FrameWork = { at, prepared: null, crop: null, signals: { locate: null, coverage: null, label: undefined, judge: undefined }, face: undefined, usd: 0 };
  const prepared = image ? await prepareFrame(image) : null;
  work.prepared = prepared;
  if (!prepared) return work;

  const faceRead =
    face && deps.scoreFace
      ? deps.scoreFace(prepared.bytes, face.identity, face.traitSummary).then((r) => {
          work.usd += FACE_USD;
          return r;
        }, () => null)
      : Promise.resolve(undefined);

  const product = (async () => {
    if (prep.references.length === 0) return;
    const located = await deps.locate({ frame: prepared.bytes, references: prep.references });
    work.usd += located.usd;
    if (!located.ok) return;
    const locate = located.value;
    work.signals.locate = locate;
    const expected = cardText(card).expected;
    const words = (lines: string[]) => readLabel({ lines, expected, referenceText: prep.referenceText ?? [] });

    if (locate.present === "no") {
      // A confirmed word on the whole frame means the product is there after all.
      if (expected.length > 0 && prep.referenceText) {
        const whole = await deps.readWords(prepared.bytes);
        work.usd += WORDS_USD;
        work.signals.wholeFrameLabel = whole ? words(whole.lines) : null;
      }
      return;
    }
    if (locate.present !== "yes" || !locate.box) return;
    let box = locate.box;
    if (locate.boxConfidence === "low" && deps.segment) {
      const tighter = await deps.segment(prepared, box).catch(() => null);
      work.usd += SEGMENT_USD;
      if (tighter) box = tighter;
    }
    work.signals.locate = { ...locate, box };
    work.signals.coverage = coverageOf(box);
    const crop = await cropFrame(prepared, box);
    work.crop = crop;
    if (!crop) {
      work.signals.judge = null;
      return;
    }
    const [read, judged] = await Promise.all([
      prep.referenceText ? deps.readWords(crop.bytes) : Promise.resolve(null),
      deps.judge({ crop: crop.bytes, references: prep.references, card: forReaders(card) }),
    ]);
    if (prep.referenceText) work.usd += WORDS_USD;
    work.usd += judged.usd;
    work.signals.label = read ? words(read.lines) : null;
    work.signals.judge = judged.ok ? judged.value : null;
  })();

  const [faceAnswer] = await Promise.all([faceRead, product]);
  work.face = faceAnswer;
  return work;
}

function momentSignals(w: FrameWork, outcome: FrameOutcome): MomentSignals {
  const judge = w.signals.judge;
  const label: LabelReadout | null | undefined = w.signals.label;
  return {
    at: w.at,
    verdict: outcome.verdict,
    reason: outcome.reason,
    presence: w.signals.locate?.present ?? null,
    coverage: w.signals.coverage,
    box: w.signals.locate?.box ?? null,
    words: outcome.words,
    ocrBest: label?.best ?? null,
    conflict: label?.conflict ?? null,
    judge: judge ? { verdict: judge.verdict, confidence: judge.confidence, labelInView: judge.labelInView, blurred: judge.blurred } : null,
    escalated: w.signals.escalation !== undefined,
    face: w.face && !w.face.unusable && w.face.faceVisible ? w.face.score : null,
  };
}

function pickReason(product: { verdict: Verdict; reason: string | null; productExpected: boolean }, face: { verdict: Verdict; reason: string | null } | null): string | null {
  const productMiss = product.productExpected && (product.verdict === "didnt_match" || product.verdict === "product_missing");
  if (productMiss) return product.reason;
  if (face && face.verdict === "didnt_match") return face.reason;
  if (product.productExpected && product.verdict !== "match") return product.reason;
  if (face && (face.verdict === "not_readable" || face.verdict === "not_checked")) return face.reason;
  return null;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function runCheck(
  images: readonly { at: number | null; image: Buffer | null }[],
  input: Common,
  deps: CheckDeps,
  opts: { confirmAbsence: boolean },
): Promise<CheckResult> {
  const card = input.card;
  const text = cardText(card);
  const visibility = visibilityForCard(input.visibility, text);
  const productExpected = visibility !== "absent";
  const minConfidence = Math.max(0, Math.min(100, input.minConfidence ?? 0));
  let escalationsLeft = Math.max(0, Math.min(MAX_ESCALATIONS_PER_AD, Math.floor(input.escalationsLeft ?? MAX_ESCALATIONS_PER_AD)));
  const face = input.face;
  const wantFace = face !== undefined && face !== null;

  // Nothing to check at all: no product planned and no face asked.
  if (!productExpected && !wantFace) {
    const shot = shotVerdict([], "absent");
    return {
      ...(face === null ? { face: "no_one_in_shot" as Verdict } : {}),
      product: shot.verdict,
      reason: null,
      signals: { moments: [], worst: null, faceLowest: null, escalationsUsed: 0, usd: 0, scorerVersion: deps.scorerVersion, timedOut: false, referenceText: null },
      productExpected: false,
    };
  }

  const prep: Prepared = productExpected
    ? await prepareCard(card, deps)
    : { references: [], small: [], referenceText: null, readNow: false, usd: 0 };
  const frames = await mapLimit(images, CONCURRENCY, (f) => readFrame(f.image, f.at, card, prep, deps, wantFace ? face : undefined));

  // The second readings, most urgent first, within the ad's allowance.
  let escalationsUsed = 0;
  if (productExpected) {
    const wanted = frames
      .map((w, i) => ({ i, p: escalationPriority(w.signals, text, { confirmAbsence: opts.confirmAbsence, minConfidence }) }))
      .filter((x): x is { i: number; p: number } => x.p !== null)
      .sort((a, b) => a.p - b.p);
    for (const { i } of wanted) {
      if (escalationsLeft <= 0) break;
      const w = frames[i];
      if (!w.prepared) continue;
      const frameSmall = await prepareFrame(w.prepared.bytes, ESCALATION_EDGE);
      const cropSmall = w.crop ? await prepareFrame(w.crop.bytes, ESCALATION_EDGE) : null;
      if (!frameSmall) continue;
      escalationsLeft--;
      escalationsUsed++;
      const answer = await deps.escalate({ references: prep.small, card: forReaders(card), crop: cropSmall?.bytes ?? null, frame: frameSmall.bytes });
      w.usd += answer.usd;
      w.signals.escalation = answer.ok ? answer.value : null;
    }
  }

  const outcomes = frames.map((w) =>
    productExpected ? frameVerdict(w.signals, text, { minConfidence }) : { verdict: "not_checked" as const, reason: null, absenceConfirmed: false, labelRead: false, words: "unread" as const, resolved: null },
  );
  // A frame the readers never reached (an unreadable picture, no reference) is not checked.
  const shot = shotVerdict(outcomes, visibility);
  const faceOut = wantFace ? faceVerdict(frames.map((w) => (w.face === undefined ? null : w.face)), { threshold: face!.threshold }) : null;

  const usd = prep.usd + frames.reduce((s, w) => s + w.usd, 0);
  const signals: CheckSignals = {
    moments: frames.map((w, i) => momentSignals(w, outcomes[i])),
    worst: shot.worst,
    faceLowest: faceOut?.lowest ?? null,
    escalationsUsed,
    usd: Math.round(usd * 1e6) / 1e6,
    scorerVersion: deps.scorerVersion,
    timedOut: false,
    referenceText: prep.readNow ? prep.referenceText : null,
  };

  if (input.record && deps.record) {
    const keep = input.record.keepFrames === true;
    const drafts: FrameCheckDraft[] = frames.map((w, i) => ({
      moment: i,
      atSeconds: w.at,
      visibility,
      outcome: outcomes[i],
      shotVerdict: shot.verdict,
      locate: w.signals.locate,
      coverage: w.signals.coverage,
      label: w.signals.label,
      judge: w.signals.judge,
      escalation: w.signals.escalation,
      faceScore: signals.moments[i].face,
      usd: w.usd + (i === 0 ? prep.usd : 0),
      scorerVersion: deps.scorerVersion,
      frame: keep ? (w.prepared?.bytes ?? null) : null,
    }));
    try {
      await deps.record(input.record, drafts);
    } catch (err) {
      console.error(`[product-lock] frame checks not recorded: ${err instanceof Error ? err.name : "error"}`);
    }
  }

  const faceWord: Verdict | undefined = face === undefined ? undefined : face === null ? "no_one_in_shot" : faceOut!.verdict;
  return {
    ...(faceWord !== undefined ? { face: faceWord } : {}),
    product: shot.verdict,
    reason: pickReason(shot, faceOut),
    signals,
    productExpected,
  };
}

/** The answer when nothing could be read in time (or there was nothing to read): not checked, never a miss. */
function notChecked(input: Common, deps: CheckDeps, timedOut: boolean): CheckResult {
  const face = input.face;
  return {
    ...(face === undefined ? {} : { face: face === null ? ("no_one_in_shot" as Verdict) : ("not_checked" as Verdict) }),
    product: "not_checked",
    reason: REASON_NOT_CHECKED,
    signals: { moments: [], worst: null, faceLowest: null, escalationsUsed: 0, usd: 0, scorerVersion: deps.scorerVersion, timedOut, referenceText: null },
    productExpected: input.visibility !== "absent",
  };
}

/**
 * A painted still: one moment. A still with no product found where the plan
 * needs one may spend a second reading to confirm the absence (v2 #16).
 */
export async function checkStill(input: StillInput, deps: CheckDeps): Promise<CheckResult> {
  const run = runCheck([{ at: null, image: input.image }], input, deps, { confirmAbsence: true });
  const result = await deadline(run, input.budgetMs ?? CHECK_BUDGET_MS);
  return result === "late" ? notChecked(input, deps, true) : result;
}

/** A filmed shot: 3 moments (4 for a packshot), sampling.ts. */
export async function checkMoments(input: MomentsInput, deps: CheckDeps): Promise<CheckResult> {
  const work = (async () => {
    let images: { at: number | null; image: Buffer | null }[];
    if ("frames" in input) {
      images = input.frames.map((f) => ({ at: f.at, image: f.image }));
    } else {
      const times = momentTimes(input.seconds, { packshot: input.packshot });
      const taken = deps.sampleMoments ? await deps.sampleMoments(input.video, times) : times.map(() => null);
      images = times.map((at, i) => ({ at, image: taken[i] ?? null }));
    }
    if (images.length === 0) return notChecked(input, deps, false);
    return runCheck(images, input, deps, { confirmAbsence: false });
  })();
  const result = await deadline(work, input.budgetMs ?? CHECK_BUDGET_MS);
  return result === "late" ? notChecked(input, deps, true) : result;
}

// ---------------------------------------------------------------------------
// The card self-test (synthesis v2 #7): every reference photo the person
// chose must read Match before the card is confirmed.
// ---------------------------------------------------------------------------

export type SelfTestPhoto = { path: string; view: ProductView; image: Buffer };

export type SelfTestResult =
  | {
      ok: true;
      passed: boolean;
      /** Each chosen photo's verdict; `passed` is false when any failed. */
      photos: { path: string; verdict: Verdict; passed: boolean; reason: string | null }[];
      /** Every line read on the chosen photos: the checks after confirmation compare against it. */
      referenceText: string[] | null;
      usd: number;
    }
  | { ok: false; reason: "unavailable"; usd: number };

/**
 * Checks every chosen photo against the card, the front first among the
 * references. The FRONT must read Match with a confirmed word read on it —
 * which also proves the person's spelling. Any other angle passes on Match,
 * or when the readers agree it is the product but its words are not legible
 * from that angle (a side or a back cannot be held to the front's words).
 * Anything unreachable is "unavailable": the card is not confirmed and the
 * person is asked to try again (fail closed).
 */
export async function selfTestCard(
  input: { card: Omit<CheckCard, "references" | "referenceText">; photos: readonly SelfTestPhoto[]; record?: RecordContext; budgetMs?: number },
  deps: CheckDeps,
): Promise<SelfTestResult> {
  const photos = [...input.photos].sort((a, b) => (a.view === "front" ? -1 : b.view === "front" ? 1 : 0));
  if (photos.length === 0) return { ok: false, reason: "unavailable", usd: 0 };
  const work = (async (): Promise<SelfTestResult> => {
    const card: CheckCard = { ...input.card, references: photos.map((p) => p.image), referenceText: null };
    const prep = await prepareCard(card, deps);
    // Without the words on every photo, conflicts and the front's spelling can't be judged.
    if (prep.referenceText === null) return { ok: false, reason: "unavailable", usd: prep.usd };
    const withText: CheckCard = { ...card, referenceText: prep.referenceText };
    let escalationsLeft = MAX_ESCALATIONS_PER_AD;
    let usd = prep.usd;
    const results: { path: string; verdict: Verdict; passed: boolean; reason: string | null }[] = [];
    for (const photo of photos) {
      const front = photo.view === "front";
      const r = await runCheck([{ at: null, image: photo.image }], { visibility: front ? "required_label" : "required_shape", card: withText, escalationsLeft, record: input.record }, deps, {
        confirmAbsence: true,
      });
      escalationsLeft -= r.signals.escalationsUsed;
      usd += r.signals.usd;
      if (r.product === "not_checked") return { ok: false, reason: "unavailable", usd };
      const m = r.signals.moments[0];
      const lookMatch = !front && r.product === "not_readable" && r.reason === REASON_LABEL_UNREADABLE && m?.judge?.verdict === "match";
      const passed = r.product === "match" || lookMatch;
      results.push({ path: photo.path, verdict: r.product, passed, reason: passed ? null : r.reason });
    }
    return { ok: true, passed: results.every((p) => p.passed), photos: results, referenceText: prep.referenceText, usd: Math.round(usd * 1e6) / 1e6 };
  })();
  const result = await deadline(work, input.budgetMs ?? CHECK_BUDGET_MS * 2);
  return result === "late" ? { ok: false, reason: "unavailable", usd: 0 } : result;
}
