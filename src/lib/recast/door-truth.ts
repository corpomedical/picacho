// What the door may say (2026-09-22, "We've done enough testing on Recast,
// its time we put this thing to shame the competitors."). Pure, client-safe
// and alias-free: the door draws with it, data.ts reads rows through it,
// door-truth.test.ts pins it.
//
// WHY ONE FILE. Every line the page says about time, money and what a take
// did was written on its own, in its own place, and they drifted apart: the
// header said "3–20 minutes" while the long-take line on the same page said
// 35; a stopped take read "Didn't finish" like a failure; a failed one said
// nothing about why or whether it was charged. Each answer here is computed
// once, from the same rules the server runs on, so two places on the page
// cannot disagree.

import { chainMinutes } from "../generations/chain";
import { isRawProviderError } from "../generations/user-facing-error";
import { RECAST_ENGINES, recastLumaDuration, recastRestageSeconds, type RecastEngine } from "./recast";

// ---------------------------------------------------------------------------
// HOW LONG A TAKE TAKES
//
// One estimate, used by the header, the price line, the long-take line and
// every rendering card. From renders we have actually timed — few of them,
// which is why every place that shows one says "about":
//
//   Into the clip   Kling O3 Edit Pro: 5.5 s in 389 s, 10 s in 559 s, 12 s in
//                   601 s, 14.4 s in 718 s, one 15 s piece in 1,182 s. That is
//                   chain.ts's rule — about a minute a rendered second, the
//                   re-rendered second of each later part included — so a
//                   take in one piece and a take in parts are timed the same
//                   way (chainMinutes).
//   Photo to life   Kling V3 Motion Control Pro: 3 s in 152 s (recast.ts), so
//                   about 51 s of waiting per second of clip.
//   Restyle         Luma Ray 3.2: 3 s in 153 s, billed and rendered as a 5 s
//                   slot, so about 31 s of waiting per second of slot.
//   Restage         MiniMax H3: 5 s in 31 s. Its output is 5–15 whole
//                   seconds whatever the window (recastRestageSeconds).
//
// A floor of three minutes on the fast ones: a queue at the provider costs
// minutes that no render time shows, and "about 1 min" that turns into four
// would be the same broken promise the flat "3–20 min" was.

const WAIT_SECONDS_PER_SECOND = { motion: 152 / 3, world: 153 / 5, restage: 31 / 5 } as const;
const FLOOR_MINUTES = 3;

/** About how many minutes a take on this engine and window waits, start to finish. */
export function recastMinutes(engine: RecastEngine, seconds: number): number {
  const spec = RECAST_ENGINES[engine];
  const length = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  if (spec.job === "scene") return chainMinutes(length);
  const rendered = spec.restages
    ? recastRestageSeconds(length) * WAIT_SECONDS_PER_SECOND.restage
    : spec.billedBy === "bucket"
      ? (recastLumaDuration({ seconds: length }) === "10s" ? 10 : 5) * WAIT_SECONDS_PER_SECOND.world
      : length * WAIT_SECONDS_PER_SECOND.motion;
  return Math.max(FLOOR_MINUTES, Math.ceil(rendered / 60));
}

export type RecastWait = {
  /** Whole minutes since the press. */
  elapsed: number;
  /** About how many minutes are left, never under one; null when the take's engine or length is unknown. */
  left: number | null;
  /** Past the estimate: said as "taking longer than usual", never as a negative count. */
  late: boolean;
};

/**
 * Where a rendering take stands against its estimate. Counted from the
 * take's own created_at, so a reload, a second tab and the phone all say the
 * same thing.
 */
export function recastWait(take: { engine: RecastEngine | null; seconds: number | null; createdAt: string }, now: number): RecastWait {
  const started = Date.parse(take.createdAt);
  const minutesIn = Number.isFinite(started) ? Math.max(0, (now - started) / 60_000) : 0;
  const elapsed = Math.floor(minutesIn);
  if (!take.engine || take.seconds === null) return { elapsed, left: null, late: false };
  const estimate = recastMinutes(take.engine, take.seconds);
  if (minutesIn > estimate) return { elapsed, left: null, late: true };
  return { elapsed, left: Math.max(1, Math.ceil(estimate - minutesIn)), late: false };
}

