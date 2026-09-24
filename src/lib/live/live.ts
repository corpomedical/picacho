// LIVE (2026-09-24): MiniMax H3 Max Director on fal — a take that streams to
// the browser while the person keeps typing directions into it. Operator:
// "Do we have H3 max director on our engines selection?" … "build it", with
// his decisions the same day: it lives in the Projector menu AND in Helios, a
// take is a LENGTH picked and paid for up front with the unused seconds
// refunded when it stops, and — once the review showed a live take's words
// travel browser → fal where no server can read them — admins first, every
// paid plan behind the `live_paid_plans` switch (enabled.ts).
//
// Everything in this file is pure — prices, the relay's allow-list, and the
// settlement arithmetic — so the rules that move money are tested without a
// network, a database or a browser.
//
// HOW fal's realtime client talks to fal (read in @fal-ai/client
// 1.11.0-alpha.3, src/realtime/wma.js, pinned exactly in package.json): three
// HTTPS calls to the WMA bridge, each carrying `Authorization: Key <FAL_KEY>`
// — the full account key, not a scoped token — so a browser can only make
// them through a server that adds the key. That server is our relay
// (app/api/live/relay), and it forwards exactly these three and nothing else:
//
//   POST https://wma.fal.run/ice               { app_id }       TURN credentials
//   POST https://wma.fal.run/session           { app_id, sdp }  opens the take
//   POST https://wma.fal.run/session/heartbeat { session_id }   every 5 s, keeps it
//
// The media and the direction messages then go peer to peer between the
// browser and fal's runner; they never pass through us. The heartbeat is the
// one call that must keep coming back to us for the take to stay alive, so it
// is also our METER: the relay refuses it once the lease it would buy runs
// past the paid length, and fal's client gives the lease up after three
// refusals in a row.
//
// The client also has a fallback that RUNS the model endpoint itself
// (`${endpoint}/ice` through fal.run) when the bridge's /ice fails. The relay
// refuses it on purpose: running a model endpoint is the one call here that
// could start a billed job we never reserved for, and without it the client
// falls back to plain STUN, which is what it does anyway when /ice is down.

export const LIVE_ENDPOINT = "minimax/h3-max/director";

/** The generations row's model_id for a live take — what picks the lane out everywhere else. */
export const LIVE_MODEL_ID = "live-h3-director";
export const LIVE_LABEL = "MiniMax H3 Max Director (live)";

/**
 * The row's `live` column (supabase/pending/live.sql). Times are epoch
 * milliseconds, written only by the server: the relay stamps the session and
 * the heartbeats, the settlement stamps the end. Nothing the browser says is
 * a time.
 */
export type LiveMeter = {
  v: 1;
  paidSeconds: LiveLength;
  paidCredits: number;
  resolution: LiveResolution;
  aspect: LiveAspect;
  /** The generation a Helios still came from, when the take opened on one. */
  from: string | null;
  /** Whether the take opened on a picture — a character's photo or a still. Directions are then judged in the strict lane. */
  withImage: boolean;
  openingAt: number | null;
  sessionId: string | null;
  startedAt: number | null;
  lastBeatAt: number | null;
  settledAt: number | null;
  usedSeconds: number | null;
  refunded: number | null;
  /** Every direction given during the take, in order — shown in History. */
  directions: string[];
};

export function newLiveMeter(input: {
  paidSeconds: LiveLength;
  resolution: LiveResolution;
  aspect: LiveAspect;
  from: string | null;
  withImage: boolean;
}): LiveMeter {
  return {
    v: 1,
    paidSeconds: input.paidSeconds,
    paidCredits: liveCreditsFor(input.paidSeconds),
    resolution: input.resolution,
    aspect: input.aspect,
    from: input.from,
    withImage: input.withImage,
    openingAt: null,
    sessionId: null,
    startedAt: null,
    lastBeatAt: null,
    settledAt: null,
    usedSeconds: null,
    refunded: null,
    directions: [],
  };
}

