// Press Tour's filmed shots: what press_campaigns.shots holds, the pure
// rules that read and change it, and what the door is shown of it (Cut 4;
// spec §1.7-§1.9 as changed by v2 and the operator's decisions of
// 2026-09-26).
//
// ONE SHOT, SEVERAL TAKES. Every shot of the plan is filmed from its approved
// (or kept) still. A take is one generations row:
//   film    the first filming, paid in the Film press (the quote's film line)
//   refilm  the person's "Re-film shot N", at that shot's normal film price
//   retry   the one retry after a provider failure (v2 #11): paid again at
//           its price when the failed take's charge went back, on the house
//           (0 credits) when it stayed
// A take goes reserved -> filming (the lane has it) -> filmed (kept in our
// storage, the output gate passed) -> checked (3 moments read, record-only),
// or failed.
//
// THE PRESS WALL. Nothing is decided for the person (operator, 2026-09-26:
// no re-shoot and no refund for a product miss before the checker is
// calibrated). A shot waits on the person when its chosen take didn't match
// (the product, or the face), when it has no usable take (a take refused by
// the content rules included: MONEY-2), or when it was filmed again (the
// person picks the take). They keep a take, film it again at its price, or
// cut it for free. A clean shot goes into the cut as it is. "Not readable"
// and "Not checked" are never a miss.
//
// Pure and alias-free (vitest has no "@/"), and a leaf: campaign-machine.ts
// imports it, never the other way round.

import type { MomentDetail, MomentView, ShotDecision, ShotRole, ShotView, TakeState, TakeView, Verdict } from "./campaign-types";
import { VERDICT_SEVERITY, worseVerdict } from "../product-lock/product-lock";

// ---------------------------------------------------------------------------
// Bounds (the shots column is bounded to 256 KB in press-tour-03b-film.sql,
// above the most parseShots can hand back: bounds.test.ts)
// ---------------------------------------------------------------------------

/** Every take a shot may ever hold (film, its retry, re-films and their retries). */
export const MAX_TAKES_PER_SHOT = 5;
/** Times the person may film one shot again. */
export const MAX_REFILMS_PER_SHOT = 2;
/** Moments kept per take (3 read; 4 for a packshot). */
export const MAX_MOMENTS = 6;

export const TAKE_KINDS = ["film", "refilm", "retry"] as const;
export type TakeKind = (typeof TAKE_KINDS)[number];
export const TAKE_STATUSES = ["reserved", "filming", "filmed", "checked", "failed"] as const;
export type TakeStatus = (typeof TAKE_STATUSES)[number];
/** Why a take failed. provider: the lane (or a step around it); gone: its row was settled elsewhere; refused: a content gate; gate: a consent is missing. */
export type TakeFailCause = "provider" | "gone" | "refused" | "gate";
/** The bottom corner the AI-generated tag sits in for this take (the one away from the product). */
export type TagCorner = "left" | "right";

/** The lane's handle on a submitted take (fal.ts QueuedJob), kept until the take is collected. */
export type LaneJob = { requestId: string; statusUrl: string; responseUrl: string; cancelUrl: string; label: string };

export type Take = {
  n: number;
  rowId: string;
  kind: TakeKind;
  status: TakeStatus;
  /** Credits this take's row holds (0 for a house retry, or once refunded). */
  credits: number;
  job: LaneJob | null;
  submittedAt: string | null;
  /** The filmed take's stored link (our media route; the provider's only when keeping it failed). */
  video: string | null;
  seconds: number | null;
  face: Verdict;
  product: Verdict;
  reason: string | null;
  moments: MomentView[];
  /** Second product readings this take's check spent (at most 2 across the ad). */
  escalations: number;
  corner: TagCorner | null;
  /** The person's note for a re-film. */
  note: string | null;
  at: string;
  doneAt: string | null;
  /** Why the take failed (English, never shown raw). */
  error: string | null;
  cause: TakeFailCause | null;
};

