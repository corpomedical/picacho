// Press Tour's campaign engine: the stage machine, what a campaign row
// holds, and what the door is shown (spec §1.12 as corrected by v2:
// synthesis §3.1 items 1, 11, 15, 19, 22, 30; operator 2026-09-26).
//
// CUT 2 RUNS THE MACHINE UP TO awaiting_approval, record-only, no video:
//
//   draft ──plan──▶ planned ──"Paint stills"──▶ painting ──▶ checking_keyframes ──▶ awaiting_approval
//                     │                            ▲   │            │                     │
//                     │                            └───┼────────────┘ (one house repaint) │
//                     │                                └── repaint · 1 credit ◀───────────┘
//                     └──▶ cancelled / expired / failed (terminal)
//
//   draft               the planner is running (inline, in the "Plan" press).
//   planned             a plan and its quote: nothing charged. Expires in 7 days.
//   painting            one reserved still is painted per step (paint.ts).
//   checking_keyframes  every still is painted and checked; a still whose
//                       FIRST painting the checker found wrong (the product
//                       didn't match or is missing, the face didn't match
//                       with the identity gate on, or the 9:16 crop could
//                       not keep both) is repainted ONCE on the house, 0
//                       credits, and the better of the two is kept
//                       (v2 #15: before any video spend, shown as "We
//                       repainted this once, free"). "Not readable" and
//                       "Not checked" never repaint. A repaint the content
//                       or ad rules refuse (the house's, or the person's
//                       below) ends nothing: the still keeps the painting
//                       it had and says why. Only a still with no painting
//                       at all ends the ad.
//   awaiting_approval   the person approves or keeps each still, or
//                       repaints one at 1 credit (N4). Nothing re-shoots and
//                       nothing is refunded for a miss (operator,
//                       2026-09-26). Closes after 7 days (nothing to refund:
//                       filming was never charged). Filming (animating ...
//                       ready) is a later cut.
//
// ONE STEP PER CLAIM. The cron (app/api/cron/press) and every kick after a
// press claim a campaign through claim_press_campaigns (FOR UPDATE SKIP
// LOCKED, a 6-minute lease: press-tour-03-campaigns.sql), do ONE step, and
// release it. Every write is optimistic: the row's version is bumped by the
// database on every update, and a writer updates "where version = what it
// read", re-reading and re-applying its pure transform on a conflict. So a
// person approving shot 1 while the machine paints shot 3 loses nothing.
//
// MONEY moves here through three doors only: a HOUSE row (0 credits, never
// the daily free slot, never the refund authority: #22) reserved for the
// checker's repaint, or for the retry of a still whose charge STAYED after
// a provider failure; a PAID retry (v2 #11) for a still whose charge WENT
// BACK, reserved against the same person's allowance in the same billing
// window under an id made from the failed row (paint.ts reservePaidRetry),
// so a failure never delivers a still for nothing and never charges twice;
// and the refund authority for a reserved still that will never be painted
// (forced: nothing was delivered). Every other paid reservation is the
// person's own press (campaign-service.ts).
//
// CUT 4 CARRIES IT ON PAST awaiting_approval (film -> check -> cut -> tag ->
// sign -> deliver), admins only, behind press_tour_film (inserted OFF):
//
//   awaiting_approval ──"Film"──▶ animating ──▶ checking_shots ──▶ assembling ──▶ signing ──▶ ready
//          ▲    │                     ▲              │                 │   ▲
//          │    └──"Re-film shot N"───┘              │                 │   └─ Keep / Cut / "Make the cut"
//          └──────────── a shot waits on the person ─┘◀── parked after 3 failed cut steps
//
//   animating       every take reserved in the Film press is submitted to
//                   the film lane (film.ts), then collected, gated and kept.
//   checking_shots  one filmed take read per step (3 moments, record-only).
//   awaiting_approval (filmed) the press wall: a shot whose take didn't
//                   match, has no usable take, or was filmed again waits on
//                   the person (keep a take, re-film at its price, cut it
//                   free). A miss starts nothing on its own.
//   assembling      one cut step per claim (cut.ts): a segment, the end card,
//                   then the join into the clean and tagged renditions.
//   signing         C2PA on each rendition (sign.ts: unsigned, and why, until
//                   the certificate and a library are there), then delivery:
//                   the finished ad's History row, adReady.
// The steps of those stages are the injected MachineDeps.stages (film.ts,
// cut.ts), so this file never imports them. The 24 h rule (v2 #39) runs on
// the cron's minute (cut.ts lateCuts).
//
// Alias-free (vitest has no "@/"): campaign-machine.test.ts imports it as it is.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CAMPAIGN_STAGES,
  type CampaignSource,
  type CampaignStage,
  type CampaignView,
  type MasterView,
  type PressQuote,
  type ShotRole,
  type StillDecision,
  type StillView,
  type Verdict,
} from "./campaign-types";
import {
  BLOCK_CHECKING,
  BLOCK_FILMING_NOT_OPEN,
  BLOCK_PAINTING,
  BLOCK_PLANNING,
  CAMPAIGN_EXPIRED,
  CAMPAIGN_MESSAGES,
  PAINT_FAILED,
  PAINT_FAILED_CHARGED,
  PLAN_STALLED,
  STILL_REFUSED,
  STILL_REFUSED_CHARGED,
  STILL_REPAINT_REFUSED,
  blockDecide,
} from "./campaign-messages";
import { parseAdPlan, type AdPlan, type PlannedShot } from "./planner";
import { parsePressQuote, shotCredits } from "./quote";
import {
  BLOCK_CUTTING,
  BLOCK_FILMING,
  BLOCK_FINISHING,
  BLOCK_READING_SHOTS,
  CUT_STALLED,
  FILM_EXPIRED,
  blockDecideShot,
} from "./film-messages";
import { parseAssembly, parseRenditions, RENDITION_KINDS, type RenditionKind } from "./cut-state";
import {
  closeOpenTakes,
  filmed,
  firstDecision,
  openTakes,
  parseShots,
  shotViews,
  withTakesRefunded,
  type ShotContext,
  type ShotState,
  type Take,
} from "./shots";
import type { FilmDeps } from "./film";
import type { CutDeps } from "./cut";

// ---------------------------------------------------------------------------
// Who, and the clock
// ---------------------------------------------------------------------------

/**
 * Who may start or spend on a campaign in THIS cut: admins only (the
 * operator's rule, admins first). The plans and the trial reach Press Tour's
 * door once their switches are on (enabled.ts), but they cannot plan or
 * paint an ad until a later cut adds them here.
 */
export const CAMPAIGNS_OPEN_TO: readonly ("admin" | "plan" | "trial")[] = ["admin"];

/** The lease, as press-tour-03-campaigns.sql holds it (claim_press_campaigns). */
export const LEASE_MS = 6 * 60_000;
/** A campaign in one working stage longer than this tells Admin (spec §1.12). */
export const OVERDUE_MS = 45 * 60_000;
/** A campaign waiting on the person closes after this (spec §1.6). */
export const WAIT_MS = 7 * 24 * 60 * 60_000;
/** A draft this old lost its planning request. */
export const DRAFT_STALE_MS = 10 * 60_000;
/** Bounds on one still's history (the stills column is bounded too). */
export const MAX_ATTEMPTS_PER_STILL = 8;
export const MAX_REPAINTS_PER_STILL = 5;

// ---------------------------------------------------------------------------
// The stages
// ---------------------------------------------------------------------------

export const TERMINAL_STAGES: readonly CampaignStage[] = ["failed", "cancelled", "expired"];
/** Stages the machine works (claim_press_campaigns claims exactly these). */
export const WORKING_STAGES: readonly CampaignStage[] = [
  "painting",
  "checking_keyframes",
  "animating",
  "checking_shots",
  "assembling",
  "signing",
];
/** Stages waiting on the person, which close at expires_at. */
export const WAITING_STAGES: readonly CampaignStage[] = ["planned", "awaiting_approval"];