/** Reads the column back, or null when it is not a live take's. */
export function readLiveMeter(value: unknown): LiveMeter | null {
  if (!value || typeof value !== "object") return null;
  const m = value as Partial<LiveMeter>;
  if (m.v !== 1 || !isLiveLength(m.paidSeconds) || typeof m.paidCredits !== "number") return null;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  return {
    v: 1,
    paidSeconds: m.paidSeconds,
    paidCredits: m.paidCredits,
    resolution: (LIVE_RESOLUTIONS as readonly string[]).includes(m.resolution as string) ? (m.resolution as LiveResolution) : "768p",
    aspect: (LIVE_ASPECTS as readonly string[]).includes(m.aspect as string) ? (m.aspect as LiveAspect) : "16:9",
    from: typeof m.from === "string" ? m.from : null,
    withImage: m.withImage === true,
    openingAt: num(m.openingAt),
    sessionId: typeof m.sessionId === "string" ? m.sessionId : null,
    startedAt: num(m.startedAt),
    lastBeatAt: num(m.lastBeatAt),
    settledAt: num(m.settledAt),
    usedSeconds: num(m.usedSeconds),
    refunded: num(m.refunded),
    directions: Array.isArray(m.directions) ? m.directions.filter((d): d is string => typeof d === "string") : [],
  };
}

export const LIVE_DIRECTIONS_KEPT = 20;
export const LIVE_DIRECTION_MAX = 300;

/** The directions as History keeps them: the first twenty, each cut to 300 characters. */
export function keptDirections(directions: unknown): string[] {
  if (!Array.isArray(directions)) return [];
  return directions
    .filter((d): d is string => typeof d === "string" && d.trim().length > 0)
    .slice(0, LIVE_DIRECTIONS_KEPT)
    .map((d) => d.trim().slice(0, LIVE_DIRECTION_MAX));
}

/**
 * Where a refund comes back from. The charge was filled monthly first, then
 * bonus, then purchased (checkGenerationAllowance), so the unused top of it
 * unwinds in reverse: purchased credits first, then bonus, and only what is
 * left comes off the month's usage — refundDialogueSurcharge's rule.
 */
export function liveRefundSplit(input: {
  refund: number;
  creditsUsed: number;
  purchasedUsed: number;
  bonusUsed: number;
}): { creditsUsed: number; purchasedUsed: number; bonusUsed: number; purchasedBack: number; bonusBack: number } {
  const refund = Math.max(0, Math.min(input.refund, input.creditsUsed));
  const purchasedBack = Math.min(refund, input.purchasedUsed);
  const bonusBack = Math.min(refund - purchasedBack, input.bonusUsed);
  return {
    creditsUsed: input.creditsUsed - refund,
    purchasedUsed: input.purchasedUsed - purchasedBack,
    bonusUsed: input.bonusUsed - bonusBack,
    purchasedBack,
    bonusBack,
  };
}

// Read at source 2026-09-24 (fal.ai/models/minimax/h3-max/director):
// "list price being $0.08 per second of video" (the $0.02 promotion ended
// 14 September), "Minimum charge per session: $1.20", "Billing is calculated
// per second of video generated, not wall-clock time", "1080p costs 2× the
// standard rate", "Default session length is up to 15 minutes".
export const LIVE_USD_PER_SECOND = 0.08;
export const LIVE_MIN_CHARGE_USD = 1.2;
/** fal's per-session minimum expressed in seconds: $1.20 ÷ $0.08 = 15 s. */
export const LIVE_MIN_BILLED_SECONDS = Math.round(LIVE_MIN_CHARGE_USD / LIVE_USD_PER_SECOND);

/** The house basis every video credit is priced on (video-models.ts COST_BASIS_USD_PER_CREDIT). */
export const LIVE_COST_BASIS_USD_PER_CREDIT = 0.28;

// 1080p is left out: it bills double and every other lane here stops at 768p.
export const LIVE_RESOLUTIONS = ["768p", "480p"] as const;
export type LiveResolution = (typeof LIVE_RESOLUTIONS)[number];

