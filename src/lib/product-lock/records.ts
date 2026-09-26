// Every frame the product checker reads leaves one row in
// public.product_frame_checks (synthesis v2 #30: per-frame scores live in an
// ADMIN-ONLY table; generations keeps only the verdict word). The rows are
// what Admin's score distributions and the hand-labelling tool read
// (spec §1.8 "Record-only until calibrated"; calibration.ts).
//
// THE TABLE is created by supabase/pending/press-tour-03-campaigns.sql (the
// campaign engine's file). This module codes to the shape below; the SQL
// must hold exactly these columns (FRAME_CHECK_COLUMNS, pinned by
// records.test.ts), with RLS on and NO policies (service role only), and
// CHECKs matching the lists here:
//
//   id                  uuid primary key default gen_random_uuid()
//   created_at          timestamptz not null default now()
//   user_id             uuid not null  (the frame's owner; on delete cascade)
//   product_id          uuid null      (on delete set null)
//   campaign_id         uuid null      (plain uuid: press_campaigns)
//   generation_id       uuid null      (the still's or the shot's row)
//   source              text not null  check in FRAME_CHECK_SOURCES
//   shot                smallint null  (1-based)
//   moment              smallint null  (0-based, within the shot)
//   at_seconds          numeric(6,2) null
//   visibility          text null      check in PRODUCT_VISIBILITIES
//   frame_verdict       text not null  check in FRAME_VERDICTS
//   shot_verdict        text not null  check in the campaign Verdict words
//   reason              text null      (a messages.ts sentence, ≤ 200)
//   presence            text null      check in ('yes','no','unclear')
//   coverage            real null      (0..1)
//   judge_verdict       text null      check in ('match','mismatch','not_readable')
//   judge_confidence    smallint null  (0..100)
//   escalated           boolean not null default false
//   escalation_verdict  text null      check in ('match','mismatch','not_readable')
//   ocr_best            real null      (0..1)
//   ocr_conflict        text null      (≤ 80)
//   face_score          smallint null  (0..100)
//   lane                text null      (≤ 64; the render lane, Admin only)
//   frame_path          text null      (press-kit: <user>/checks/…; ≤ 512)
//   scorer_version      text not null  (≤ 120)
//   cost_usd            numeric(10,6) not null default 0
//   signals             jsonb not null default '{}'  (octet_length ≤ 8192)
//   label               text null      check in FRAME_LABELS
//   labelled_by         uuid null
//   labelled_at         timestamptz null
//   index on (created_at desc), index on (product_id), index on (label)
//
// FRAMES ARE KEPT ONLY WHERE THEY MAY BE LABELLED (synthesis v2 #32):
// customer frames are labelled only after the privacy page discloses human
// review, so until then only an admin's own frames and bake-off frames keep
// their picture (keepFrames); every other row keeps its numbers only.
//
// Relative imports only; the row builder is pure and tested.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Verdict } from "../press-tour/campaign-types";
import type { FrameOutcome, JudgeReading, EscalationReading, LocateReading, ProductVisibility } from "./product-lock";
import type { LabelReadout } from "./text-match";

export const FRAME_CHECK_TABLE = "product_frame_checks";
export const FRAME_CHECK_BUCKET = "press-kit";

/** Where a frame came from. 'seeded': a local, $0 mismatch made from a real frame (calibration gate). */
export const FRAME_CHECK_SOURCES = ["still", "moment", "self_test", "bakeoff", "seeded"] as const;
export type FrameCheckSource = (typeof FRAME_CHECK_SOURCES)[number];

/** The hand labels (spec §1.8): was the checker's frame verdict right? */
export const FRAME_LABELS = ["correct", "wrong", "not_readable"] as const;
export type FrameLabel = (typeof FRAME_LABELS)[number];

export function parseFrameLabel(raw: unknown): FrameLabel | null {
  return typeof raw === "string" && (FRAME_LABELS as readonly string[]).includes(raw) ? (raw as FrameLabel) : null;
}