/** Every move the machine or a person's press may make (spec §1.12). Anything else is refused. */
export const CAMPAIGN_TRANSITIONS: Record<CampaignStage, readonly CampaignStage[]> = {
  draft: ["planned", "failed", "cancelled"],
  planned: ["painting", "cancelled", "expired", "failed"],
  painting: ["checking_keyframes", "failed", "cancelled"],
  checking_keyframes: ["painting", "awaiting_approval", "failed", "cancelled"],
  awaiting_approval: ["painting", "animating", "assembling", "cancelled", "expired", "failed"],
  animating: ["checking_shots", "failed", "cancelled"],
  checking_shots: ["animating", "assembling", "awaiting_approval", "failed", "cancelled"],
  assembling: ["signing", "awaiting_approval", "failed", "cancelled"],
  signing: ["ready", "awaiting_approval", "failed", "cancelled"],
  ready: [],
  failed: [],
  cancelled: [],
  expired: [],
};

export function isStage(raw: unknown): raw is CampaignStage {
  return typeof raw === "string" && (CAMPAIGN_STAGES as readonly string[]).includes(raw);
}

export function canMove(from: CampaignStage, to: CampaignStage): boolean {
  return from === to || CAMPAIGN_TRANSITIONS[from].includes(to);
}

export function isTerminal(stage: CampaignStage): boolean {
  return TERMINAL_STAGES.includes(stage);
}

// ---------------------------------------------------------------------------
// Ids made from a press (the repeat-send pattern)
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseUuid(raw: unknown): string | null {
  return typeof raw === "string" && UUID_RE.test(raw) ? raw.toLowerCase() : null;
}

/** An id made by a rule of our own (SHA-256, stamped as a version-8 UUID, RFC 9562). Same seed, same id. */
export function derivedUuid(seed: string): string {
  const bytes = createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The campaign's own id, from the "Plan" press: a second delivery meets the first one's row. */
export function pressCampaignId(sendId: string): string {
  return derivedUuid(`press-campaign:${sendId.toLowerCase()}`);
}

/**
 * The first painting of each still, from the "Paint stills" press's own
 * send id (the Recast pattern): a resent press meets its own rows at the
 * reservation and charges nothing. A different press (a second tab) makes
 * other rows, and the one that loses the move to "painting" gives its rows
 * back (campaign-service.ts paintStills); a press whose delivery died after
 * reserving never blocks the next one.
 */
export function stillRowId(paintSendId: string, shot: number): string {
  return derivedUuid(`press-still:${paintSendId.toLowerCase()}:${shot}`);
}

/** A person's repaint, from that press's own send id: a resent press meets its own row. */
export function repaintRowId(repaintSendId: string): string {
  return derivedUuid(`press-repaint:${repaintSendId.toLowerCase()}`);
}

/** A house row (the checker's repaint, or a provider-failure retry): made by the machine, 0 credits. */
export function houseRowId(campaignId: string, shot: number, kind: "house" | "retry", n: number): string {
  return derivedUuid(`press-${kind}:${campaignId.toLowerCase()}:${shot}:${n}`);
}

/** A paid retry (v2 #11), made from the failed row it replaces: a step that died after reserving meets its own row. */
export function paidRetryRowId(failedRowId: string): string {
  return derivedUuid(`press-paid-retry:${failedRowId.toLowerCase()}`);
}

// ---------------------------------------------------------------------------
// The stills: every attempt at each still, and what the person decided
// ---------------------------------------------------------------------------

/** paint: the first painting (paid). repaint: the person's (1 credit). house: the checker's (0). retry: after a provider failure (its price, or 0: v2 #11). */
export const ATTEMPT_KINDS = ["paint", "repaint", "house", "retry"] as const;
export type AttemptKind = (typeof ATTEMPT_KINDS)[number];
export type AttemptStatus = "reserved" | "painted" | "failed";

export const VERDICTS: readonly Verdict[] = ["match", "didnt_match", "not_readable", "product_missing", "not_checked", "no_one_in_shot"];

export type StillAttempt = {
  n: number;
  rowId: string;
  kind: AttemptKind;
  status: AttemptStatus;
  /** Credits this attempt's row was charged (0 for house rows and a house retry). */
  credits: number;
  /** The painted still in generated-images, under the owner's folder. */
  path: string | null;
  face: Verdict;
  product: Verdict;
  reason: string | null;
  /** Whether the 9:16 crop kept the face and the product (null: nobody located them). */
  fits: boolean | null;
  /** The face scorer's number, to keep the better of two attempts. Never shown. */
  faceScore: number | null;
  /** Second product readings this attempt's check spent (at most 2 across the ad). */
  escalations: number;
  /** The person's note for a repaint. */
  note: string | null;
  at: string;
  doneAt: string | null;
  /** Why an attempt failed (English, never shown raw). */
  error: string | null;
};

export type StillState = {
  shot: number;
  attempts: StillAttempt[];
  /** The attempt shown (n), or null before one is painted. */
  keep: number | null;
  decision: StillDecision;
};

const DECISIONS: readonly StillDecision[] = ["pending", "approved", "kept"];

function verdictOf(raw: unknown): Verdict {
  return typeof raw === "string" && (VERDICTS as readonly string[]).includes(raw) ? (raw as Verdict) : "not_checked";
}

function strOrNull(raw: unknown, max = 500): string | null {
  return typeof raw === "string" && raw.length > 0 ? raw.slice(0, max) : null;
}

function attemptFrom(raw: unknown): StillAttempt | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const n = typeof r.n === "number" && Number.isInteger(r.n) && r.n >= 1 ? r.n : null;
  const rowId = parseUuid(r.rowId);
  const kind = typeof r.kind === "string" && (ATTEMPT_KINDS as readonly string[]).includes(r.kind) ? (r.kind as AttemptKind) : null;
  const status = r.status === "reserved" || r.status === "painted" || r.status === "failed" ? r.status : null;
  if (!n || !rowId || !kind || !status) return null;
  return {
    n,
    rowId,
    kind,
    status,
    credits: typeof r.credits === "number" && Number.isInteger(r.credits) && r.credits >= 0 ? r.credits : 0,
    path: strOrNull(r.path, 512),
    face: verdictOf(r.face),
    product: verdictOf(r.product),
    reason: strOrNull(r.reason, 300),
    fits: typeof r.fits === "boolean" ? r.fits : null,
    faceScore: typeof r.faceScore === "number" && Number.isFinite(r.faceScore) ? r.faceScore : null,
    escalations: typeof r.escalations === "number" && Number.isInteger(r.escalations) && r.escalations >= 0 ? r.escalations : 0,
    note: strOrNull(r.note, 200),
    at: typeof r.at === "string" ? r.at.slice(0, 40) : "",
    doneAt: strOrNull(r.doneAt, 40),
    error: strOrNull(r.error, 300),
  };
}

/** The stills as stored, one per shot of the plan, in shot order. Defensive: a malformed entry is an empty still. */
export function parseStills(raw: unknown, shotCount: number): StillState[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: StillState[] = [];
  for (let shot = 1; shot <= shotCount; shot++) {
    const found = list.find((s) => s && typeof s === "object" && (s as { shot?: unknown }).shot === shot) as
      | Record<string, unknown>
      | undefined;
    const attempts = (Array.isArray(found?.attempts) ? found.attempts : [])
      .map(attemptFrom)
      .filter((a): a is StillAttempt => a !== null)
      .slice(0, MAX_ATTEMPTS_PER_STILL);
    const keep = typeof found?.keep === "number" && attempts.some((a) => a.n === found.keep && a.status === "painted") ? found.keep : null;
    const decision =
      typeof found?.decision === "string" && (DECISIONS as readonly string[]).includes(found.decision)
        ? (found.decision as StillDecision)
        : "pending";
    out.push({ shot, attempts, keep, decision: keep === null ? "pending" : decision });
  }
  return out;
}

export function initialStills(plan: AdPlan): StillState[] {
  return plan.shots.map((s) => ({ shot: s.shot, attempts: [], keep: null, decision: "pending" as const }));
}

export function stillOf(stills: readonly StillState[], shot: number): StillState | null {
  return stills.find((s) => s.shot === shot) ?? null;
}

export function inFlight(still: StillState): boolean {
  return still.attempts.some((a) => a.status === "reserved");
}

export function keptAttempt(still: StillState): StillAttempt | null {
  return still.keep === null ? null : (still.attempts.find((a) => a.n === still.keep && a.status === "painted") ?? null);
}

export function repaintsOf(still: StillState): number {
  return still.attempts.filter((a) => a.kind === "repaint").length;
}

