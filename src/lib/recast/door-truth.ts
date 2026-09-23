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

import { CHAIN_FPS, CHAIN_PIECE_MAX_FRAMES, chainMinutes, chainPieceCount } from "../generations/chain";
import { isRawProviderError } from "../generations/user-facing-error";
import { PLAN_LIMITS, type PlanId } from "../plans";
import type { RecastRead } from "./recast-read";
import {
  RECAST_ENGINES,
  RECAST_JOB_MAX_SECONDS,
  RECAST_MIN_SECONDS,
  RECAST_MIN_SIDE_PX,
  recastClipProblem,
  recastCrowdSharesTake,
  recastEnginesOf,
  recastLumaDuration,
  recastRestageSeconds,
  type RecastClip,
  type RecastEngine,
  type RecastJob,
} from "./recast";
import { clampRecastWindow, recastWindowCredits, type RecastWindow } from "./trim";

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
  /**
   * The engine itself answered with a refusal (a raw provider reply was its
   * last word) — so the card can say the engine turned it down, instead of a
   * generic "try again in a moment" that sent the operator looking for a
   * failure that was two days old (2026-09-22).
   */
  refused: boolean;
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
    refused: !stopped && last !== null && isRawProviderError(last),
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

// ---------------------------------------------------------------------------
// WHAT EACH JOB KEEPS AND CHANGES
//
// The page promised "the acting, the timing and the sound stay" over every
// job, while Restage and Restyle come back silent (recast.ts keepsSound:
// false). Each job card now says what it keeps and what it changes, and the
// row is DERIVED from the engines' own flags rather than written beside
// them, so a flag that changes changes the promise with it:
//
//   the moves    kept, unless an engine of the job restages (the clip is then
//                a reference and its performance is not kept)
//   the sound    kept only when EVERY engine the job offers keeps it
//   the camera   restaged → yours to direct; Photo to life → not promised
//                (the frame is built from the picture); otherwise kept
//   the place    Photo to life → from your picture; Restyle → redrawn
//   who is in it Restyle redraws everyone; every other job puts in whoever
//                you choose
export type RecastAspect = "moves" | "sound" | "camera" | "place" | "picturePlace" | "cast" | "everyone";
export type RecastPromise = { keeps: RecastAspect[]; changes: RecastAspect[]; silent: boolean };

export function recastJobPromise(job: RecastJob): RecastPromise {
  const engines = recastEnginesOf(job);
  const restages = engines.some((e) => RECAST_ENGINES[e].restages === true);
  const sound = engines.length > 0 && engines.every((e) => RECAST_ENGINES[e].keepsSound);
  const keeps: RecastAspect[] = [];
  const changes: RecastAspect[] = [];
  (restages ? changes : keeps).push("moves");
  if (sound) keeps.push("sound");
  if (restages) changes.push("camera");
  else if (job !== "motion") keeps.push("camera");
  if (job === "motion") changes.push("picturePlace");
  else if (job === "world") changes.push("place");
  else keeps.push("place");
  changes.push(job === "world" ? "everyone" : "cast");
  return { keeps, changes, silent: !sound };
}

// ---------------------------------------------------------------------------
// A GROUP, AND WHAT THE DOOR SAYS ABOUT IT
//
// Two rules about casting a character over a whole group, and the door may
// only ever say one of them at a time:
//
//   own take   a group cast beside somebody else the take also replaces. Wrong
//              at ANY length (recast.ts recastCrowdSharesTake, measured), so it
//              is said first and the other steps aside — the trim the other
//              offers would not save a take that asks for two changes at once.
//   one part   a group on a take long enough to be rendered in pieces: every
//              piece after the first is handed the footage again and follows
//              it (2026-09-20). A trim answers it.
//
// Said here rather than in the page so the two boxes cannot both appear, and
// so the order matches the order the server refuses them in (actions.ts).

