// What Admin's Product checks page shows, computed from the rows (pure, so
// the page is only layout). spec §1.8 "A new Admin score-distribution view
// with hand labels (correct / wrong / not readable) is used for
// calibration"; build map §3.2 item 11 ("so the bar is not tuned blind").
//
// Pure, alias-free.

import { calibrationReport, countBy, histogram, type CalibrationReport } from "./calibration";
import { FRAME_VERDICTS, type Box, type FrameVerdict } from "./product-lock";
import { parseFrameLabel, type FrameLabel } from "./records";

/** The rows the page reads (a subset of product_frame_checks). */
export type AdminFrameRow = {
  id: string;
  created_at: string;
  user_id: string;
  product_id: string | null;
  source: string;
  shot: number | null;
  moment: number | null;
  at_seconds: number | null;
  visibility: string | null;
  frame_verdict: string;
  shot_verdict: string;
  reason: string | null;
  presence: string | null;
  coverage: number | null;
  judge_verdict: string | null;
  judge_confidence: number | null;
  escalated: boolean | null;
  escalation_verdict: string | null;
  ocr_best: number | null;
  ocr_conflict: string | null;
  face_score: number | null;
  lane: string | null;
  frame_path: string | null;
  scorer_version: string | null;
  cost_usd: number | string | null;
  signals: unknown;
  label: string | null;
  labelled_at: string | null;
};

/** The columns the distributions need (the queue reads every column). */
export const DISTRIBUTION_COLUMNS =
  "id, created_at, user_id, product_id, source, frame_verdict, shot_verdict, judge_verdict, judge_confidence, escalated, ocr_best, lane, frame_path, scorer_version, cost_usd, label";

/** Rows the distributions are drawn from, newest first, at most. */
export const DISTRIBUTION_ROWS = 5000;
/** Frames on one page of the labelling queue. */
export const QUEUE_PAGE = 24;

export const CONFIDENCE_BUCKETS = 10;
export const OCR_BUCKETS = 10;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

export type Distributions = {
  total: number;
  /** Frames that keep a picture (an admin's own, bake-off, seeded): the only ones that may be labelled (v2 #32). */
  labelable: number;
  /** Customer frames: numbers only until the privacy page discloses human review. */
  customerFrames: number;
  /** Frames that kept their picture and carry no label yet: the queue's length. */
  toLabel: number;
  byVerdict: { verdict: FrameVerdict; count: number }[];
  /** Judge confidence (0–100) in 10 bins, per frame verdict that has a judge reading. */
  confidence: { verdict: FrameVerdict; bins: number[] }[];
  /** Best confirmed-word similarity (0–1) in 10 bins. */
  ocr: number[];
  bySource: { value: string; count: number }[];
  byLane: { value: string; count: number }[];
  byScorer: { value: string; count: number }[];
  escalated: number;
  costUsd: number;
  report: CalibrationReport;
};

export function distributions(rows: readonly Pick<AdminFrameRow, "source" | "frame_verdict" | "judge_confidence" | "escalated" | "ocr_best" | "lane" | "frame_path" | "scorer_version" | "cost_usd" | "label" | "product_id">[]): Distributions {
  const byVerdict = FRAME_VERDICTS.map((verdict) => ({ verdict, count: rows.filter((r) => r.frame_verdict === verdict).length }));
  const confidence = FRAME_VERDICTS.filter((v) => v === "match" || v === "didnt_match" || v === "not_readable").map((verdict) => ({
    verdict,
    bins: histogram(
      rows.filter((r) => r.frame_verdict === verdict).map((r) => num(r.judge_confidence)),
      { min: 0, max: 100, buckets: CONFIDENCE_BUCKETS },
    ),
  }));
  const labelable = rows.filter((r) => r.frame_path).length;
  return {
    total: rows.length,
    labelable,
    customerFrames: rows.length - labelable,
    toLabel: rows.filter((r) => r.frame_path && !parseFrameLabel(r.label)).length,
    byVerdict,
    confidence,
    ocr: histogram(rows.map((r) => num(r.ocr_best)), { min: 0, max: 1, buckets: OCR_BUCKETS }),
    bySource: countBy(rows, (r) => r.source),
    byLane: countBy(rows, (r) => r.lane),
    byScorer: countBy(rows, (r) => r.scorer_version),
    escalated: rows.filter((r) => r.escalated === true).length,
    costUsd: Math.round(rows.reduce((s, r) => s + (num(r.cost_usd) ?? 0), 0) * 1e4) / 1e4,
    report: calibrationReport(
      rows.map((r) => ({ frameVerdict: r.frame_verdict, label: parseFrameLabel(r.label), productId: r.product_id, lane: r.lane, source: r.source })),
    ),
  };
}

/** What one queue card shows beside the frame. */
export type QueueCard = {
  id: string;
  createdAt: string;
  frameVerdict: string;
  shotVerdict: string;
  reason: string | null;
  source: string;
  lane: string | null;
  where: string;
  judge: string | null;
  second: string | null;
  words: string | null;
  read: string[];
  box: Box | null;
  label: FrameLabel | null;
  scorer: string | null;
};

function boxFrom(v: unknown): Box | null {
  if (!v || typeof v !== "object") return null;
  const b = v as Record<string, unknown>;
  const [x, y, w, h] = [b.x, b.y, b.w, b.h].map(num);
  if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

export function queueCard(r: AdminFrameRow): QueueCard {
  const sig = (r.signals && typeof r.signals === "object" ? r.signals : {}) as Record<string, unknown>;
  const read = Array.isArray(sig.read) ? (sig.read.filter((x) => typeof x === "string") as string[]).slice(0, 8) : [];
  const where = [
    r.shot ? `shot ${r.shot}` : null,
    r.at_seconds !== null && r.at_seconds !== undefined ? `${Number(r.at_seconds).toFixed(1)} s` : r.moment !== null ? `moment ${r.moment + 1}` : null,
    r.visibility,
  ]
    .filter(Boolean)
    .join(" · ");
  const ocrBest = num(r.ocr_best);
  return {
    id: r.id,
    createdAt: r.created_at,
    frameVerdict: r.frame_verdict,
    shotVerdict: r.shot_verdict,
    reason: r.reason,
    source: r.source,
    lane: r.lane,
    where: where || "still",
    judge: r.judge_verdict ? `${r.judge_verdict} · ${r.judge_confidence ?? "?"}` : null,
    second: r.escalated ? (r.escalation_verdict ?? "no answer") : null,
    words: ocrBest !== null || r.ocr_conflict ? [ocrBest !== null ? `best ${ocrBest.toFixed(2)}` : null, r.ocr_conflict ? `foreign “${r.ocr_conflict}”` : null].filter(Boolean).join(" · ") : null,
    read,
    box: boxFrom(sig.box),
    label: parseFrameLabel(r.label),
    scorer: r.scorer_version,
  };
}

/** The queue's filters. */
export const QUEUE_FILTERS = ["todo", "labelled", "misses"] as const;
export type QueueFilter = (typeof QUEUE_FILTERS)[number];
export function parseQueueFilter(raw: unknown): QueueFilter {
  return typeof raw === "string" && (QUEUE_FILTERS as readonly string[]).includes(raw) ? (raw as QueueFilter) : "todo";
}

/** Percent with one decimal, or a dash. */
export function pct(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(1)}%`;
}