/** Every column the checker writes (the label columns are Admin's). */
export const FRAME_CHECK_COLUMNS = [
  "user_id",
  "product_id",
  "campaign_id",
  "generation_id",
  "source",
  "shot",
  "moment",
  "at_seconds",
  "visibility",
  "frame_verdict",
  "shot_verdict",
  "reason",
  "presence",
  "coverage",
  "judge_verdict",
  "judge_confidence",
  "escalated",
  "escalation_verdict",
  "ocr_best",
  "ocr_conflict",
  "face_score",
  "lane",
  "frame_path",
  "scorer_version",
  "cost_usd",
  "signals",
] as const;

/** What Admin reads back. */
export const FRAME_CHECK_READ_COLUMNS = `id, created_at, ${FRAME_CHECK_COLUMNS.join(", ")}, label, labelled_by, labelled_at`;

/** signals jsonb is kept under this many bytes (the SQL CHECK's bound). */
export const SIGNALS_MAX_BYTES = 8192;

export type RecordContext = {
  userId: string;
  productId?: string | null;
  campaignId?: string | null;
  generationId?: string | null;
  shot?: number | null;
  source: FrameCheckSource;
  /** The render lane, for Admin's per-lane view. Never shown to a customer. */
  lane?: string | null;
  /** Keep the frame's picture for labelling (an admin's own frames, bake-off frames). */
  keepFrames?: boolean;
};

/** One read frame, before it becomes a row. */
export type FrameCheckDraft = {
  moment: number;
  atSeconds: number | null;
  visibility: ProductVisibility;
  outcome: FrameOutcome;
  shotVerdict: Verdict;
  locate: LocateReading | null;
  coverage: number | null;
  label: LabelReadout | null | undefined;
  judge: JudgeReading | null | undefined;
  escalation: EscalationReading | null | undefined;
  faceScore: number | null;
  usd: number;
  scorerVersion: string;
  /** The prepared frame (JPEG), present only when it may be kept. */
  frame: Buffer | null;
};

export type FrameCheckRow = Record<(typeof FRAME_CHECK_COLUMNS)[number], unknown>;

const bounded = (s: string | null | undefined, max: number): string | null => (s ? Array.from(s).slice(0, max).join("") : null);
const round = (n: number | null | undefined, places: number): number | null =>
  typeof n === "number" && Number.isFinite(n) ? Math.round(n * 10 ** places) / 10 ** places : null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: string | null | undefined): string | null => (v && UUID.test(v) ? v.toLowerCase() : null);

/** Bounded signals: what Admin needs to understand a row, never more than SIGNALS_MAX_BYTES. */
export function frameSignals(d: FrameCheckDraft): Record<string, unknown> {
  const sig: Record<string, unknown> = {
    words: d.outcome.words,
    resolved: d.outcome.resolved,
    labelRead: d.outcome.labelRead,
    box: d.locate?.box ?? null,
    boxConfidence: d.locate?.boxConfidence ?? null,
    blurred: d.locate?.blurred ?? null,
    judge: d.judge
      ? { shape: d.judge.shape, label: d.judge.label, logo: d.judge.logo, colour: d.judge.colour, labelInView: d.judge.labelInView, blurred: d.judge.blurred, note: d.judge.note }
      : null,
    escalation: d.escalation
      ? { present: d.escalation.present, confidence: d.escalation.confidence, labelInView: d.escalation.labelInView, blurred: d.escalation.blurred, note: d.escalation.note }
      : null,
    bestString: d.label?.bestString ?? null,
    read: (d.label?.lines ?? []).slice(0, 24),
  };
  // Trim the words read until it fits; everything else is small and fixed.
  // Postgres measures jsonb's own text, which adds a space after every colon
  // and comma, so the budget keeps a kilobyte of room for those.
  while (new TextEncoder().encode(JSON.stringify(sig)).length > SIGNALS_MAX_BYTES - 1024 && (sig.read as string[]).length > 0) {
    sig.read = (sig.read as string[]).slice(0, -1);
  }
  return sig;
}