export const LIVE_ASPECTS = ["16:9", "9:16", "1:1"] as const;
export type LiveAspect = (typeof LIVE_ASPECTS)[number];

/** What went wrong, as the page names it in the person's language (t.live.err). */
export type LiveErrorCode =
  | "signedOut"
  | "needsPlan"
  | "notOpen"
  | "suspended"
  | "off"
  | "tooFast"
  | "busy"
  | "noPrompt"
  | "badImage"
  | "refused"
  | "noCredits"
  | "couldntStart"
  | "ended"
  | "recordingFormat"
  | "recordingMissing"
  | "recordingRefused"
  | "recordingUnchecked";

/** The lengths a take can be bought in, in seconds. */
export const LIVE_LENGTHS = [30, 60, 120] as const;
export type LiveLength = (typeof LIVE_LENGTHS)[number];

export function isLiveLength(value: unknown): value is LiveLength {
  return typeof value === "number" && (LIVE_LENGTHS as readonly number[]).includes(value);
}

/**
 * Credits for a number of seconds: fal's cost over the house basis, rounded up
 * — the catalogue's own rule. 30 s = $2.40 → 9, 60 s = $4.80 → 18,
 * 120 s = $9.60 → 35. Never under fal's own per-session minimum.
 */
export function liveCreditsFor(seconds: number): number {
  const billed = Math.max(LIVE_MIN_BILLED_SECONDS, Math.ceil(seconds));
  // The epsilon keeps a cost of exactly N bases at N credits in floating point.
  return Math.ceil((billed * LIVE_USD_PER_SECOND) / LIVE_COST_BASIS_USD_PER_CREDIT - 1e-9);
}

// ---------------------------------------------------------------------------
// The meter

/** fal's client beats every 5 s (HEARTBEAT_INTERVAL_MS in wma.js). */
export const LIVE_HEARTBEAT_INTERVAL_SECONDS = 5;

/**
 * Whether a heartbeat arriving `now` still belongs to the paid take. Each
 * forwarded beat buys the lease one more interval, so the last one forwarded
 * is the one whose lease ends AT the paid length — never past it (review,
 * 2026-09-24: a 10 s grace plus the lease let a take run ~15 s unpaid).
 */
export function heartbeatAllowed(startedAtMs: number, paidSeconds: number, nowMs: number): boolean {
  return nowMs - startedAtMs <= (paidSeconds - LIVE_HEARTBEAT_INTERVAL_SECONDS) * 1000;
}

/**
 * How long the relay may wait on fal's /session (its fetch timeout), and the
 * browser a little longer, so the browser never gives up on a session the
 * relay is still about to open.
 */
export const LIVE_OPEN_TIMEOUT_MS = 100_000;
export const LIVE_CLIENT_OPEN_TIMEOUT_MS = 110_000;

/**
 * The seconds a take is charged for when it settles. Measured by US, never by
 * the browser: from the moment fal answered /session to the last heartbeat we
 * forwarded plus one beat interval (the lease that beat bought) — or to the
 * moment the person pressed Stop, when that came first. Wall clock is never
 * less than the video fal made (it streams in real time, and our clock starts
 * after the runner was already acquired), so this can only err in our favour.
 * Capped at what was paid, floored at fal's per-session minimum. A take that
 * never opened a session is charged nothing — unless it settles while its
 * /session is still in flight (openingAt stamped, no answer yet): fal may be
 * opening, and billing, a session at that very moment, so it is charged fal's
 * minimum (review, 2026-09-24: Stop during opening refunded everything while
 * fal still opened a paid session). The relay withholds that answer from the
 * browser once the take is settled, so the minimum is all it can cost.
 */