export function houseRepainted(still: StillState): boolean {
  return still.attempts.some((a) => a.kind === "house" && a.status === "painted");
}

/** The first reserved attempt, in shot order: the next still to paint. */
export function nextReserved(stills: readonly StillState[]): { shot: number; attempt: StillAttempt } | null {
  for (const s of stills) {
    const a = s.attempts.find((x) => x.status === "reserved");
    if (a) return { shot: s.shot, attempt: a };
  }
  return null;
}

/** Second product readings the ad's checks have spent so far. */
export function escalationsUsed(stills: readonly StillState[]): number {
  return stills.reduce((sum, s) => sum + s.attempts.reduce((n, a) => n + a.escalations, 0), 0);
}

/** Every reserved attempt (rows charged or held, not yet painted). */
export function reservedAttempts(stills: readonly StillState[]): { shot: number; attempt: StillAttempt }[] {
  return stills.flatMap((s) => s.attempts.filter((a) => a.status === "reserved").map((attempt) => ({ shot: s.shot, attempt })));
}

/** A reserved attempt added to one still (a paint, a repaint, the house's or a retry). Null when the still cannot take one. */
export function withReserved(
  stills: readonly StillState[],
  shot: number,
  a: { rowId: string; kind: AttemptKind; credits: number; note?: string | null },
  nowIso: string,
): StillState[] | null {
  const still = stillOf(stills, shot);
  if (!still || inFlight(still) || still.attempts.length >= MAX_ATTEMPTS_PER_STILL) return null;
  if (still.attempts.some((x) => x.rowId === a.rowId)) return null;
  const attempt: StillAttempt = {
    n: still.attempts.length + 1,
    rowId: a.rowId,
    kind: a.kind,
    status: "reserved",
    credits: a.credits,
    path: null,
    face: "not_checked",
    product: "not_checked",
    reason: null,
    fits: null,
    faceScore: null,
    escalations: 0,
    note: a.note ?? null,
    at: nowIso,
    doneAt: null,
    error: null,
  };
  return stills.map((s) => (s.shot === shot ? { ...s, attempts: [...s.attempts, attempt] } : s));
}

/** What painting one still came to (paint.ts paintKeyframe). */
export type PaintOutcome =
  /** Nothing to do: the campaign closed, or this attempt was already written by another step. */
  | { kind: "skipped" }
  /** A read failed before anything was spent: the same attempt is tried again on a later step. */
  | { kind: "later" }
  | {
      kind: "painted";
      path: string;
      face: Verdict;
      product: Verdict;
      reason: string | null;
      fits: boolean | null;
      faceScore: number | null;
      escalations: number;
      usd: number;
    }
  | {
      kind: "failed";
      /**
       * provider: the picture lane (or a gate, a read, the crop or the store
       * around it) failed: retried once, at its price when its charge went
       * back, on the house when it stayed (v2 #11).
       * gone: the reserved row is no longer there to paint (treated like provider).
       * refused: a content gate refused the still. Terminal for the
       *   campaign only when the still has no painting to keep; a refused
       *   repaint (the house's or the person's) leaves the still as it was.
       * gate: a consent the still needs is missing (the same rule).
       */
      cause: "provider" | "gone" | "refused" | "gate";
      error: string;
      usd: number;
      /** Whether the attempt's credits went back (the refund authority said yes). */
      refunded: boolean;
    };

const PRODUCT_RANK: Record<Verdict, number> = {
  match: 3,
  no_one_in_shot: 3,
  not_readable: 2,
  not_checked: 2,
  product_missing: 0,
  didnt_match: 0,
};

/** The better of two painted attempts: the worse check first, then the product, the face, the face score, the crop. Ties keep the newer. */
export function betterAttempt(a: StillAttempt, b: StillAttempt): StillAttempt {
  const key = (x: StillAttempt): number[] => [
    Math.min(PRODUCT_RANK[x.product], PRODUCT_RANK[x.face]),
    PRODUCT_RANK[x.product],
    PRODUCT_RANK[x.face],
    x.faceScore ?? -1,
    x.fits === false ? 0 : 1,
  ];
  const ka = key(a);
  const kb = key(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return ka[i] > kb[i] ? a : b;
  }
  return a.n > b.n ? a : b;
}

/** A painting the checker found wrong: the product, the crop, or the face (only while the identity gate is on). */
export function missed(a: StillAttempt, faceGateOn: boolean): boolean {
  if (a.status !== "painted") return false;
  if (a.product === "didnt_match" || a.product === "product_missing") return true;
  if (a.fits === false) return true;
  return faceGateOn && a.face === "didnt_match";
}

/**
 * The words a still shows when this attempt was refused or gated, or null.
 * The attempt's `error` is never shown raw (a lane's own words can ride in
 * it), so a refusal gets fixed words; a gate's own sentence is shown when
 * it is one of ours (the consent or the card it needs), since it says what
 * to do. Only a still that keeps an earlier painting ever shows it: a
 * refused first painting ends the ad (paintStep).
 */
function refusalReason(outcome: Extract<PaintOutcome, { kind: "failed" }>): string | null {
  if (outcome.cause === "refused") return STILL_REPAINT_REFUSED;
  if (outcome.cause === "gate") return (CAMPAIGN_MESSAGES as readonly string[]).includes(outcome.error) ? outcome.error : null;
  return null;
}

/** The painting's result, written into its attempt. A house painting keeps the better of the two; any other becomes the one shown. */
export function withOutcome(
  stills: readonly StillState[],
  shot: number,
  n: number,
  outcome: PaintOutcome,
  nowIso: string,
): StillState[] {
  return stills.map((s) => {
    if (s.shot !== shot) return s;
    const target = s.attempts.find((a) => a.n === n);
    if (outcome.kind === "skipped" || outcome.kind === "later" || !target || target.status !== "reserved") return s; // already written: a second write is a no-op
    const done: StillAttempt =
      outcome.kind === "painted"
        ? {
            ...target,
            status: "painted",
            path: outcome.path,
            face: outcome.face,
            product: outcome.product,
            reason: outcome.reason,
            fits: outcome.fits,
            faceScore: outcome.faceScore,
            escalations: outcome.escalations,
            doneAt: nowIso,
          }
        : {
            ...target,
            status: "failed",
            doneAt: nowIso,
            error: outcome.error.slice(0, 300),
            credits: outcome.refunded ? 0 : target.credits,
            reason: refusalReason(outcome),
          };
    const attempts = s.attempts.map((a) => (a.n === n ? done : a));
    if (done.status !== "painted") return { ...s, attempts };
    const previous = keptAttempt({ ...s, attempts });
    const keep = done.kind === "house" && previous ? betterAttempt(previous, done).n : done.n;
    return { ...s, attempts, keep, decision: "pending" as const };
  });
}

/**
 * The still the checker repaints next on the house, or null: its shown
 * painting missed (see missed), the person has not repainted it, and the
 * house has not repainted it yet (one per still, ever).
 */
export function houseRepaintDue(stills: readonly StillState[], faceGateOn: boolean): number | null {
  for (const s of stills) {
    if (inFlight(s)) continue;
    if (s.attempts.some((a) => a.kind === "house" || a.kind === "repaint")) continue;
    const kept = keptAttempt(s);
    if (kept && missed(kept, faceGateOn)) return s.shot;
  }
  return null;
}

/** A still with no painted attempt and nothing left in flight: it will never be painted. */
export function stillLost(still: StillState): boolean {
  return !inFlight(still) && !still.attempts.some((a) => a.status === "painted");
}

/**
 * Why the still's newest attempt, a repaint after the painting it shows,
 * did not happen (refusalReason), or null. A later painting replaces it.
 * The house's own free repaint, refused, says nothing of itself: the person
 * never asked for it, and the check's reason (why the still missed) is
 * what they need to decide on it. A gate's sentence still shows, since it
 * says what to do.
 */
export function repaintRefusal(still: StillState): string | null {
  const last = still.attempts.at(-1);
  if (!last || last.status !== "failed" || !last.reason) return null;
  if (last.kind === "house" && last.reason === STILL_REPAINT_REFUSED) return null;
  return still.keep !== null && last.n > still.keep ? last.reason : null;
}