export type RecastCrowdState = {
  job: RecastJob;
  /** The person each character in THIS take is shown playing; null where the words give them their part. */
  takeTags: readonly (string | null)[];
  /** The tags the read marked as several people. */
  groupTags: ReadonlySet<string>;
  /** The pieces this window is rendered in — 1 unless the engine chains (chain.ts). */
  parts: number;
};

export function recastCrowdWarning(s: RecastCrowdState): "own-take" | "one-part" | null {
  if (recastCrowdSharesTake(s.job, s.takeTags, s.groupTags)) return "own-take";
  const castOverGroup = s.takeTags.some((tag) => tag !== null && s.groupTags.has(tag));
  return castOverGroup && s.parts > 1 ? "one-part" : null;
}

// ---------------------------------------------------------------------------
// A WAY OUT THAT CHANGES NOTHING ELSE
//
// The warning above offers two presses — the group on a take of its own, or
// the group out of this take — and neither may quietly change what the person
// asked for. That is not free. The door falls back on the read's own order for
// a character with no role of its own, and on the read's LEAD for a lone
// character, so a press that only shortens the cast hands the survivor
// somebody else's part: pressing "Cast only Eva" over a class took Eva off the
// forty boys and put her on the man in front of them, and Take went green on a
// take nobody had asked for (2026-09-23).
//
// So a press says in full what the cast becomes — who is in it, the person
// each of them keeps playing, and, when one is left, that one's person, which
// the door holds in a field of its own.

export type RecastCastMember = { id: string; tag: string | null };
export type RecastCastChange = {
  /** Who is cast afterwards, in the order they were shown in. */
  ids: string[];
  /** The person each of them keeps playing, to merge into the door's roles. */
  roles: Record<string, string | null>;
  /** The lone character's person, or null where more than one is left and the roles above are what the take sends. */
  solo: { tag: string | null } | null;
};

export function recastCastKeeping(cast: readonly RecastCastMember[], staying: ReadonlySet<string>): RecastCastChange {
  const kept = cast.filter((c) => staying.has(c.id));
  const roles: Record<string, string | null> = {};
  for (const c of kept) roles[c.id] = c.tag;
  return { ids: kept.map((c) => c.id), roles, solo: kept.length === 1 ? { tag: kept[0].tag } : null };
}

// ---------------------------------------------------------------------------
// WHY TAKE IS GREY
//
// The button used to go grey on any of nine conditions and explain one of
// them. recastBlocker names the FIRST thing missing, in the order a person
// meets them on the page — a clip, the rights tick, someone or something to
// put in it (or words), images still uploading, a group cast beside somebody
// else, a group that needs one part, credits — and Take is enabled exactly
// when there is nothing to name.

export type RecastBalance = { left: number; unlimited: boolean };

export type RecastDoorState = {
  starting: boolean;
  /** none: no clip chosen · busy: uploading or being read · ready: read and priced. */
  clip: "none" | "busy" | "ready";
  rights: boolean;
  job: RecastJob;
  /** recastMissing's answer for who or what is cast. */
  missing: "words" | "picture" | null;
  /** Together, someone plays nobody in the clip and no words say who. */
  rolesUnsaid: boolean;
  hasWords: boolean;
  /** The number (from 1) of the first added image still uploading, or 0. */
  imageUploading: number;
  /** A whole group is cast, and somebody else in the same take (2026-09-23). */
  crowdSharesTake: boolean;
  groupNeedsOnePart: boolean;
  /** What the press costs in all, once the clip is priced. */
  credits: number | null;
  /** What the person has left, when it could be read. */
  balance: RecastBalance | null;
};

export type RecastBlocker =
  | { kind: "starting" }
  | { kind: "clip" }
  | { kind: "reading" }
  | { kind: "rights" }
  | { kind: "words"; why: "change" | "roles" | "look" }
  | { kind: "picture" }
  | { kind: "image"; n: number }
  | { kind: "crowd" }
  | { kind: "group" }
  | { kind: "credits"; need: number; left: number };