export type ShotState = {
  shot: number;
  takes: Take[];
  /** The take the person kept (n); null = the default choice (defaultChoice). */
  chosen: number | null;
  decision: ShotDecision;
};

/** What a shot is planned to show: the product (its check applies) and the star (the face check applies). */
export type ShotContext = { productExpected: boolean; star: boolean };

const DECISIONS: readonly ShotDecision[] = ["pending", "kept", "refilming", "cut"];
const VERDICTS: readonly Verdict[] = ["match", "didnt_match", "not_readable", "product_missing", "not_checked", "no_one_in_shot"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Reading the column (defensive: a malformed entry is an empty shot)
// ---------------------------------------------------------------------------

const str = (raw: unknown, max: number): string | null => (typeof raw === "string" && raw.length > 0 ? raw.slice(0, max) : null);
const verdictOf = (raw: unknown): Verdict => (typeof raw === "string" && (VERDICTS as readonly string[]).includes(raw) ? (raw as Verdict) : "not_checked");
const nonNegInt = (raw: unknown): number => (typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : 0);

function jobFrom(raw: unknown): LaneJob | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const requestId = str(r.requestId, 200);
  const statusUrl = str(r.statusUrl, 600);
  const responseUrl = str(r.responseUrl, 600);
  if (!requestId || !statusUrl || !responseUrl) return null;
  // Only the lane's own https links are ever polled.
  if (![statusUrl, responseUrl].every((u) => u.startsWith("https://"))) return null;
  const cancel = str(r.cancelUrl, 600);
  return { requestId, statusUrl, responseUrl, cancelUrl: cancel && cancel.startsWith("https://") ? cancel : "", label: str(r.label, 80) ?? "film" };
}

const PART_WORDS: readonly Verdict[] = ["match", "didnt_match", "not_readable"];
const partOf = (raw: unknown): Verdict | null => (typeof raw === "string" && (PART_WORDS as readonly string[]).includes(raw) ? (raw as Verdict) : null);

/** Both readings as stored (the press wall's "Why moment N missed"): every field or none. */
function detailFrom(raw: unknown): MomentDetail | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const read = str(r.read, 80);
  const expected = str(r.expected, 80);
  const [label, logo, shape, colour] = [partOf(r.label), partOf(r.logo), partOf(r.shape), partOf(r.colour)];
  if (!read || !expected || !label || !logo || !shape || !colour) return null;
  return { read, expected, label, logo, shape, colour };
}

function momentFrom(raw: unknown): MomentView | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const at = typeof r.atSeconds === "number" && Number.isFinite(r.atSeconds) && r.atSeconds >= 0 ? Math.round(r.atSeconds * 100) / 100 : null;
  const detail = detailFrom(r.detail);
  return { atSeconds: at, face: verdictOf(r.face), product: verdictOf(r.product), reason: str(r.reason, 200), ...(detail ? { detail } : {}) };
}

function takeFrom(raw: unknown): Take | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const n = typeof r.n === "number" && Number.isInteger(r.n) && r.n >= 1 ? r.n : null;
  const rowId = typeof r.rowId === "string" && UUID_RE.test(r.rowId) ? r.rowId.toLowerCase() : null;
  const kind = typeof r.kind === "string" && (TAKE_KINDS as readonly string[]).includes(r.kind) ? (r.kind as TakeKind) : null;
  const status = typeof r.status === "string" && (TAKE_STATUSES as readonly string[]).includes(r.status) ? (r.status as TakeStatus) : null;
  if (!n || !rowId || !kind || !status) return null;
  const cause = r.cause === "provider" || r.cause === "gone" || r.cause === "refused" || r.cause === "gate" ? r.cause : null;
  return {
    n,
    rowId,
    kind,
    status,
    credits: nonNegInt(r.credits),
    job: jobFrom(r.job),
    submittedAt: str(r.submittedAt, 40),
    video: str(r.video, 1200),
    seconds: typeof r.seconds === "number" && Number.isFinite(r.seconds) && r.seconds > 0 ? r.seconds : null,
    face: verdictOf(r.face),
    product: verdictOf(r.product),
    reason: str(r.reason, 200),
    moments: (Array.isArray(r.moments) ? r.moments : []).map(momentFrom).filter((m): m is MomentView => m !== null).slice(0, MAX_MOMENTS),
    escalations: nonNegInt(r.escalations),
    corner: r.corner === "left" || r.corner === "right" ? r.corner : null,
    note: str(r.note, 200),
    at: typeof r.at === "string" ? r.at.slice(0, 40) : "",
    doneAt: str(r.doneAt, 40),
    error: str(r.error, 300),
    cause,
  };
}