/**
 * Credits the person was charged for attempts that painted nothing and did
 * not get back: a failed attempt whose charge stayed (the refund rules, the
 * automatic_refunds switch or the daily cap, kept it). One whose charge paid
 * for the house's retry that then painted is not counted: that still was
 * delivered at its price (v2 #11). Reserved attempts are not counted here:
 * a closing ad releases them (failCampaign).
 */
export function creditsKept(stills: readonly StillState[]): number {
  let kept = 0;
  for (const s of stills) {
    for (const a of s.attempts) {
      if (a.status !== "failed" || a.credits <= 0) continue;
      const paidFor = s.attempts.some((r) => r.n > a.n && r.kind === "retry" && r.credits === 0 && r.status === "painted");
      if (!paidFor) kept += a.credits;
    }
  }
  return kept;
}

/** The closing words that say "nothing was charged for the ones that didn't paint", and what they say when that isn't so. */
const CHARGED_WORDS: Readonly<Record<string, string>> = {
  [PAINT_FAILED]: PAINT_FAILED_CHARGED,
  [STILL_REFUSED]: STILL_REFUSED_CHARGED,
};

/**
 * An ad's closing words, from what actually came back: never "nothing was
 * charged" over a credit it kept. `charged` is what to say instead when a
 * credit stayed; by default our own closing's charged twin, or the words
 * as they are when they never spoke of a charge.
 */
export function failWords(error: string, keptCredits: number, charged: string = CHARGED_WORDS[error] ?? error): string {
  return keptCredits > 0 ? charged : error;
}

/** Whether a failed attempt of this kind gets its one retry (only the paid paintings do, once per still; paid or on the house: v2 #11). */
export function retryDue(still: StillState, failed: StillAttempt): boolean {
  if (failed.kind !== "paint" && failed.kind !== "repaint") return false;
  return !still.attempts.some((a) => a.kind === "retry") && still.attempts.length < MAX_ATTEMPTS_PER_STILL;
}

export type DecideAction = "approve" | "keep" | "undo";

/** A person's decision on one still. */
export function withDecision(
  stills: readonly StillState[],
  shot: number,
  action: DecideAction,
): { ok: true; stills: StillState[] } | { ok: false; reason: "shot" | "busy" | "notReady" } {
  const still = stillOf(stills, shot);
  if (!still) return { ok: false, reason: "shot" };
  if (inFlight(still)) return { ok: false, reason: "busy" };
  if (!keptAttempt(still)) return { ok: false, reason: "notReady" };
  const decision: StillDecision = action === "approve" ? "approved" : action === "keep" ? "kept" : "pending";
  return { ok: true, stills: stills.map((s) => (s.shot === shot ? { ...s, decision } : s)) };
}

// ---------------------------------------------------------------------------
// The row
// ---------------------------------------------------------------------------

export const CAMPAIGN_COLUMNS =
  "id, user_id, source, send_id, product_id, brand_kit_id, character_ids, trial_id, mcp_grant_id, length_s, aspect, goal, plan, quote, stills, stage, stage_changed_at, locked_at, attempts, version, keyframe_ids, cost_usd, credits_charged, credits_refunded, error, expires_at, overdue_notified_at, created_at, updated_at, deleted_at, " +
  // Cut 4 (press-tour-03b-film.sql)
  "shots, shot_ids, film_charged_at, cut_due_at, delivered_at, assembly, renditions, master_generation_id, product_verdict";

export type CampaignRow = {
  id: string;
  userId: string;
  source: CampaignSource;
  sendId: string;
  productId: string;
  brandKitId: string | null;
  characterIds: string[];
  trialId: string | null;
  lengthSeconds: 10 | 15 | 30;
  goal: string | null;
  plan: AdPlan | null;
  quote: PressQuote | null;
  stills: StillState[];
  stage: CampaignStage;
  stageChangedAt: string;
  lockedAt: string | null;
  version: number;
  keyframeIds: string[];
  /** Cut 4: every filmed shot and its takes (shots.ts). */
  shots: ShotState[];
  shotIds: string[];
  filmChargedAt: string | null;
  /** The 24 h rule's clock: null while the ad waits on the person, or once delivered. */
  cutDueAt: string | null;
  deliveredAt: string | null;
  /** The cut's working state and its files, as stored (cut-state.ts parses them). */
  assembly: unknown;
  renditions: unknown;
  masterGenerationId: string | null;
  productVerdict: Verdict | null;
  costUsd: number;
  creditsCharged: number;
  creditsRefunded: number;
  error: string | null;
  expiresAt: string | null;
  overdueNotifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const SOURCES: readonly CampaignSource[] = ["door", "generate", "producer", "mcp", "trial"];

/** A row as the code reads it, or null when it is not one. */
export function campaignRowFrom(raw: unknown): CampaignRow | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = parseUuid(r.id);
  const userId = parseUuid(r.user_id);
  const sendId = parseUuid(r.send_id);
  const productId = parseUuid(r.product_id);
  if (!id || !userId || !sendId || !productId || !isStage(r.stage) || r.deleted_at) return null;
  const length = r.length_s === 10 || r.length_s === 30 ? r.length_s : 15;
  const plan = parseAdPlan(r.plan);
  const ids = (v: unknown) => (Array.isArray(v) ? v.map(parseUuid).filter((x): x is string => x !== null) : []);
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? Number(v) || 0 : 0);
  return {
    id,
    userId,
    source: SOURCES.includes(r.source as CampaignSource) ? (r.source as CampaignSource) : "door",
    sendId,
    productId,
    brandKitId: parseUuid(r.brand_kit_id),
    characterIds: ids(r.character_ids),
    trialId: parseUuid(r.trial_id),
    lengthSeconds: length,
    goal: strOrNull(r.goal, 500),
    plan,
    quote: parsePressQuote(r.quote),
    stills: parseStills(r.stills, plan?.shots.length ?? 0),
    stage: r.stage,
    stageChangedAt: typeof r.stage_changed_at === "string" ? r.stage_changed_at : "",
    lockedAt: strOrNull(r.locked_at, 40),
    version: typeof r.version === "number" ? r.version : 0,
    keyframeIds: ids(r.keyframe_ids),
    shots: parseShots(r.shots, plan ? plan.shots.length : null),
    shotIds: ids(r.shot_ids),
    filmChargedAt: strOrNull(r.film_charged_at, 40),
    cutDueAt: strOrNull(r.cut_due_at, 40),
    deliveredAt: strOrNull(r.delivered_at, 40),
    assembly: r.assembly ?? null,
    renditions: r.renditions ?? null,
    masterGenerationId: parseUuid(r.master_generation_id),
    productVerdict: typeof r.product_verdict === "string" && (VERDICTS as readonly string[]).includes(r.product_verdict) ? (r.product_verdict as Verdict) : null,
    costUsd: num(r.cost_usd),
    creditsCharged: num(r.credits_charged),
    creditsRefunded: num(r.credits_refunded),
    error: strOrNull(r.error, 500),
    expiresAt: strOrNull(r.expires_at, 40),
    overdueNotifiedAt: strOrNull(r.overdue_notified_at, 40),
    createdAt: typeof r.created_at === "string" ? r.created_at : "",
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : "",
  };
}

/** The columns a transform may change. */
export type CampaignPatch = Partial<{
  stage: CampaignStage;
  plan: AdPlan;
  quote: PressQuote;
  stills: StillState[];
  locked_at: string | null;
  keyframe_ids: string[];
  cost_usd: number;
  credits_charged: number;
  credits_refunded: number;
  error: string | null;
  progress: string | null;
  expires_at: string | null;
  overdue_notified_at: string | null;
  deleted_at: string | null;
  // Cut 4 (press-tour-03b-film.sql)
  shots: ShotState[];
  shot_ids: string[];
  film_charged_at: string | null;
  cut_due_at: string | null;
  delivered_at: string | null;
  assembly: Record<string, unknown> | null;
  renditions: Record<string, unknown> | null;
  master_generation_id: string | null;
  product_verdict: Verdict | null;
}>;

/** Read one campaign (the service role; the owner filter is explicit whenever a person asked). */
export async function readCampaign(
  db: SupabaseClient,
  id: string,
  userId: string | null,
): Promise<CampaignRow | null | "unavailable"> {
  try {
    let q = db.from("press_campaigns").select(CAMPAIGN_COLUMNS).eq("id", id).is("deleted_at", null);
    if (userId) q = q.eq("user_id", userId);
    const { data, error } = await q.maybeSingle();
    if (error) return "unavailable";
    return campaignRowFrom(data);
  } catch {
    return "unavailable";
  }
}

