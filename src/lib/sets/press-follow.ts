// A paid Helios press, named and followed by the page (2026-09-25, Cut 1 —
// operator: "GO ahead" on "never charge twice, and films that behave").
//
// A shot, a take, a film beat or a clip tried again waits 60-280 s inside one
// request. Two things went wrong in that window:
// - Chromium, the Android WebView included, silently RESENDS a POST whose
//   reused connection drops before any response headers arrive (memory
//   picacho-repeat-send: 2026-09-22, two image sends each charged while the
//   page said "Couldn't start"). The second delivery rendered and charged a
//   second still, and the page only ever saw one.
// - When the connection dropped, or the platform cut the request at its
//   300 s ceiling, the page's await threw and it said "Couldn't reach the
//   server — try again" while the paid render carried on. People pressed
//   again and paid again, and a film forgot the beat it had just paid for.
//
// So every paid press carries its own id (newPressId), minted by the page
// right before it is sent and never kept past it: a browser's resend is the
// same request body, so the server (press.ts runPress) follows the first
// delivery instead of rendering again. And a press whose answer is lost is
// followed by that id (followPress, through press-actions.ts readSetPress)
// with the press still held, never pressed again: what lands is handed to
// the code a normal answer takes.
//
// Pure and client-safe, relative imports only: the page imports it and the
// tests load it. It must never import media/url.ts, which is server-only,
// or generations/repeat-send.ts, which imports it.

import { SET_PRESS_RUNNING } from "./messages";
import type { SetPressState } from "./press-actions";

/** How often a lost press is read back: at most ~83 reads over a whole follow. */
export const PRESS_POLL_MS = 4_000;
/** The set page's request ceiling: `export const maxDuration` of app/app/sets/[id]/page.tsx, in ms. */
export const SET_REQUEST_CEILING_MS = 300_000;
/** A follow runs this long past the ceiling, so a request the platform stopped has surely ended. */
export const PRESS_FOLLOW_GRACE_MS = 30_000;
/** A throw this long after the send is the platform's cut-off, never a deploy (cutOff). */
export const PRESS_CUT_OFF_AFTER_MS = SET_REQUEST_CEILING_MS - 30_000;

/**
 * The answers that mean "a delivery of this press is still rendering": the
 * page follows the press instead of showing them as a failure.
 * - repeat-send.ts REPEAT_STILL_RUNNING, copied because that module pulls
 *   the server-only media/url.ts (press-follow.test.ts pins the copy): a
 *   resend that reached runGeneration's follower.
 * - messages.ts SET_PRESS_RUNNING: a resend that met the first delivery's
 *   claim row and outlived its own clock (press.ts runPress).
 */
export const PRESS_STILL_GOING_ANSWERS: readonly string[] = [
  "This take is still going — it'll appear in History when it lands.",
  SET_PRESS_RUNNING,
];

/** One read of a press: nothing under it, running, its answer, or a sentence to show. */
export type PressRead<T> = { state: "none" } | { state: "running" } | { state: "done"; result: T } | { state: "error"; error: string };

/** How a follow ended. */
export type PressFollowed<T> =
  | { kind: "landed"; result: T }
  // The last read, past the ceiling, found nothing under the press: nothing was reserved or charged.
  | { kind: "never-started" }
  // Past the ceiling with a row there, or with reads that failed: it shows in History once it settles.
  | { kind: "still-going" }
  | { kind: "error"; error: string }
  // The page went: the follow stops quietly.
  | { kind: "left" };

/**
 * A fresh id for one paid press, a v4 UUID. crypto.randomUUID needs a
 * secure context (picacho.ai and localhost are); anything else gets the
 * same v4 from getRandomValues (the idea of live-stage.tsx's uuid()).
 */
export function newPressId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Reads a lost press back every PRESS_POLL_MS until its answer is there,
 * or until the platform's ceiling plus PRESS_FOLLOW_GRACE_MS from the send,
 * when the request has surely ended. A read that fails (`null`) is asked
 * again and never taken as "nothing started": that verdict would invite a
 * second charge. Only the last read, past the deadline, decides between
 * never-started and still-going.
 */
export async function followPress<T>(opts: {
  sentAt: number;
  read: () => Promise<PressRead<T> | null>;
  alive: () => boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<PressFollowed<T>> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = opts.sentAt + SET_REQUEST_CEILING_MS + PRESS_FOLLOW_GRACE_MS;
  for (;;) {
    if (!opts.alive()) return { kind: "left" };
    const last = now() >= deadline;
    // null = a read that failed, asked again.
    const r = await opts.read();
    if (!opts.alive()) return { kind: "left" };
    if (r?.state === "done") return { kind: "landed", result: r.result };
    if (r?.state === "error") return { kind: "error", error: r.error };
    if (last) return r?.state === "none" ? { kind: "never-started" } : { kind: "still-going" };
    await sleep(Math.min(PRESS_POLL_MS, Math.max(0, deadline - now())));
  }
}

/**
 * A follow as the answer the press would have had: what landed, or a
 * sentence in its place. "left" is an empty sentence: the page has gone,
 * and nothing is said.
 */
export function lostAnswer<T>(followed: PressFollowed<T>, words: { neverStarted: string; stillGoing: string }): T | { error: string } {
  switch (followed.kind) {
    case "landed":
      return followed.result;
    case "never-started":
      return { error: words.neverStarted };
    case "still-going":
      return { error: words.stillGoing };
    case "error":
      return { error: followed.error };
    case "left":
      return { error: "" };
  }
}

/** Whether an answer says a delivery of this press is still rendering (PRESS_STILL_GOING_ANSWERS). */
export function stillGoingAnswer(error: string | null | undefined): boolean {
  return error != null && PRESS_STILL_GOING_ANSWERS.includes(error);
}

/**
 * Whether a throw came so long after the send that the platform cut the
 * request at its ceiling. stale-deploy.ts reads a function cut off there as
 * "an unexpected response", the same as a deploy, but it is a render
 * stopped mid-way, which a reload would lose: it is followed instead. A
 * stale action answers at once, so the two cannot be confused.
 */
export function cutOff(sentAt: number | null, now: number): boolean {
  return sentAt !== null && now - sentAt >= PRESS_CUT_OFF_AFTER_MS;
}

type Answered = Extract<SetPressState, { state: "answered" }>;
/** The answer a press of this kind stores: shootInSet's for a shot, takeInSet's for a take. */
export type PressAnswerOf<K extends Answered["kind"]> = Extract<Answered, { kind: K }>["answer"];

/**
 * readSetPress's answer as one read of the follow (server-money's poll,
 * press-actions.ts, 2026-09-25):
 * - answered → done, with the press's own answer, `{ error }` refusals
 *   included, handled as that return would have been;
 * - running → running; unanswered (the request ended without an answer,
 *   leaving rows that may still land) → running too, so the last read says
 *   "History", never "nothing was charged";
 * - not-found → none: nothing under the press was reserved or charged;
 * - unknown (the ledger unreadable, or its SQL not run yet) → a failed
 *   read, asked again: it is never taken as "nothing started".
 */
export function pressReadOf<K extends Answered["kind"]>(r: SetPressState, kind: K): PressRead<PressAnswerOf<K>> | null {
  if (r.error !== null) return { state: "error", error: r.error };
  switch (r.state) {
    case "answered":
      return r.kind === kind ? { state: "done", result: r.answer as PressAnswerOf<K> } : null;
    case "running":
    case "unanswered":
      return { state: "running" };
    case "not-found":
      return { state: "none" };
    default:
      return null;
  }
}