/**
 * The shots as stored, one per shot of the plan, in shot order. With no
 * plan to count them (null), as many as were stored (at most 12): a
 * campaign whose plan went missing still shows, and closes, the takes it
 * holds.
 */
export function parseShots(raw: unknown, shotCount: number | null): ShotState[] {
  const list = Array.isArray(raw) ? raw : [];
  if (shotCount === null) {
    const stored = list.map((s) => (s && typeof s === "object" ? (s as { shot?: unknown }).shot : null)).filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1);
    shotCount = Math.min(12, stored.length > 0 ? Math.max(...stored) : 0);
  }
  const out: ShotState[] = [];
  for (let shot = 1; shot <= shotCount; shot++) {
    const found = list.find((s) => s && typeof s === "object" && (s as { shot?: unknown }).shot === shot) as Record<string, unknown> | undefined;
    const takes = (Array.isArray(found?.takes) ? found.takes : [])
      .map(takeFrom)
      .filter((t): t is Take => t !== null)
      .slice(0, MAX_TAKES_PER_SHOT);
    const chosen = typeof found?.chosen === "number" && takes.some((t) => t.n === found.chosen) ? found.chosen : null;
    const decision =
      typeof found?.decision === "string" && (DECISIONS as readonly string[]).includes(found.decision) ? (found.decision as ShotDecision) : "pending";
    out.push({ shot, takes, chosen, decision });
  }
  return out;
}

/** Whether the campaign has been filmed (any take at all). */
export function filmed(shots: readonly ShotState[]): boolean {
  return shots.some((s) => s.takes.length > 0);
}

export function initialShots(count: number): ShotState[] {
  return Array.from({ length: count }, (_, i) => ({ shot: i + 1, takes: [], chosen: null, decision: "pending" as const }));
}

export function shotOf(shots: readonly ShotState[], shot: number): ShotState | null {
  return shots.find((s) => s.shot === shot) ?? null;
}