export type Mutation<T> =
  | { ok: true; row: CampaignRow; value: T }
  | { ok: false; reason: "missing" | "unavailable" | "conflict" }
  | { ok: false; reason: "refused"; value: T };

/**
 * Read, transform, write "where version = what was read", and try again on
 * a conflict. `change` is pure: it answers { patch, value } to write, or
 * { refuse: value } to leave the row as it is (the value says why).
 */
export async function mutateCampaign<T>(
  db: SupabaseClient,
  id: string,
  userId: string | null,
  change: (row: CampaignRow) => { patch: CampaignPatch; value: T } | { refuse: T },
  tries = 5,
): Promise<Mutation<T>> {
  for (let i = 0; i < tries; i++) {
    const row = await readCampaign(db, id, userId);
    if (row === "unavailable") return { ok: false, reason: "unavailable" };
    if (!row) return { ok: false, reason: "missing" };
    const next = change(row);
    if ("refuse" in next) return { ok: false, reason: "refused", value: next.refuse };
    try {
      let q = db.from("press_campaigns").update(next.patch).eq("id", id).eq("version", row.version);
      if (userId) q = q.eq("user_id", userId);
      const { data, error } = await q.select(CAMPAIGN_COLUMNS).maybeSingle();
      if (error) return { ok: false, reason: "unavailable" };
      const written = campaignRowFrom(data);
      if (written) return { ok: true, row: written, value: next.value };
      // No row matched the version: someone wrote in between. Read again.
    } catch {
      return { ok: false, reason: "unavailable" };
    }
  }
  return { ok: false, reason: "conflict" };
}

// ---------------------------------------------------------------------------
// What the door is shown
// ---------------------------------------------------------------------------

/** A planned shot's checks: does it show the product, and the star. */
export function contextOf(plan: AdPlan | null, shot: number): ShotContext {
  const p = plan?.shots.find((x) => x.shot === shot);
  return p ? { productExpected: p.productVisibility !== "absent", star: p.star } : { productExpected: false, star: false };
}

/**
 * What blocks the next step, in plain words (English; server-text.ts and,
 * for Cut 4's lines, film-messages.ts map it), or null. Before filming,
 * awaiting_approval with every still decided says filming isn't open; the
 * service clears that line when the film switch is on.
 */
export function blockerFor(row: Pick<CampaignRow, "stage" | "stills"> & Partial<Pick<CampaignRow, "shots" | "assembly" | "plan">>): string | null {
  const shots = row.shots ?? [];
  switch (row.stage) {
    case "draft":
      return BLOCK_PLANNING;
    case "painting":
      return BLOCK_PAINTING;
    case "checking_keyframes":
      return BLOCK_CHECKING;
    case "awaiting_approval": {
      if (filmed(shots)) {
        const shot = firstDecision(shots, (n) => contextOf(row.plan ?? null, n));
        if (shot !== null) return blockDecideShot(shot);
        return parseAssembly(row.assembly).parked ? CUT_STALLED : null;
      }
      const waiting = row.stills.find((s) => inFlight(s) || s.decision === "pending");
      if (waiting) return inFlight(waiting) ? BLOCK_PAINTING : blockDecide(waiting.shot);
      return BLOCK_FILMING_NOT_OPEN;
    }
    case "animating":
      return BLOCK_FILMING;
    case "checking_shots":
      return BLOCK_READING_SHOTS;
    case "assembling":
      return BLOCK_CUTTING;
    case "signing":
      return BLOCK_FINISHING;
    default:
      return null;
  }
}

function stillView(shot: PlannedShot, still: StillState | null, imageUrl: (path: string) => string | null): StillView {
  const busy = still ? inFlight(still) : true;
  const kept = still && !busy ? keptAttempt(still) : null;
  return {
    shot: shot.shot,
    role: shot.role as ShotRole,
    span: [shot.span[0], shot.span[1]],
    direction: shot.direction,
    imageUrl: kept?.path ? imageUrl(kept.path) : null,
    face: kept ? kept.face : shot.star ? "not_checked" : "no_one_in_shot",
    product: kept ? kept.product : "not_checked",
    // A refused repaint says why first; the painting kept is shown as it was.
    reason: still && kept ? (repaintRefusal(still) ?? kept.reason ?? null) : null,
    // A shot planned without the product (a hook) has no product check to clear (PT-01).
    productExpected: shot.productVisibility !== "absent",
    decision: still && kept ? still.decision : "pending",
    repaints: still ? repaintsOf(still) : 0,
    houseRepainted: still ? houseRepainted(still) : false,
  };
}

/**
 * The projection every surface reads (campaign-types.ts CampaignView): no
 * lane, cost, raw score or attempt history (synthesis #30); a still only as
 * the signed link `imageUrl` makes of its stored path. `quote` is the fresh
 * quote (balance lines of now) when the caller has one.
 */
export function campaignView(
  row: CampaignRow,
  opts: {
    imageUrl: (path: string) => string | null;
    quote?: PressQuote | null;
    /** A kept take's stored link as a viewable one (Cut 4). */
    videoUrl?: (stored: string) => string | null;
    /** Short-lived links to the finished files, made by the caller (press-kit is private). */
    renditionUrls?: Partial<Record<RenditionKind, string>>;
    /** Admins see why a file is unsigned. */
    admin?: boolean;
  },
): CampaignView {
  const shots = row.plan?.shots ?? [];
  return {
    id: row.id,
    stage: row.stage,
    source: row.source,
    productId: row.productId,
    characterIds: [...row.characterIds],
    brandKitId: row.brandKitId,
    lengthSeconds: row.lengthSeconds,
    aspect: "9:16",
    angle: row.plan?.angle ?? null,
    stills: shots.map((s) => stillView(s, stillOf(row.stills, s.shot), opts.imageUrl)),
    shots: shotViews(
      shots.map((s) => ({ shot: s.shot, role: s.role as ShotRole, productExpected: s.productVisibility !== "absent", star: s.star })),
      row.shots,
      {
        videoUrl: opts.videoUrl ?? (() => null),
        refilmCredits: (n) => shotCredits(shots.find((s) => s.shot === n)?.seconds ?? 5),
      },
    ),
    master: masterView(row, opts.renditionUrls ?? {}, opts.admin === true),
    creditsRefunded: Math.max(0, Math.round(row.creditsRefunded)),
    quote: opts.quote ?? row.quote,
    blocker: blockerFor(row),
    error: row.stage === "failed" || row.stage === "expired" ? (row.error ?? (row.stage === "expired" ? CAMPAIGN_EXPIRED : null)) : null,
    cutOwed: cutOwed(row),
    updatedAt: row.updatedAt,
  };
}

/**
 * Whether we owe this ad its cut right now (MONEY-1): filming was charged
 * and the 24 h rule's clock runs (it stops only while the ad waits on the
 * person's decision on the press wall). Closing it then would keep the
 * filming credits and disarm the rule that refunds them, so it can't be.
 */
export function cutOwed(row: Pick<CampaignRow, "stage" | "filmChargedAt" | "cutDueAt">): boolean {
  return row.filmChargedAt !== null && row.cutDueAt !== null && !isTerminal(row.stage) && row.stage !== "ready";
}

/** The finished ad, once it is ready: its History row and both files (each only with a link to it). */
export function masterView(
  row: Pick<CampaignRow, "stage" | "renditions" | "masterGenerationId"> & Partial<Pick<CampaignRow, "assembly">>,
  urls: Partial<Record<RenditionKind, string>>,
  admin: boolean,
): MasterView | null {
  if (row.stage !== "ready") return null;
  const recs = parseRenditions(row.renditions);
  const renditions = RENDITION_KINDS.flatMap((kind) => {
    const rec = recs[kind];
    const url = urls[kind];
    return rec && url ? [{ kind, url, seconds: Math.round(rec.seconds * 10) / 10, signed: rec.signed }] : [];
  });
  const notes = RENDITION_KINDS.flatMap((kind) => {
    const rec = recs[kind];
    return rec && !rec.signed && rec.reason ? [`${kind}: ${rec.reason}`] : [];
  });
  // The end card was decided when the ad was cut (cut.ts makeEndCard); its path stays in the assembly after delivery.
  const hasEndCard = parseAssembly(row.assembly ?? null).endCard !== null;
  return { generationId: row.masterGenerationId, renditions, adminNote: admin && notes.length > 0 ? notes.join(" ") : null, hasEndCard };
}