export function recastBlocker(s: RecastDoorState): RecastBlocker | null {
  if (s.starting) return { kind: "starting" };
  if (s.clip === "none") return { kind: "clip" };
  if (s.clip === "busy") return { kind: "reading" };
  if (!s.rights) return { kind: "rights" };
  if (s.missing === "words") return { kind: "words", why: "change" };
  if (s.missing === "picture") return { kind: "picture" };
  if (s.rolesUnsaid) return { kind: "words", why: "roles" };
  // Restyle's look is words, and the page asks for them — its placeholder
  // reads like a filled-in default and is not one.
  if (s.job === "world" && !s.hasWords) return { kind: "words", why: "look" };
  if (s.imageUploading > 0) return { kind: "image", n: s.imageUploading };
  // A group cast beside somebody else is wrong at ANY length, so it is named
  // before the one below, which the trim can answer (2026-09-23).
  if (s.crowdSharesTake) return { kind: "crowd" };
  if (s.groupNeedsOnePart) return { kind: "group" };
  if (s.credits !== null && s.balance && !s.balance.unlimited && s.credits > s.balance.left) {
    return { kind: "credits", need: s.credits, left: s.balance.left };
  }
  return null;
}

/**
 * What an account can still spend on a take — checkGenerationAllowance's
 * arithmetic (core.ts), read the same way: the plan's monthly allowance (only
 * while the subscription is in good standing), less what this period used,
 * plus the two depleting balances — bonus and purchased. The free daily slot never covers
 * a recast (actions.ts), so it is not counted. Admins are never refused.
 */
export function recastCreditsLeft(p: {
  isAdmin: boolean;
  plan: string | null;
  planStatus: string | null;
  bonus: number;
  purchased: number;
  used: number;
}): RecastBalance {
  if (p.isAdmin) return { left: 0, unlimited: true };
  const active = p.planStatus === null || p.planStatus === "active";
  const limit = active ? (PLAN_LIMITS[(p.plan ?? "none") as PlanId] ?? 0) : 0;
  return {
    left:
      Math.max(0, limit - Math.max(0, p.used)) + Math.max(0, p.bonus) + Math.max(0, p.purchased),
    unlimited: false,
  };
}

// ---------------------------------------------------------------------------
// LENGTHS THAT COST WHAT THEY SAY

/**
 * The shortest window a job is offered. Restage renders at least its own
 * shortest take whatever it is given (recastRestageSeconds), so a 3 s trim
 * cost and came back as 5 s; its slider now starts there — or at the whole
 * clip when the clip is shorter, which the door then says comes back as 5 s.
 */
export function recastLengthFloor(job: RecastJob, clipSeconds: number): number {
  const floor = job === "restage" ? recastRestageSeconds(0) : RECAST_MIN_SECONDS;
  return Math.min(floor, clipSeconds);
}

/** A window inside the job's rules (trim.ts), never under its floor, keeping the chosen start where it can. */
export function recastFitWindow(window: RecastWindow, clipSeconds: number, job: RecastJob): RecastWindow {
  const w = clampRecastWindow(window, clipSeconds, job);
  const floor = recastLengthFloor(job, clipSeconds);
  if (w.end - w.start >= floor - 0.05) return w;
  const start = Math.max(0, Math.min(w.start, clipSeconds - floor));
  return { start: Math.round(start * 10) / 10, end: Math.round((start + floor) * 10) / 10 };
}

/**
 * RESTYLE IS BILLED IN SLOTS (Luma: a 5 s or a 10 s slot, recastLumaDuration).
 * A 5.2 s window was charged the 10 s slot with nothing said. Anywhere past
 * 5 s and short of the whole slot, the door offers both ends: cut to 5 s at
 * the small slot's price, or use the whole 10 s (as much of it as the clip
 * has) at the price already being charged. Every price is the door's own
 * pricing call, recastWindowCredits — no second formula.
 */
export type RecastSlotOffer = {
  /** What the window as it stands costs. */
  credits: number;
  cut: { window: RecastWindow; credits: number };
  /** Null when the clip has no more to give. */
  full: { window: RecastWindow; seconds: number; credits: number } | null;
};