/** Pure: one draft as the row the checker writes. */
export function frameCheckRow(ctx: RecordContext, d: FrameCheckDraft, framePath: string | null): FrameCheckRow {
  return {
    user_id: ctx.userId,
    product_id: uuidOrNull(ctx.productId),
    campaign_id: uuidOrNull(ctx.campaignId),
    generation_id: uuidOrNull(ctx.generationId),
    source: ctx.source,
    shot: typeof ctx.shot === "number" && Number.isInteger(ctx.shot) && ctx.shot > 0 ? ctx.shot : null,
    moment: d.moment,
    at_seconds: round(d.atSeconds, 2),
    visibility: d.visibility,
    frame_verdict: d.outcome.verdict,
    shot_verdict: d.shotVerdict,
    reason: bounded(d.outcome.reason, 200),
    presence: d.locate?.present ?? null,
    coverage: round(d.coverage, 4),
    judge_verdict: d.judge?.verdict ?? null,
    judge_confidence: d.judge ? Math.round(d.judge.confidence) : null,
    escalated: d.escalation !== undefined,
    escalation_verdict: d.escalation?.verdict ?? null,
    ocr_best: round(d.label?.best ?? null, 3),
    ocr_conflict: bounded(d.label?.conflict ?? null, 80),
    face_score: typeof d.faceScore === "number" ? Math.max(0, Math.min(100, Math.round(d.faceScore))) : null,
    lane: bounded(ctx.lane ?? null, 64),
    frame_path: framePath,
    scorer_version: bounded(d.scorerVersion, 120) ?? "unknown",
    cost_usd: round(d.usd, 6) ?? 0,
    signals: frameSignals(d),
  };
}

/** Where a kept frame goes: the owner's own folder of the private press-kit bucket. */
export function framePathFor(userId: string, id: string, now: Date): string {
  return `${userId}/checks/${now.toISOString().slice(0, 10)}/${id}.jpg`;
}

/**
 * Writes the rows (service role), keeping the pictures that may be kept.
 * Never throws: the check's verdict stands whether or not its record lands,
 * and a failure is logged by kind.
 */
export async function writeFrameChecks(
  db: SupabaseClient,
  ctx: RecordContext,
  drafts: readonly FrameCheckDraft[],
  opts: { newId?: () => string; now?: () => Date } = {},
): Promise<number> {
  if (!UUID.test(ctx.userId) || drafts.length === 0) return 0;
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const now = opts.now?.() ?? new Date();
  const rows: FrameCheckRow[] = [];
  for (const d of drafts) {
    let path: string | null = null;
    if (ctx.keepFrames && d.frame) {
      const candidate = framePathFor(ctx.userId.toLowerCase(), newId(), now);
      try {
        const { error } = await db.storage.from(FRAME_CHECK_BUCKET).upload(candidate, d.frame, { contentType: "image/jpeg", upsert: false });
        if (!error) path = candidate;
      } catch {
        path = null;
      }
    }
    rows.push(frameCheckRow(ctx, d, path));
  }
  try {
    const { error } = await db.from(FRAME_CHECK_TABLE).insert(rows);
    if (error) {
      console.error(`[product-lock] frame checks not recorded: ${error.message.slice(0, 200)}`);
      const kept = rows.map((r) => r.frame_path).filter((p): p is string => typeof p === "string");
      if (kept.length) await db.storage.from(FRAME_CHECK_BUCKET).remove(kept).catch(() => {});
      return 0;
    }
    return rows.length;
  } catch (err) {
    console.error(`[product-lock] frame checks not recorded: ${err instanceof Error ? err.name : "error"}`);
    return 0;
  }
}