// ---------------------------------------------------------------------------
// The machine
// ---------------------------------------------------------------------------

/** One step of a stage owned by another module (film.ts, cut.ts), injected so this file never imports them. */
export type StageRunner = (deps: MachineDeps, row: CampaignRow) => Promise<StepResult>;
export interface StageRunners {
  animating?: StageRunner;
  checking_shots?: StageRunner;
  assembling?: StageRunner;
  signing?: StageRunner;
  /** The 24 h rule, on the cron's minute (cut.ts lateCuts): how many ads it closed. */
  late?: (deps: MachineDeps) => Promise<number>;
}

export interface MachineDeps {
  /** The service-role client. */
  db: SupabaseClient;
  /** Paint and check one reserved still (paint.ts paintKeyframe). */
  paint: (input: { userId: string; campaignId: string; shot: number; attempt: number }) => Promise<PaintOutcome>;
  /** Reserve a house row (0 credits) for the checker's repaint or a retry. True when the row exists (a repeat included). */
  reserveHouse: (input: { campaign: CampaignRow; shot: number; kind: "house" | "retry"; rowId: string }) => Promise<boolean>;
  /**
   * v2 #11: reserve a PAID retry for a still whose charge went back, against
   * the person's own allowance (paint.ts reservePaidRetry). "window": the
   * billing window moved since `failedReservedAt` (the retry is the
   * house's); "refused": the person cannot pay for it now (no retry).
   */
  reservePaid: (input: {
    campaign: CampaignRow;
    shot: number;
    rowId: string;
    credits: number;
    failedReservedAt: string;
  }) => Promise<"reserved" | "window" | "refused">;
  /** End a reserved row that will never be painted: status failed, and the refund authority (forced: nothing was delivered). */
  releaseRow: (input: { userId: string; rowId: string; credits: number; reason: string }) => Promise<boolean>;
  /** Whether the identity gate is on (its bar above 0): a face miss repaints only then. */
  faceGateOn: () => Promise<boolean>;
  notifyAdmins: (message: { title: string; body: string; path?: string }) => Promise<void>;
  now?: () => Date;
  /** Cut 4: filming and the checks on shots (film.ts). Absent = those stages wait. */
  film?: FilmDeps;
  /** Cut 4: the cut, signing and delivery (cut.ts). */
  cut?: CutDeps;
  /** Cut 4: the steps of the film stages (film.ts filmStep, checkShotsStep; cut.ts assembleStep, signStep, lateCuts). */
  stages?: StageRunners;
  /**
   * End a row that was sent to a lane and will not be delivered: the
   * ORDINARY refund rules (the render may be billed: PT-06), then failed.
   * True when credits went back. Absent: the row is left to the reaper.
   */
  settleRow?: (input: { userId: string; rowId: string; credits: number; reason: string }) => Promise<boolean>;
}

export type StepResult =
  | "painted"
  | "retrying"
  | "repainting"
  | "checked"
  | "waiting"
  | "failed"
  | "idle"
  | "busy"
  | "unavailable"
  // Cut 4
  | "submitted"
  | "filming"
  | "filmed"
  | "checked_shot"
  | "cut"
  | "delivered";

const nowOf = (deps: { now?: () => Date }) => (deps.now ? deps.now() : new Date());

/** The stills of a closed campaign with every reserved attempt marked failed. */
export function closeAttempts(stills: readonly StillState[], reason: string, nowIso: string): StillState[] {
  return stills.map((s) => ({
    ...s,
    attempts: s.attempts.map((a) => (a.status === "reserved" ? { ...a, status: "failed" as const, doneAt: nowIso, error: reason } : a)),
  }));
}

/**
 * The rows of attempts a closing campaign held and will never paint:
 * refunded (forced: nothing was delivered), then ended. Returns the credits
 * that went back. A row whose refund fails stays "generating" (paint.ts
 * endStillRow refunds first and ends the row only after), and the orphan
 * reaper ends and settles it within the hour (job-runner.ts).
 */
export async function releaseAttempts(
  deps: Pick<MachineDeps, "releaseRow">,
  userId: string,
  attempts: readonly StillAttempt[],
  reason: string,
): Promise<number> {
  let back = 0;
  for (const attempt of attempts) {
    const refunded = await deps.releaseRow({ userId, rowId: attempt.rowId, credits: attempt.credits, reason }).catch(() => false);
    if (refunded) back += attempt.credits;
  }
  return back;
}

/**
 * Close a campaign as failed: the stage first (so nothing paints on), then
 * every attempt it still held is ended and refunded, and the refund is
 * written down. The closing words are chosen from what actually came back
 * (failWords): a failed still whose charge the refund rules kept, or a held
 * one whose release did not go through, turns "nothing was charged for the
 * ones that didn't paint" into words that say one was. `charged` is the
 * closing to use instead when a credit stayed (failWords), for words that
 * are not our own: a refusal's sentence from a picture lane or a gate.
 */
export async function failCampaign(deps: MachineDeps, row: CampaignRow, error: string, charged?: string): Promise<void> {
  const nowIso = nowOf(deps).toISOString();
  const closed = await mutateCampaign<{ stills: StillAttempt[]; takes: Take[]; kept: number }>(deps.db, row.id, null, (fresh) => {
    if (isTerminal(fresh.stage)) return { refuse: { stills: [], takes: [], kept: 0 } };
    const kept = creditsKept(fresh.stills);
    return {
      patch: {
        stage: "failed",
        error: failWords(error, kept, charged),
        stills: closeAttempts(fresh.stills, error, nowIso),
        shots: closeOpenTakes(fresh.shots, error, nowIso),
        locked_at: null,
        cut_due_at: null,
      },
      value: { stills: reservedAttempts(fresh.stills).map((r) => r.attempt), takes: openTakes(fresh.shots).map((t) => t.take), kept },
    };
  });
  if (!closed.ok) return;
  const stillsBack = await releaseAttempts(deps, row.userId, closed.value.stills, error);
  const takeBack = await releaseTakes(deps, row.userId, closed.value.takes, error);
  const back = stillsBack + takeBack.credits;
  // A held still whose release did not go through keeps its credits until
  // the orphan reaper settles it by the ordinary rules: not "nothing".
  const unreleased = closed.value.stills.reduce((n, a) => n + a.credits, 0) - stillsBack;
  const words = failWords(error, closed.value.kept + unreleased, charged);
  const reword = words !== failWords(error, closed.value.kept, charged);
  if (back > 0 || takeBack.rowIds.length > 0 || reword) {
    await mutateCampaign(deps.db, row.id, null, (fresh) => ({
      patch: {
        credits_refunded: fresh.creditsRefunded + back,
        shots: withTakesRefunded(fresh.shots, takeBack.rowIds),
        ...(reword && fresh.stage === "failed" ? { error: words } : {}),
      },
      value: null,
    }));
  }
}

/**
 * Takes an ad closes on while they are open: one never sent to the lane
 * gets its credits back FORCED (nothing was spent); one the lane holds is
 * stopped where the lane allows and settled by the ORDINARY rules (it may
 * be billed). Returns the credits that went back and whose.
 */
export async function releaseTakes(deps: MachineDeps, userId: string, takes: readonly Take[], reason: string): Promise<{ credits: number; rowIds: string[] }> {
  let credits = 0;
  const rowIds: string[] = [];
  for (const take of takes) {
    let refunded = false;
    if (take.status === "reserved") {
      refunded = await deps.releaseRow({ userId, rowId: take.rowId, credits: take.credits, reason }).catch(() => false);
    } else {
      if (take.job && deps.film) await deps.film.cancel(take.job).catch(() => undefined);
      refunded = deps.settleRow ? await deps.settleRow({ userId, rowId: take.rowId, credits: take.credits, reason }).catch(() => false) : false;
    }
    if (refunded && take.credits > 0) {
      credits += take.credits;
      rowIds.push(take.rowId);
    }
  }
  return { credits, rowIds };
}