export function takeOf(shot: ShotState, n: number): Take | null {
  return shot.takes.find((t) => t.n === n) ?? null;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export function takeInFlight(t: Take): boolean {
  return t.status === "reserved" || t.status === "filming";
}

export function shotInFlight(s: ShotState): boolean {
  return s.takes.some(takeInFlight);
}

/** Being filmed or checked: our work, not the person's. */
export function shotBusy(s: ShotState): boolean {
  return s.takes.some((t) => takeInFlight(t) || t.status === "filmed");
}

/** A take that can go into the cut: checked, and its file kept. */
export function takeUsable(t: Take): boolean {
  return t.status === "checked" && t.video !== null;
}

export function refilmsOf(s: ShotState): number {
  return s.takes.filter((t) => t.kind === "refilm").length;
}

/** Whether "Re-film shot N" is still open for this shot. */
export function canRefilm(s: ShotState): boolean {
  return refilmsOf(s) < MAX_REFILMS_PER_SHOT && s.takes.length < MAX_TAKES_PER_SHOT - 1 && !shotBusy(s) && s.decision !== "cut";
}

/** A take's verdict by the worst-moment rule: the worse of the checks that apply to its shot. */
export function takeWorst(t: Take, ctx: ShotContext): Verdict {
  const parts: Verdict[] = [];
  if (ctx.productExpected) parts.push(t.product);
  if (ctx.star) parts.push(t.face);
  if (parts.length === 0) return "not_checked";
  return parts.reduce((a, b) => worseVerdict(a, b));
}

/** A checked take that didn't match: the product in its role, or the star's face. Never "not readable" or "not checked". */
export function takeMissed(t: Take, ctx: ShotContext): boolean {
  if (t.status !== "checked") return false;
  if (ctx.productExpected && (t.product === "didnt_match" || t.product === "product_missing")) return true;
  return ctx.star && t.face === "didnt_match";
}

/** The better of two usable takes: fewer misses, then the milder worst verdict, then the newer. */
export function betterTake(a: Take, b: Take, ctx: ShotContext): Take {
  const key = (t: Take) => [takeMissed(t, ctx) ? 1 : 0, VERDICT_SEVERITY[takeWorst(t, ctx)]];
  const [ka, kb] = [key(a), key(b)];
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? a : b;
  return a.n > b.n ? a : b;
}

/** The take the cut uses: the person's pick when it is usable, else the best usable take; null when none is. */
export function chosenTake(s: ShotState, ctx: ShotContext): Take | null {
  const picked = s.chosen === null ? null : takeOf(s, s.chosen);
  if (picked && takeUsable(picked)) return picked;
  const usable = s.takes.filter(takeUsable);
  if (usable.length === 0) return null;
  return usable.reduce((a, b) => betterTake(a, b, ctx));
}

/**
 * Whether the shot waits on the person before the cut: not while we are
 * filming or checking it, never once it is cut or kept with a usable take;
 * otherwise when it has no usable take, when its chosen take missed, or
 * when it was filmed again (the person picks the take).
 */
export function needsDecision(s: ShotState, ctx: ShotContext): boolean {
  if (s.decision === "cut" || shotBusy(s)) return false;
  const chosen = chosenTake(s, ctx);
  if (s.decision === "kept" && chosen && s.chosen === chosen.n) return false;
  if (!chosen) return true;
  if (takeMissed(chosen, ctx)) return true;
  return refilmsOf(s) > 0;
}

/** The first shot that waits on the person, or null. */
export function firstDecision(shots: readonly ShotState[], ctxOf: (shot: number) => ShotContext): number | null {
  return shots.find((s) => needsDecision(s, ctxOf(s.shot)))?.shot ?? null;
}

export function anyInFlight(shots: readonly ShotState[]): boolean {
  return shots.some(shotInFlight);
}

/** Takes waiting to be submitted to the lane, in shot order. */
export function reservedTakes(shots: readonly ShotState[]): { shot: number; take: Take }[] {
  return shots.flatMap((s) => s.takes.filter((t) => t.status === "reserved").map((take) => ({ shot: s.shot, take })));
}

export function filmingTakes(shots: readonly ShotState[]): { shot: number; take: Take }[] {
  return shots.flatMap((s) => s.takes.filter((t) => t.status === "filming").map((take) => ({ shot: s.shot, take })));
}

/** Takes filmed and waiting for their check, in shot order. */
export function filmedTakes(shots: readonly ShotState[]): { shot: number; take: Take }[] {
  return shots.flatMap((s) => s.takes.filter((t) => t.status === "filmed").map((take) => ({ shot: s.shot, take })));
}

/** Second product readings the ad's shot checks have spent. */
export function takeEscalations(shots: readonly ShotState[]): number {
  return shots.reduce((sum, s) => sum + s.takes.reduce((n, t) => n + t.escalations, 0), 0);
}

/** The filming credits this ad still holds: every take row charged and not given back (the 24 h rule refunds these). */
export function filmCreditsHeld(shots: readonly ShotState[]): { rowId: string; credits: number }[] {
  return shots.flatMap((s) => s.takes.filter((t) => t.credits > 0).map((t) => ({ rowId: t.rowId, credits: t.credits })));
}

/** Whether any take was refused by a content gate. */
export function anyRefused(shots: readonly ShotState[]): boolean {
  return shots.some((s) => s.takes.some((t) => t.status === "failed" && t.cause === "refused"));
}

/** A take that came through: filmed and kept (checked or waiting for its check). */
export function takeDelivered(t: Take): boolean {
  return (t.status === "filmed" || t.status === "checked") && t.video !== null;
}

/**
 * Whether a refusal closes the ad (fixer 2026-09-26, MONEY-2): only when a
 * take was refused AND no shot has any take that came through. A refused
 * re-film fails that take alone (its shot goes back to the wall with its
 * earlier take), and a refused first filming leaves that shot on the wall
 * with nothing to keep: the person cuts it free, or films it again. The
 * paid shots that came through are never lost to another shot's refusal.
 */
export function adRefused(shots: readonly ShotState[]): boolean {
  return anyRefused(shots) && !shots.some((s) => s.takes.some(takeDelivered));
}

/** Whether the retry after a provider failure is still open for this shot (one per paid filming of it: v2 #11). */
export function retryDue(s: ShotState, failed: Take): boolean {
  if (failed.kind === "retry") return false;
  const after = s.takes.filter((t) => t.n > failed.n);
  return !after.some((t) => t.kind === "retry") && s.takes.length < MAX_TAKES_PER_SHOT;
}

// ---------------------------------------------------------------------------
// Transforms (pure: every write goes through campaign-machine.ts mutateCampaign)
// ---------------------------------------------------------------------------

const mapShot = (shots: readonly ShotState[], shot: number, f: (s: ShotState) => ShotState): ShotState[] =>
  shots.map((s) => (s.shot === shot ? f(s) : s));

const mapTake = (s: ShotState, n: number, f: (t: Take) => Take): ShotState => ({ ...s, takes: s.takes.map((t) => (t.n === n ? f(t) : t)) });

/** A reserved take added to one shot. Null when the shot cannot take one (busy, full, or the row is already there). */
export function withTakeReserved(
  shots: readonly ShotState[],
  shot: number,
  a: { rowId: string; kind: TakeKind; credits: number; note?: string | null },
  nowIso: string,
): ShotState[] | null {
  const s = shotOf(shots, shot);
  if (!s || shotInFlight(s) || s.takes.length >= MAX_TAKES_PER_SHOT) return null;
  if (shots.some((x) => x.takes.some((t) => t.rowId === a.rowId))) return null;
  const take: Take = {
    n: s.takes.length + 1,
    rowId: a.rowId,
    kind: a.kind,
    status: "reserved",
    credits: a.credits,
    job: null,
    submittedAt: null,
    video: null,
    seconds: null,
    face: "not_checked",
    product: "not_checked",
    reason: null,
    moments: [],
    escalations: 0,
    corner: null,
    note: a.note ?? null,
    at: nowIso,
    doneAt: null,
    error: null,
    cause: null,
  };
  const decision: ShotDecision = a.kind === "refilm" ? "refilming" : s.decision === "cut" ? "cut" : s.decision;
  return mapShot(shots, shot, (x) => ({ ...x, takes: [...x.takes, take], decision }));
}

/** The lane took the take. A second write is a no-op. */
export function withTakeSubmitted(shots: readonly ShotState[], shot: number, n: number, job: LaneJob, nowIso: string): ShotState[] {
  return mapShot(shots, shot, (s) => mapTake(s, n, (t) => (t.status === "reserved" ? { ...t, status: "filming", job, submittedAt: nowIso } : t)));
}

/** The take is filmed and kept. The lane's handle is dropped (the column is bounded). */
export function withTakeFilmed(shots: readonly ShotState[], shot: number, n: number, got: { video: string; seconds: number }, nowIso: string): ShotState[] {
  return mapShot(shots, shot, (s) =>
    mapTake(s, n, (t) => (t.status === "filming" || t.status === "reserved" ? { ...t, status: "filmed", job: null, video: got.video, seconds: got.seconds, doneAt: nowIso } : t)),
  );
}

export type TakeCheckResult = {
  face: Verdict;
  product: Verdict;
  reason: string | null;
  moments: MomentView[];
  escalations: number;
  corner: TagCorner | null;
};

/** The take's check written in. A re-filmed shot whose new take is checked waits on the person again (pending). */
export function withTakeChecked(shots: readonly ShotState[], shot: number, n: number, check: TakeCheckResult, nowIso: string): ShotState[] {
  return mapShot(shots, shot, (s) => {
    const t = takeOf(s, n);
    if (!t || t.status !== "filmed") return s;
    const next = mapTake(s, n, (x) => ({
      ...x,
      status: "checked",
      face: check.face,
      product: check.product,
      reason: check.reason ? check.reason.slice(0, 200) : null,
      moments: check.moments.slice(0, MAX_MOMENTS),
      escalations: Math.max(0, Math.round(check.escalations || 0)),
      corner: check.corner,
      doneAt: nowIso,
    }));
    return shotInFlight(next) ? next : { ...next, decision: next.decision === "refilming" ? "pending" : next.decision, chosen: next.decision === "refilming" ? null : next.chosen };
  });
}

/** A take failed. Its credits read 0 once they went back. A re-film that failed with nothing else in flight waits on the person again. */
export function withTakeFailed(
  shots: readonly ShotState[],
  shot: number,
  n: number,
  f: { error: string; cause: TakeFailCause; refunded: boolean },
  nowIso: string,
): ShotState[] {
  return mapShot(shots, shot, (s) => {
    const t = takeOf(s, n);
    if (!t || t.status === "checked" || t.status === "failed") return s;
    const next = mapTake(s, n, (x) => ({
      ...x,
      status: "failed",
      job: null,
      error: f.error.slice(0, 300),
      cause: f.cause,
      credits: f.refunded ? 0 : x.credits,
      doneAt: nowIso,
    }));
    return shotBusy(next) ? next : { ...next, decision: next.decision === "refilming" ? "pending" : next.decision };
  });
}

/** Every take still open (reserved, or held by the lane), for a closing ad. */
export function openTakes(shots: readonly ShotState[]): { shot: number; take: Take }[] {
  return shots.flatMap((s) => s.takes.filter(takeInFlight).map((take) => ({ shot: s.shot, take })));
}

/** Every open take marked failed, for a closing ad (its row is settled by the caller). */
export function closeOpenTakes(shots: readonly ShotState[], reason: string, nowIso: string): ShotState[] {
  return shots.map((s) => ({
    ...s,
    takes: s.takes.map((t) =>
      takeInFlight(t) ? { ...t, status: "failed" as const, job: null, error: reason.slice(0, 300), cause: "provider" as const, doneAt: nowIso } : t,
    ),
  }));
}

/** Credits of these takes set to 0 (their refunds went through). */
export function withTakesRefunded(shots: readonly ShotState[], rowIds: readonly string[]): ShotState[] {
  const set = new Set(rowIds);
  return shots.map((s) => ({ ...s, takes: s.takes.map((t) => (set.has(t.rowId) ? { ...t, credits: 0 } : t)) }));
}

export type DecideFailure = "shot" | "busy" | "take" | "notReady" | "last" | "notFilmed";

/** The person keeps take `n` of a shot for the cut. */
export function withKeep(shots: readonly ShotState[], shot: number, n: number): { ok: true; shots: ShotState[] } | { ok: false; reason: DecideFailure } {
  const s = shotOf(shots, shot);
  if (!s) return { ok: false, reason: "shot" };
  if (s.takes.length === 0) return { ok: false, reason: "notFilmed" };
  if (shotBusy(s)) return { ok: false, reason: "busy" };
  const t = takeOf(s, n);
  if (!t) return { ok: false, reason: "take" };
  if (!takeUsable(t)) return { ok: false, reason: "notReady" };
  return { ok: true, shots: mapShot(shots, shot, (x) => ({ ...x, chosen: n, decision: "kept" })) };
}

/** The person leaves a shot out of the cut (free). At least one shot stays. */
export function withCut(shots: readonly ShotState[], shot: number): { ok: true; shots: ShotState[] } | { ok: false; reason: DecideFailure } {
  const s = shotOf(shots, shot);
  if (!s) return { ok: false, reason: "shot" };
  if (s.takes.length === 0) return { ok: false, reason: "notFilmed" };
  if (shotBusy(s)) return { ok: false, reason: "busy" };
  if (!shots.some((x) => x.shot !== shot && x.decision !== "cut")) return { ok: false, reason: "last" };
  return { ok: true, shots: mapShot(shots, shot, (x) => ({ ...x, decision: "cut" })) };
}

/**
 * The shots as the cut takes them: every shot left in keeps its chosen take
 * (a clean shot's default choice, or what the person picked). Null when no
 * shot has a usable take to cut from.
 */
export function settleForCut(shots: readonly ShotState[], ctxOf: (shot: number) => ShotContext): ShotState[] | null {
  const out = shots.map((s) => {
    if (s.decision === "cut") return s;
    const chosen = chosenTake(s, ctxOf(s.shot));
    return chosen ? { ...s, chosen: chosen.n, decision: "kept" as const } : { ...s, decision: "cut" as const };
  });
  return out.some((s) => s.decision === "kept") ? out : null;
}

/** What goes into the cut, in shot order: the shot and its kept take. */
export function cutList(shots: readonly ShotState[]): { shot: number; take: Take }[] {
  return shots.flatMap((s) => {
    if (s.decision !== "kept" || s.chosen === null) return [];
    const t = takeOf(s, s.chosen);
    return t && takeUsable(t) ? [{ shot: s.shot, take: t }] : [];
  });
}

// ---------------------------------------------------------------------------
// From the checker's moments to the door's words
// ---------------------------------------------------------------------------

/** One moment's product word from the checker's frame verdict. */
export function momentProduct(frame: string, productExpected: boolean): Verdict {
  if (!productExpected) return "not_checked";
  switch (frame) {
    case "match":
      return "match";
    case "didnt_match":
      return "didnt_match";
    case "not_readable":
    case "excluded":
      return "not_readable";
    case "absent":
      return "product_missing";
    default:
      return "not_checked";
  }
}

/** How the second reading saw one part of the product (the checker's Aspect). */
export type PartReading = "ok" | "off" | "unseen";
const PART_WORD: Record<PartReading, Verdict> = { ok: "match", off: "didnt_match", unseen: "not_readable" };

/**
 * Both readings of one moment, when the record holds both: a line read on
 * the label that the product doesn't carry, the confirmed word it came
 * closest to, and the second reading part by part (label, logo, shape,
 * colour). Otherwise null, and the wall shows the moment's reason alone.
 * Letters and verdict words only: never a score.
 */
export function momentDetailFrom(m: {
  conflict: string | null;
  labelExpected?: string | null;
  judge: { aspects?: { label: PartReading; logo: PartReading; shape: PartReading; colour: PartReading } } | null;
}): MomentDetail | null {
  const read = typeof m.conflict === "string" ? m.conflict.trim().slice(0, 80) : "";
  const expected = typeof m.labelExpected === "string" ? m.labelExpected.trim().slice(0, 80) : "";
  const parts = m.judge?.aspects;
  if (!read || !expected || !parts) return null;
  const word = (p: PartReading): Verdict | null => (Object.prototype.hasOwnProperty.call(PART_WORD, p) ? PART_WORD[p] : null);
  const [label, logo, shape, colour] = [word(parts.label), word(parts.logo), word(parts.shape), word(parts.colour)];
  if (!label || !logo || !shape || !colour) return null;
  return { read, expected, label, logo, shape, colour };
}

/** One moment's face word from the identity scorer's number, by face-lock's rule (a bar of 0 is "off": not checked). */
export function momentFace(score: number | null, threshold: number, star: boolean): Verdict {
  if (!star) return "no_one_in_shot";
  if (score === null || !(threshold > 0)) return "not_checked";
  return score >= threshold ? "match" : "didnt_match";
}

/**
 * The bottom corner the tag sits in: the one farther from the product in
 * every moment it was found (boxes are shares of the frame). Bottom-left
 * when nothing was found or both are equally clear (design A).
 */
export function tagCornerFor(boxes: readonly ({ x: number; y: number; w: number; h: number } | null)[]): TagCorner {
  const zone = (corner: TagCorner) => ({ x0: corner === "left" ? 0 : 0.6, x1: corner === "left" ? 0.4 : 1, y0: 0.8, y1: 1 });
  const overlap = (corner: TagCorner) => {
    const z = zone(corner);
    return boxes.reduce((sum, b) => {
      if (!b) return sum;
      const w = Math.max(0, Math.min(z.x1, b.x + b.w) - Math.max(z.x0, b.x));
      const h = Math.max(0, Math.min(z.y1, b.y + b.h) - Math.max(z.y0, b.y));
      return sum + w * h;
    }, 0);
  };
  return overlap("right") < overlap("left") ? "right" : "left";
}

// ---------------------------------------------------------------------------
// What the door is shown (no lane, cost, row id or raw score: synthesis #30)
// ---------------------------------------------------------------------------

function takeState(t: Take): TakeState {
  if (t.status === "reserved" || t.status === "filming") return "filming";
  if (t.status === "filmed") return "checking";
  return t.status === "checked" ? "checked" : "failed";
}

export function takeView(t: Take, ctx: ShotContext, videoUrl: (stored: string) => string | null): TakeView {
  const checked = t.status === "checked";
  const face: Verdict = checked ? (ctx.star ? t.face : "no_one_in_shot") : ctx.star ? "not_checked" : "no_one_in_shot";
  const product: Verdict = checked ? t.product : "not_checked";
  const worst = checked ? takeWorst(t, ctx) : "not_checked";
  return {
    take: t.n,
    state: takeState(t),
    videoUrl: t.video && t.status !== "failed" ? videoUrl(t.video) : null,
    moments: checked ? t.moments.map((m) => ({ ...m })) : [],
    worst,
    face,
    product,
    reason: checked ? t.reason : null,
  };
}

/** Every planned shot as the press wall shows it, in shot order. */
export function shotViews(
  planned: readonly { shot: number; role: ShotRole; productExpected: boolean; star: boolean }[],
  shots: readonly ShotState[],
  opts: { videoUrl: (stored: string) => string | null; refilmCredits: (shot: number) => number },
): ShotView[] {
  if (!filmed(shots)) return [];
  return planned.map((p) => {
    const ctx: ShotContext = { productExpected: p.productExpected, star: p.star };
    const s = shotOf(shots, p.shot) ?? { shot: p.shot, takes: [], chosen: null, decision: "pending" as const };
    const chosen = chosenTake(s, ctx);
    return {
      shot: p.shot,
      role: p.role,
      takes: s.takes.map((t) => takeView(t, ctx, opts.videoUrl)),
      chosenTake: s.decision === "cut" ? null : (chosen?.n ?? null),
      decision: s.decision,
      needsDecision: needsDecision(s, ctx),
      productExpected: p.productExpected,
      refilmCredits: opts.refilmCredits(p.shot),
      canRefilm: canRefilm(s),
    };
  });
}