const SMALL_SLOT = 5;
const LARGE_SLOT = 10;

export function recastSlotOffer(
  engine: RecastEngine,
  clip: Pick<RecastClip, "seconds" | "frames">,
  window: RecastWindow,
): RecastSlotOffer | null {
  if (RECAST_ENGINES[engine].billedBy !== "bucket") return null;
  const length = window.end - window.start;
  if (recastLumaDuration({ seconds: length }) !== "10s" || length >= LARGE_SLOT - 0.05) return null;
  const tenth = (v: number) => Math.round(v * 10) / 10;
  const cutStart = tenth(Math.max(0, Math.min(window.start, clip.seconds - SMALL_SLOT)));
  const cut = { start: cutStart, end: tenth(cutStart + SMALL_SLOT) };
  const fullSeconds = tenth(Math.min(LARGE_SLOT, clip.seconds));
  const fullStart = tenth(Math.max(0, Math.min(window.start, clip.seconds - fullSeconds)));
  const fullWindow = { start: fullStart, end: tenth(fullStart + fullSeconds) };
  return {
    credits: recastWindowCredits(engine, clip, window),
    cut: { window: cut, credits: recastWindowCredits(engine, clip, cut) },
    full:
      fullSeconds > length + 0.05
        ? { window: fullWindow, seconds: fullSeconds, credits: recastWindowCredits(engine, clip, fullWindow) }
        : null,
  };
}

// ---------------------------------------------------------------------------
// A LENGTH THE SERVER WILL REFUSE, SAID BEFORE THE UPLOAD
//
// The browser reads a file's length before a byte is uploaded
// (recast-client.ts probeLocal). A clip plainly outside the server's own
// limits — recastClipProblem, the very rule inspectRecastClip refuses with —
// is refused there and then, with the server's own sentence, instead of
// after a full upload. "Plainly": the browser's length and ffprobe's can
// differ by a fraction of a second (an audio track that runs on, a rounded
// container), so only a clip past the limit by more than half a second is
// refused here. Anything closer, and anything the browser could not read,
// goes to the server exactly as before; it stays the judge.

const LOCAL_LENGTH_MARGIN = 0.5;

export function recastLocalLengthProblem(seconds: number): "too-short" | "too-long" | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const at = (s: number) => recastClipProblem({ seconds: s, frames: null, width: RECAST_MIN_SIDE_PX, height: RECAST_MIN_SIDE_PX, bytes: 1 });
  if (at(seconds - LOCAL_LENGTH_MARGIN) === "too-long") return "too-long";
  if (at(seconds + LOCAL_LENGTH_MARGIN) === "too-short") return "too-short";
  return null;
}

// ---------------------------------------------------------------------------
// WHICH JOB SUITS THIS CLIP (advisory)
//
// A quiet mark on one job card — never a switch: the job is only ever the
// person's choice (2026-09-18, after a 28 s crowd scene was moved to Photo to
// life and came back as a room of cloned children). The table reads only the
// clip read's own fields — how many people, the framing, the cuts, the sound,
// whether a head is in view, how long — and counts, for each job, the limits
// this clip would run into, the ones the door already warns about:
//
//   Into the clip   several people (one is replaced among them), a wide shot
//                   (few pixels for a face), cuts (the joins wander), no head
//                   in view, and a take long enough to be made in parts
//   Photo to life   ruled out when the clip holds nobody to perform, or more
//                   than one person, or a full or wide view — everything that
//                   is not the performer gets invented (the door's own
//                   motionWillInvent rule); otherwise cuts and no head count,
//                   and it takes 30 s in one piece
//   Restyle         someone speaking (it comes back silent), and a clip longer
//                   than its 10 s
//
// The fewest wins; a tie goes to the job that keeps the most of the clip.
// Restage is never suggested: it rebuilds the clip rather than keeping it,
// and has not yet been proved on a real take. An unsure read suggests nothing.