/**
 * ONE step of one claimed campaign. The caller holds the lease
 * (claim_press_campaigns) and releases it after; every write here goes
 * through mutateCampaign, so a person's press in between is never lost.
 */
export async function stepCampaign(deps: MachineDeps, campaignId: string): Promise<StepResult> {
  const row = await readCampaign(deps.db, campaignId, null);
  if (row === "unavailable") return "unavailable";
  if (!row || isTerminal(row.stage)) return "idle";
  if (!row.plan) {
    await failCampaign(deps, row, PAINT_FAILED);
    return "failed";
  }

  if (row.stage === "painting") return paintStep(deps, row);
  if (row.stage === "checking_keyframes") return checkStep(deps, row);
  // Cut 4: filming, the checks on shots, the cut and signing (film.ts,
  // cut.ts), when wired; without them those stages wait.
  if (row.stage === "animating" || row.stage === "checking_shots" || row.stage === "assembling" || row.stage === "signing") {
    const run = deps.stages?.[row.stage];
    return run ? run(deps, row) : "idle";
  }
  return "idle";
}

async function paintStep(deps: MachineDeps, row: CampaignRow): Promise<StepResult> {
  const next = nextReserved(row.stills);
  if (!next) {
    const moved = await mutateCampaign(deps.db, row.id, null, (fresh) =>
      fresh.stage !== "painting" || nextReserved(fresh.stills) ? { refuse: null } : { patch: { stage: "checking_keyframes" }, value: null },
    );
    return moved.ok ? "checked" : "busy";
  }

  const { shot, attempt } = next;
  const outcome = await deps
    .paint({ userId: row.userId, campaignId: row.id, shot, attempt: attempt.n })
    .catch((err: unknown): PaintOutcome => ({
      kind: "failed",
      cause: "provider",
      error: err instanceof Error ? err.message.slice(0, 200) : "paint failed",
      usd: 0,
      refunded: false,
    }));
  if (outcome.kind === "skipped") return "idle";
  // A read failed before anything was spent: the cron tries the same attempt again.
  if (outcome.kind === "later") return "unavailable";
  const nowIso = nowOf(deps).toISOString();

  // The retry after a provider failure (v2 #11), reserved BEFORE it is
  // written down, so the stills never name a row that does not exist:
  //   the failed still's charge WENT BACK -> the retry is paid, at the same
  //     price, in the same billing window (a moved window: the house's);
  //   its charge STAYED (refused by the refund rules, or never refunded)
  //     -> the retry is the house's, 0 credits, and that charge pays for it.
  // So a still delivered after a failure costs the person exactly its price
  // once (M1). The person's note rides along to the retry.
  let retry: { rowId: string; credits: number } | null = null;
  if (outcome.kind === "failed" && (outcome.cause === "provider" || outcome.cause === "gone")) {
    const still = stillOf(row.stills, shot);
    if (still && retryDue(still, attempt)) {
      let house = !(attempt.credits > 0 && outcome.refunded);
      if (!house) {
        const rowId = paidRetryRowId(attempt.rowId);
        const paid = await deps
          .reservePaid({ campaign: row, shot, rowId, credits: attempt.credits, failedReservedAt: attempt.at })
          .catch((): "refused" => "refused");
        if (paid === "reserved") retry = { rowId, credits: attempt.credits };
        else if (paid === "window") house = true;
      }
      if (house) {
        const rowId = houseRowId(row.id, shot, "retry", still.attempts.length + 1);
        if (await deps.reserveHouse({ campaign: row, shot, kind: "retry", rowId }).catch(() => false)) retry = { rowId, credits: 0 };
      }
    }
  }

  const terminal = outcome.kind === "failed" && (outcome.cause === "refused" || outcome.cause === "gate");
  const written = await mutateCampaign(deps.db, row.id, null, (fresh) => {
    if (isTerminal(fresh.stage)) return { refuse: "closed" as const };
    let stills = withOutcome(fresh.stills, shot, attempt.n, outcome, nowIso);
    const patch: CampaignPatch = { cost_usd: Math.round((fresh.costUsd + outcome.usd) * 10_000) / 10_000 };
    if (outcome.kind === "painted") {
      if (!fresh.keyframeIds.includes(attempt.rowId)) patch.keyframe_ids = [...fresh.keyframeIds, attempt.rowId].slice(-64);
    } else {
      if (outcome.refunded) patch.credits_refunded = fresh.creditsRefunded + attempt.credits;
      if (retry) {
        const next = withReserved(stills, shot, { rowId: retry.rowId, kind: "retry", credits: retry.credits, note: attempt.note }, nowIso);
        if (next) {
          stills = next;
          if (retry.credits > 0) patch.credits_charged = fresh.creditsCharged + retry.credits;
        }
      }
    }
    patch.stills = stills;
    // A refusal or a missing consent ends the ad only when the still has no
    // painting to keep. A refused repaint (the house's after the check, or
    // the person's) is written as failed, its credits settled as paint.ts
    // settled them, and the still keeps the painting it had and says why
    // (repaintRefusal): the stills already painted and paid for go on to
    // the person, never thrown away with the ad.
    const lost = stillOf(stills, shot);
    const keeps = lost ? keptAttempt(lost) !== null : false;
    if ((terminal && !keeps) || (lost && stillLost(lost))) return { patch, value: "fail" as const };
    return { patch, value: "go" as const };
  });
  // A retry reserved but not written down (the ad closed, or the write
  // failed) is given back at once, never left charged on a row nobody paints.
  if (retry && !(written.ok && written.row.stills.some((st) => st.attempts.some((a) => a.rowId === retry.rowId)))) {
    await deps
      .releaseRow({ userId: row.userId, rowId: retry.rowId, credits: retry.credits, reason: "The ad moved on before this still was retried." })
      .catch(() => false);
  }
  if (!written.ok) return written.reason === "refused" ? "idle" : "unavailable";

  if (written.value === "fail") {
    const refused = outcome.kind === "failed" && outcome.cause === "refused";
    const error = refused
      ? outcome.error || STILL_REFUSED
      : outcome.kind === "failed" && outcome.cause === "gate"
        ? outcome.error
        : PAINT_FAILED;
    // A refusal closes with the refuser's own sentence, and a picture
    // lane's says "nothing was charged" (IMAGE_REQUEST_REFUSED): true of
    // that one request, false when an earlier attempt at the still kept its
    // credit (a painting that failed after the lane was called, whose refund
    // the refund rules held back, then a house retry the lane refused). The
    // ad then closes with our words that say so (M-1).
    await failCampaign(deps, written.row, error, refused ? STILL_REFUSED_CHARGED : undefined);
    return "failed";
  }
  if (outcome.kind === "painted") return "painted";
  return retry ? "retrying" : "painted";
}

async function checkStep(deps: MachineDeps, row: CampaignRow): Promise<StepResult> {
  const faceGate = await deps.faceGateOn().catch(() => false);
  const shot = houseRepaintDue(row.stills, faceGate);
  const nowIso = nowOf(deps).toISOString();

  if (shot !== null) {
    const still = stillOf(row.stills, shot)!;
    const rowId = houseRowId(row.id, shot, "house", still.attempts.length + 1);
    const reserved = await deps.reserveHouse({ campaign: row, shot, kind: "house", rowId }).catch(() => false);
    const written = await mutateCampaign(deps.db, row.id, null, (fresh) => {
      if (fresh.stage !== "checking_keyframes") return { refuse: null };
      if (reserved) {
        const stills = withReserved(fresh.stills, shot, { rowId, kind: "house", credits: 0 }, nowIso);
        if (stills) return { patch: { stills, stage: "painting" }, value: null };
      }
      // The house row could not be reserved: mark the repaint as tried, so
      // the still goes to the person as it is instead of looping here.
      const stills = fresh.stills.map((s) =>
        s.shot !== shot || s.attempts.length >= MAX_ATTEMPTS_PER_STILL
          ? s
          : {
              ...s,
              attempts: [
                ...s.attempts,
                {
                  n: s.attempts.length + 1,
                  rowId,
                  kind: "house" as const,
                  status: "failed" as const,
                  credits: 0,
                  path: null,
                  face: "not_checked" as const,
                  product: "not_checked" as const,
                  reason: null,
                  fits: null,
                  faceScore: null,
                  escalations: 0,
                  note: null,
                  at: nowIso,
                  doneAt: nowIso,
                  error: "house row not reserved",
                },
              ],
            },
      );
      return { patch: { stills }, value: null };
    });
    return written.ok ? "repainting" : "busy";
  }

  const moved = await mutateCampaign(deps.db, row.id, null, (fresh) =>
    fresh.stage !== "checking_keyframes" || houseRepaintDue(fresh.stills, faceGate) !== null || nextReserved(fresh.stills)
      ? { refuse: null }
      : { patch: { stage: "awaiting_approval", expires_at: new Date(nowOf(deps).getTime() + WAIT_MS).toISOString() }, value: null },
  );
  return moved.ok ? "waiting" : "busy";
}