// ---------------------------------------------------------------------------
// WHAT A FINISHED ROW SAYS
//
// A take's story is its pipeline_log: attempts, each a list of steps with a
// detail line (job-runner.ts appendStep). The door reads two things back
// from it, and nothing else — the log also holds raw provider replies, which
// never reach a person (lib/generations/user-facing-error.ts).

/** The runner's own words for a take the person stopped (job-runner.ts, the cancel path). */
export const RECAST_STOPPED_STEP = "Stopped.";

type Step = { step?: unknown; detail?: unknown; report?: unknown };

function stepsOf(pipelineLog: unknown): Step[] {
  if (!Array.isArray(pipelineLog)) return [];
  const out: Step[] = [];
  for (const attempt of pipelineLog) {
    const steps = (attempt as { steps?: unknown } | null)?.steps;
    if (!Array.isArray(steps)) continue;
    for (const s of steps) if (s && typeof s === "object") out.push(s as Step);
  }
  return out;
}

export type RecastTakeOutcome = {
  /** The person pressed Stop — not a failure, and not said as one. */
  stopped: boolean;
  /**
   * Why it did not finish, as the server said it (English on the wire; the
   * door translates it with localizeServerText). Null when the last word was
   * a raw provider reply, which is never shown — the door says its own
   * generic line instead.
   */
  reason: string | null;
  /** Whether the take's credits were kept. A refund zeroes credits_used (refundGenerationCosts). */
  charged: boolean;
};

/** How a take that did not deliver ended: stopped or failed, why, and whether it cost anything. */
export function recastTakeOutcome(row: { credits_used: number | null; pipeline_log: unknown }): RecastTakeOutcome {
  const details = stepsOf(row.pipeline_log)
    .map((s) => s.detail)
    .filter((d): d is string => typeof d === "string" && d.trim().length > 0);
  const last = details[details.length - 1] ?? null;
  const stopped = last === RECAST_STOPPED_STEP;
  return {
    stopped,
    reason: stopped || last === null || isRawProviderError(last) ? null : last,
    // NULL counts as charged, the way the monthly sum counts it (core.ts).
    charged: row.credits_used !== 0,
  };
}

/**
 * THE TAKE REPORT (the runner lane writes it, 2026-09-22): one step
 *   { step: "take-report", report: { faces: [{ characterId, name, lowest, scores }] } }
 * on a recast take's log — every cast character's face scored at several
 * moments, and the lowest of them. The LAST such step is the take's. No
 * verdict is drawn from it here: a threshold is not decided, so the door
 * shows the number and how many moments it is the lowest of.
 */
export type RecastFaceReport = { characterId: string; name: string; lowest: number; scores: number[] };
export type RecastTakeReport = { faces: RecastFaceReport[] };

export function recastTakeReport(pipelineLog: unknown): RecastTakeReport | null {
  const steps = stepsOf(pipelineLog).filter((s) => s.step === "take-report");
  const raw = steps[steps.length - 1]?.report as { faces?: unknown } | undefined;
  if (!raw || !Array.isArray(raw.faces)) return null;
  const faces: RecastFaceReport[] = [];
  for (const f of raw.faces) {
    const face = f as Partial<Record<keyof RecastFaceReport, unknown>> | null;
    if (!face || typeof face.characterId !== "string" || typeof face.name !== "string") continue;
    if (typeof face.lowest !== "number" || !Number.isFinite(face.lowest)) continue;
    const scores = Array.isArray(face.scores) ? face.scores.filter((n): n is number => typeof n === "number" && Number.isFinite(n)) : [];
    faces.push({ characterId: face.characterId, name: face.name, lowest: face.lowest, scores });
  }
  return faces.length > 0 ? { faces } : null;
}