export function recastSuggestJob(read: RecastRead | null, clipSeconds: number): RecastJob | null {
  if (!read || read.confidence === "low") return null;
  const people = read.people.length;
  const several = people > 1 || read.people.some((p) => p.many);
  const cuts = read.cuts.length > 0 ? 1 : 0;
  const noHead = people > 0 && !read.headVisible ? 1 : 0;
  const inParts = chainPieceCount(Math.min(clipSeconds, RECAST_JOB_MAX_SECONDS.scene)) > 1 ? 1 : 0;
  const misses: Record<"scene" | "motion" | "world", number> = {
    scene: (several ? 1 : 0) + (read.framing === "wide" ? 1 : 0) + cuts + noHead + inParts,
    motion: people === 0 || several || read.framing === "full" || read.framing === "wide" ? Infinity : cuts + noHead,
    world: (read.sound === "speech" ? 1 : 0) + (clipSeconds > RECAST_JOB_MAX_SECONDS.world + 0.05 ? 1 : 0),
  };
  let best: "scene" | "motion" | "world" = "scene";
  for (const job of ["scene", "motion", "world"] as const) if (misses[job] < misses[best]) best = job;
  return best;
}

// ---------------------------------------------------------------------------
// QUALITY THAT SAYS WHAT IT TRADES

const RESOLUTION_LINES: Record<NonNullable<(typeof RECAST_ENGINES)[RecastEngine]["resolution"]>, number> = {
  "480p": 480,
  "540p": 540,
  "720p": 720,
};

/**
 * Whether this engine's picture is smaller than its job's Full one — read
 * from the two engines' own resolutions, so "Lighter" says it is softer only
 * where it is. Photo to life's two engines carry no resolution, so nothing
 * is claimed for them beyond the price.
 */
export function recastTierIsSofter(engine: RecastEngine): boolean {
  const spec = RECAST_ENGINES[engine];
  if (spec.tier !== "lite" || !spec.resolution) return false;
  const full = recastEnginesOf(spec.job).find((e) => RECAST_ENGINES[e].tier === "full");
  const fullResolution = full ? RECAST_ENGINES[full].resolution : undefined;
  return fullResolution !== undefined && RESOLUTION_LINES[spec.resolution] < RESOLUTION_LINES[fullResolution];
}

// ---------------------------------------------------------------------------
// ONE PIECE, OR ALL OF IT
//
// Past 15 s Into the clip is made in parts (chain.ts), which costs more, waits
// longer and joins. On such a clip the door puts both lengths side by side
// with their prices and waits — "15 s · 9 credits · about 15 min · one piece"
// and "All 28 s · 19 credits · about 30 min · 2 parts". It never chooses for
// the person: the page still opens on the whole clip up to 30 s, the
// operator's call. Prices are recastWindowCredits; times are recastMinutes.

export type RecastLengthChoice = { window: RecastWindow; seconds: number; credits: number; minutes: number; parts: number };

export function recastLengthChoices(
  engine: RecastEngine,
  clip: Pick<RecastClip, "seconds" | "frames">,
  window: RecastWindow,
  references = 0,
): { one: RecastLengthChoice; all: RecastLengthChoice } | null {
  const spec = RECAST_ENGINES[engine];
  if (!spec.chains) return null;
  const tenth = (v: number) => Math.round(v * 10) / 10;
  const allSeconds = tenth(Math.min(clip.seconds, RECAST_JOB_MAX_SECONDS[spec.job]));
  if (chainPieceCount(allSeconds) <= 1) return null;
  const pieceSeconds = Math.floor(CHAIN_PIECE_MAX_FRAMES / CHAIN_FPS);
  const choice = (seconds: number): RecastLengthChoice => {
    const start = tenth(Math.max(0, Math.min(window.start, clip.seconds - seconds)));
    const w = { start, end: tenth(start + seconds) };
    return {
      window: w,
      seconds,
      credits: recastWindowCredits(engine, clip, w, references),
      minutes: recastMinutes(engine, seconds),
      parts: chainPieceCount(seconds),
    };
  };
  return { one: choice(pieceSeconds), all: choice(allSeconds) };
}