// ---------------------------------------------------------------------------
// Claiming, kicks and the cron's tick
// ---------------------------------------------------------------------------

export type Claimed = { id: string; userId: string; stage: CampaignStage; version: number; lockedAt: string };

/** claim_press_campaigns: up to `limit` due campaigns, or exactly one by id. */
export async function claimCampaigns(db: SupabaseClient, limit: number, campaignId: string | null = null): Promise<Claimed[]> {
  try {
    const { data, error } = await db.rpc("claim_press_campaigns", { p_limit: limit, p_campaign: campaignId });
    if (error || !Array.isArray(data)) return [];
    const out: Claimed[] = [];
    for (const r of data as Record<string, unknown>[]) {
      const id = parseUuid(r.id);
      const userId = parseUuid(r.user_id);
      if (id && userId && isStage(r.stage) && typeof r.locked_at === "string") {
        out.push({ id, userId, stage: r.stage, version: Number(r.version) || 0, lockedAt: r.locked_at });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Give the lease back (only if it is still ours). */
export async function releaseLease(db: SupabaseClient, claimed: Claimed): Promise<void> {
  try {
    await db.from("press_campaigns").update({ locked_at: null }).eq("id", claimed.id).eq("locked_at", claimed.lockedAt);
  } catch {
    /* the lease runs out on its own */
  }
}

/** Claim one campaign by id, do one step, release. "busy" when someone else holds it. */
export async function stepOnce(deps: MachineDeps, campaignId: string): Promise<StepResult> {
  const [claimed] = await claimCampaigns(deps.db, 1, campaignId);
  if (!claimed) return "busy";
  try {
    return await stepCampaign(deps, claimed.id);
  } finally {
    await releaseLease(deps.db, claimed);
  }
}

/**
 * A kick's budget (M2, PT-07): the kick runs inside the page function's own
 * limit, and driveCampaign only looks at the clock BEFORE a step, so a step
 * may start only while a WHOLE worst-case step still fits (the picture
 * lane's timeout, the check's budget, and a margin for the gates and
 * writes). A step started later would be killed mid-render, its paid
 * picture lost and its lease held for 6 minutes; the cron carries on instead.
 */
export function kickBudgetMs(input: { functionMs: number; laneTimeoutMs: number; checkBudgetMs: number; marginMs: number }): number {
  return Math.max(0, input.functionMs - (input.laneTimeoutMs + input.checkBudgetMs + input.marginMs));
}

/**
 * The results a kick carries on after. Not "submitted" or "filming": once
 * the lane holds the takes, the cron's minute asks after them.
 */
const CONTINUE_AFTER: readonly StepResult[] = ["painted", "retrying", "repainting", "checked", "filmed", "checked_shot", "cut"];

/**
 * A kick after a press: steps one campaign until it waits on the person,
 * closes, is held by someone else, or the time runs out (the cron carries
 * on from there). Never throws.
 */
export async function driveCampaign(deps: MachineDeps, campaignId: string, opts: { budgetMs: number }): Promise<StepResult[]> {
  const started = nowOf(deps).getTime();
  const steps: StepResult[] = [];
  for (let i = 0; i < 24; i++) {
    if (nowOf(deps).getTime() - started > opts.budgetMs) break;
    const result = await stepOnce(deps, campaignId).catch((): StepResult => "unavailable");
    steps.push(result);
    if (!CONTINUE_AFTER.includes(result)) break;
  }
  return steps;
}

export type TickReport = { expired: number; stale: number; overdue: number; late: number; stepped: Record<string, StepResult> };

/** Stages whose one step is heavy work on this machine (ffmpeg): at most one of them per tick. */
const HEAVY_STAGES: readonly CampaignStage[] = ["assembling"];

/**
 * The cron's minute: close campaigns that waited too long, fail drafts
 * whose planning died, tell Admin about stuck ones (once per stage), close
 * the ads we owed a cut for 24 h (v2 #39, cut.ts), then claim a bounded
 * batch and do one step of each, side by side, with at most one heavy step
 * (a cut) so the minute stays inside its function.
 */
export async function pressTick(deps: MachineDeps, opts: { batch: number }): Promise<TickReport> {
  const now = nowOf(deps);
  const report: TickReport = { expired: 0, stale: 0, overdue: 0, late: 0, stepped: {} };

  // 1. Waited 7 days on the person: closed, nothing refunded. Before
  //    filming, filming was never charged; after it, the filmed shots were
  //    delivered to History, and the words say so.
  try {
    const { data } = await deps.db
      .from("press_campaigns")
      .select("id, film_charged_at")
      .in("stage", WAITING_STAGES as unknown as string[])
      .lt("expires_at", now.toISOString())
      .is("deleted_at", null)
      .limit(50);
    for (const r of (data ?? []) as { id: string; film_charged_at?: string | null }[]) {
      const { data: closed } = await deps.db
        .from("press_campaigns")
        .update({ stage: "expired", error: r.film_charged_at ? FILM_EXPIRED : CAMPAIGN_EXPIRED, cut_due_at: null })
        .eq("id", r.id)
        .in("stage", WAITING_STAGES as unknown as string[])
        .lt("expires_at", now.toISOString())
        .select("id");
      if (Array.isArray(closed)) report.expired += closed.length;
    }
  } catch {
    /* next minute */
  }

  // 2. A draft whose planning request died (planning runs inline in the press).
  try {
    const { data } = await deps.db
      .from("press_campaigns")
      .update({ stage: "failed", error: PLAN_STALLED })
      .eq("stage", "draft")
      .lt("updated_at", new Date(now.getTime() - DRAFT_STALE_MS).toISOString())
      .is("deleted_at", null)
      .select("id");
    report.stale = Array.isArray(data) ? data.length : 0;
  } catch {
    /* next minute */
  }

  // 3. Stuck in one working stage for 45 minutes: Admin hears once per stage.
  try {
    const { data } = await deps.db
      .from("press_campaigns")
      .select("id, stage")
      .in("stage", WORKING_STAGES as unknown as string[])
      .lt("stage_changed_at", new Date(now.getTime() - OVERDUE_MS).toISOString())
      .is("overdue_notified_at", null)
      .is("deleted_at", null)
      .limit(10);
    for (const r of (data ?? []) as { id: string; stage: string }[]) {
      const { data: marked } = await deps.db
        .from("press_campaigns")
        .update({ overdue_notified_at: now.toISOString() })
        .eq("id", r.id)
        .is("overdue_notified_at", null)
        .select("id");
      if (Array.isArray(marked) && marked.length > 0) {
        report.overdue += 1;
        await deps.notifyAdmins({
          title: "Press Tour ad stuck",
          body: `Campaign ${r.id.slice(0, 8)} has been in ${r.stage} for over 45 minutes.`,
          // An Admin anchor, like every other admin push (PT-11): "/app/admin" is not a page.
          path: "#system",
        });
      }
    }
  } catch {
    /* next minute */
  }

  // 4. The 24 h rule (cut.ts lateCuts), when wired.
  if (deps.stages?.late) {
    report.late = await deps.stages.late(deps).catch(() => 0);
  }

  // 5. One step each, side by side; at most one heavy step (a cut) a minute.
  const claimed = await claimCampaigns(deps.db, opts.batch);
  let heavy = false;
  await Promise.all(
    claimed.map(async (c) => {
      try {
        if (HEAVY_STAGES.includes(c.stage)) {
          if (heavy) return; // the next minute takes it
          heavy = true;
        }
        report.stepped[c.id] = await stepCampaign(deps, c.id);
      } catch {
        report.stepped[c.id] = "unavailable";
      } finally {
        await releaseLease(deps.db, c);
      }
    }),
  );
  return report;
}