export function liveUsedSeconds(input: {
  paidSeconds: number;
  startedAtMs: number | null;
  lastBeatAtMs: number | null;
  stoppedAtMs: number | null;
  openingAtMs?: number | null;
}): number {
  const { paidSeconds, startedAtMs, lastBeatAtMs, stoppedAtMs } = input;
  if (startedAtMs === null) return input.openingAtMs != null ? Math.min(paidSeconds, LIVE_MIN_BILLED_SECONDS) : 0;
  const leaseEnd = (lastBeatAtMs ?? startedAtMs) + LIVE_HEARTBEAT_INTERVAL_SECONDS * 1000;
  const end = stoppedAtMs === null ? leaseEnd : Math.min(stoppedAtMs, leaseEnd);
  const seconds = Math.ceil(Math.max(0, end - startedAtMs) / 1000);
  return Math.min(paidSeconds, Math.max(LIVE_MIN_BILLED_SECONDS, seconds));
}

/** Credits handed back when a take settles: what was paid minus the price of what was used. */
export function liveRefundCredits(paidCredits: number, usedSeconds: number): number {
  if (usedSeconds <= 0) return paidCredits;
  return Math.max(0, paidCredits - liveCreditsFor(usedSeconds));
}

/**
 * A take left open (the tab closed, the phone slept) settles by itself once
 * its lease cannot possibly still be running and no /session can still be
 * in flight: the relay's open timeout, the paid length, the three refused
 * beats fal's client needs before it gives up, plus a margin.
 */
export function liveTakeAbandoned(sinceMs: number, paidSeconds: number, nowMs: number): boolean {
  return nowMs - sinceMs > LIVE_OPEN_TIMEOUT_MS + (paidSeconds + 3 * LIVE_HEARTBEAT_INTERVAL_SECONDS + 120) * 1000;
}

/** Whether a /session stamped at `openingAtMs` may still be waiting on fal. */
export function liveOpeningInFlight(openingAtMs: number | null, nowMs: number): boolean {
  return openingAtMs !== null && nowMs - openingAtMs < LIVE_OPEN_TIMEOUT_MS + 10_000;
}

// ---------------------------------------------------------------------------
// The relay's allow-list

const WMA_ORIGIN = "https://wma.fal.run";

export type RelayCall =
  | { kind: "ice" }
  | { kind: "session" }
  | { kind: "heartbeat"; sessionId: string };

/**
 * Reads what the browser asked the relay to forward and says which of the
 * three permitted calls it is — or null, and the relay refuses. The target
 * must be the bridge's exact URL (no query, no other host, no other path),
 * and the body must name THIS app (ice, session) or carry a session id
 * (heartbeat); the relay then checks that id is the take's own.
 */
export function readRelayCall(targetUrl: string | null, method: string, body: unknown): RelayCall | null {
  if (!targetUrl || method.toUpperCase() !== "POST") return null;
  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    return null;
  }
  if (url.origin !== WMA_ORIGIN || url.search !== "" || url.hash !== "" || url.username || url.password) return null;
  if (!body || typeof body !== "object") return null;
  const fields = body as Record<string, unknown>;
  switch (url.pathname) {
    case "/ice":
      return fields.app_id === LIVE_ENDPOINT ? { kind: "ice" } : null;
    case "/session":
      return fields.app_id === LIVE_ENDPOINT && typeof fields.sdp === "string" && fields.sdp.length > 0
        ? { kind: "session" }
        : null;
    case "/session/heartbeat":
      return typeof fields.session_id === "string" && fields.session_id.length > 0
        ? { kind: "heartbeat", sessionId: fields.session_id }
        : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// The opening message

/** fal's prompt ceiling is 50,000 characters; a live direction never needs more than this. */
export const LIVE_PROMPT_MAX = 4000;

export function liveConfigureMessage(input: {
  prompt: string;
  resolution: LiveResolution;
  aspect: LiveAspect;
  imageUrl: string | null;
}) {
  return {
    type: "configure" as const,
    prompt: input.prompt.slice(0, LIVE_PROMPT_MAX),
    prompt_version: 1,
    protocol_version: 1,
    resolution: input.resolution,
    aspect_ratio: input.aspect,
    image_url: input.imageUrl,
  };
}
