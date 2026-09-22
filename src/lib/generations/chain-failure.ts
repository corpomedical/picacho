// How a long take's step fails on our side (chain-run.ts runs the steps), and
// when it stops trying (2026-09-22). Kept apart from chain-run so it can be
// read and tested without the server's imports.

/** A 30 s window at 720p, or a 30 s join at 1080p, encodes in well under this. */
export const ENCODE_TIMEOUT_MS = 180_000;

/**
 * Our side failed in a way another pass can mend — a storage blink, a
 * download that timed out, an encode that died. The runner turns it into its
 * own retry (the job row stays; the webhook, the poll and the reaper come
 * back), never into a failed take: the pieces before it were paid for.
 */
export class ChainRetry extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainRetry";
  }
}

/**
 * Why the encoder failed, in its own words. Not the error's message: that
 * opens with the whole command line, and a join's command filled the log's
 * few hundred characters before ffmpeg's reason began (2026-09-19, two 30 s
 * takes stuck at "Joining the parts" for hours with the reason cut off).
 */
export function encoderFailure(what: string, err: unknown): ChainRetry {
  const e = (err ?? {}) as { code?: unknown; signal?: unknown; killed?: unknown; stderr?: unknown };
  if (typeof e.code === "string") return new ChainRetry(`${what}: the encoder couldn't start (${e.code})`);
  const said = (Buffer.isBuffer(e.stderr) ? e.stderr.toString("utf8") : typeof e.stderr === "string" ? e.stderr : "").trim();
  const how =
    e.killed === true
      ? `stopped after ${ENCODE_TIMEOUT_MS / 1000} s`
      : typeof e.signal === "string"
        ? `killed (${e.signal})`
        : `exit ${typeof e.code === "number" ? e.code : "?"}`;
  // 1,200 from the end: ffmpeg 7 follows the line that says why with six
  // more about threads stopping, and 600 cut the reason off (2026-09-19).
  return new ChainRetry(`${what}: ffmpeg ${how}${said ? `: ${said.slice(-1200)}` : ""}`);
}

// --- NO DEAD ENDS (2026-09-22) ----------------------------------------------
//
// A ChainRetry used to be retried for ever. The count on the job row went up
// and nothing ever read it: the credits stayed held, nothing was delivered,
// and the card said "Joining the parts" for as long as anyone cared to look
// (the first two 30 s takes sat there for about 8 hours on 2026-09-19, until
// the ffmpeg 7 fix). And because the runner rethrows the retry as a
// CriticalWriteError, which the reaper swallowed, the reaper's own 45-minute
// write-off could never fire on a route that carries the encoder — while on a
// route that does NOT carry it (/app/generate) the same take was written off
// as "didn't finish in time" and its paid parts deleted. Which page the person
// happened to open decided what happened to their take.
//
// The rule since 2026-09-22: a step on our side gets
// SIX tries or TWO HOURS from its first failure, whichever comes first, and
// then the take GIVES UP — it is failed with a plain reason and settled
// through the ordinary failure path, exactly as any failed take is settled
// today (fault our_error → the automatic_refunds switch and the daily
// refund cap; no new refund rule, nothing forced past the cap).
//
// Six, not one: a storage blink or a download that timed out mends itself,
// and every part before this one was paid for — throwing them away on the
// first hiccup would be the costlier mistake. Two hours, not a day: a step
// that has failed for two hours is not going to start working on its own,
// and every minute past that is the person's credits held against nothing.

/** How many times a long take's step on our side is tried before the take gives up. */
export const CHAIN_RETRY_LIMIT = 6;

/** How long after a step's FIRST failure the take gives up, however few tries it had. */
export const CHAIN_GIVE_UP_MS = 2 * 60 * 60_000;

/**
 * The failure a long take's job row carries between tries (payload.chainError).
 * `firstAt` arrived 2026-09-22; a row written before it counts from `at`.
 */
export type ChainError = { at: string; firstAt?: string; message: string; count: number };

/** The row's record after one more failed try. `firstAt` is kept from the first failure on. */
export function nextChainError(previous: ChainError | null | undefined, message: string, now: number): ChainError {
  const at = new Date(now).toISOString();
  return {
    at,
    firstAt: previous?.firstAt ?? previous?.at ?? at,
    message: message.slice(0, 1500),
    count: (previous?.count ?? 0) + 1,
  };
}

/** When the first failure happened, as a number — a row from before firstAt counts from `at`. */
function firstFailure(error: Pick<ChainError, "at" | "firstAt">): number {
  const first = Date.parse(error.firstAt ?? error.at);
  return Number.isFinite(first) ? first : NaN;
}

/**
 * True when the take must stop trying: six failures, or two hours since the
 * first. A record whose times cannot be read counts on its tries alone.
 */
export function chainGivesUp(error: Pick<ChainError, "at" | "firstAt" | "count">, now: number): boolean {
  if (error.count >= CHAIN_RETRY_LIMIT) return true;
  const first = firstFailure(error);
  return Number.isFinite(first) && now - first >= CHAIN_GIVE_UP_MS;
}

/**
 * How long to wait after the n-th failure before the next try: a minute,
 * then doubling, never more than half an hour. So the sixth try falls about
 * 31 minutes after the first failure (1 + 2 + 4 + 8 + 16).
 *
 * Why there is a wait at all: every page that shows the take polls it every
 * few seconds, and each poll used to run the whole failing step again — a
 * download and an encode of up to 30 s of 1080p, over and over. With a cap of
 * six, polls a few seconds apart would spend all six inside half a minute and
 * give up on a take a storage blink had only delayed. Spaced, six tries means
 * six real chances over half an hour.
 */
export function chainRetrySpacingMs(count: number): number {
  if (count <= 0) return 0;
  return Math.min(60_000 * 2 ** (count - 1), 30 * 60_000);
}

/** Whether the next try is due — always, when nothing has failed yet. */
export function chainRetryDue(error: Pick<ChainError, "at" | "count"> | null | undefined, now: number): boolean {
  if (!error) return true;
  const last = Date.parse(error.at);
  if (!Number.isFinite(last)) return true;
  return now - last >= chainRetrySpacingMs(error.count);
}

/**
 * What a person reads when a long take gives up. English on the wire, mapped
 * for translation in lib/i18n/server-text.ts. It says nothing about credits
 * on purpose: whether they come back is decided by the ordinary failure path
 * (the automatic_refunds switch and the daily cap), and the push notification
 * and the card say what actually happened rather than what was hoped.
 */
export const CHAIN_GAVE_UP = "This take couldn't be finished: a step on our side kept failing, so we stopped trying.";

/**
 * The issue on the attempt a long take gave up on — for the door to read,
 * rather than matching the sentence above, which may be reworded.
 */
export const CHAIN_GAVE_UP_ISSUE = "chain_gave_up";

/**
 * May the reaper's 45-minute backstop write this job off?
 *
 *   needsEncoder     the job's next step runs the encoder — a long take's
 *                    piece (and any later step that does, such as laying
 *                    the source's sound back under a take)
 *   encoderAvailable this function carries the encoder (next.config.ts
 *                    traces it into the door, History, fal's webhook and the
 *                    reconcile cron — not into /app/generate)
 *   pieceCompleted   the provider has finished the job the row is waiting on
 *
 * A job that needs no encoder keeps today's rule: the provider lost it, write
 * it off. A job that needs one is never written off by a route that cannot
 * run its step — only a route that can actually join may decide it is stuck
 * (2026-09-22; before this /app/generate deleted the paid parts of takes that
 * History would have finished). And on a route that can, a piece the provider
 * FINISHED is not lost: it is waiting on our step, whose tries and give-up
 * (above) own it — writing it off as "didn't finish in time" would book our
 * failure as the provider's.
 */
export function reaperMayWriteOff(input: { needsEncoder: boolean; encoderAvailable: boolean; pieceCompleted: boolean }): boolean {
  if (!input.needsEncoder) return true;
  if (!input.encoderAvailable) return false;
  return !input.pieceCompleted;
}
