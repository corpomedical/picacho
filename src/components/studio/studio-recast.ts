import { followPress, type PressRead } from "@/lib/sets/press-follow";
import { isStaleDeployError } from "@/lib/stale-deploy";
import type { RecastRead } from "@/lib/recast/recast-read";
import { studioRecastCredits, studioRecastTag, type StudioRecastEngine } from "@/lib/sets/studio-recast";
import type { StudioRecastRead } from "@/lib/sets/studio-recast-actions";

// Helios Studio · "Video with your character", one press (2026-09-30). The
// Studio hands in the recording it made; this sends it through Recast's own
// path — a place in storage, the upload, Recast's read of the file, then
// Recast's start — and follows the take until it is done or has failed.
//
// ONE id per press (the sendId), minted by the Studio before it records and
// never pressed again: it is the take's row id (recast/repeat.ts), so an
// answer lost on the way is followed by that id, and a second delivery of
// the same press follows the first one's take instead of charging again.
// Stop before the start costs nothing: the recording is let go. The server
// calls are handed in, so a test and the no-server harness stand in for them.

export type RecastUpdate =
  | { phase: "uploading"; share: number | null }
  | { phase: "reading" }
  | { phase: "starting" }
  | { phase: "checking" }
  | { phase: "rendering"; progress: string; id: string };

export type RecastAnswer =
  | { error: null; id: string; url: string }
  | { error: string; id?: string; charged?: boolean }
  | { error: ""; stopped: true }
  | { error: ""; left: true };

type Inspected =
  | { error: string }
  | { error: null; path: string; seconds: number; frames: number | null; width: number; height: number; read: RecastRead | null };

export type RecastDeps = {
  reserve: (setId: string, input: { size: number; type: string }) => Promise<{ error: string } | { error: null; path: string; contentType: string }>;
  upload: (path: string, contentType: string, clip: Blob, onShare: (share: number | null) => void) => Promise<"sent" | "failed" | "aborted">;
  inspect: (setId: string, input: { path: string }) => Promise<Inspected>;
  start: (setId: string, input: Record<string, unknown>) => Promise<{ error: string } | { error: null; ids: string[] }>;
  read: (setId: string, input: { id: string }) => Promise<StudioRecastRead>;
  discard: (setId: string, input: { path: string }) => Promise<void>;
  /** False once the Studio has closed: the follow stops quietly. */
  alive: () => boolean;
  /** True once Stop was pressed: honoured up to the start, never after it. */
  stopped: () => boolean;
  unreachable: string;
  refresh: string;
  /** The recording came out shorter than the range, or its price moved: nothing was sent. */
  changed: string;
  /** The take didn't finish; its line when the server gave no reason. */
  failed: string;
  /** A lost answer, looked for until the request had surely ended (the set page's own words). */
  neverStarted: string;
  unchecked: string;
  stillGoing: string;
  onStale?: () => void;
  sleep?: (ms: number) => Promise<void>;
  /** How long one read is waited on before it is asked again (RECAST_READ_TIMEOUT_MS). */
  readTimeoutMs?: number;
  now?: () => number;
};

export type RecastPress = {
  sendId: string;
  clip: Blob;
  /** The type the recorder made it as ("video/mp4", "video/webm"…). */
  type: string;
  characterId: string;
  photoCount: number;
  engine: StudioRecastEngine;
  /** The range's length, in seconds — what is priced and sent as the window. */
  seconds: number;
  /** What the window showed and the person pressed. */
  credits: number;
  direction: string;
  /** Every visible figure's screen x in the shot (−1 … 1), and which one the character replaces. */
  figuresX: number[];
  chosen: number;
};

/** How often a rendering take is asked about, and how long it is followed from this window at most. */
export const RECAST_POLL_MS = 5000;
/** A read that has not answered by then is asked again. */
export const RECAST_READ_TIMEOUT_MS = 20_000;

/**
 * The wait between reads: a plain timer, which a hidden tab may slow down
 * (Chrome holds a background page's timers to about once a minute) — so it
 * also ends the moment the page is shown again, and the take is read at once.
 */
export function wakeableSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const doc = typeof document === "undefined" ? null : document;
    const done = () => {
      clearTimeout(timer);
      doc?.removeEventListener("visibilitychange", onShow);
      resolve();
    };
    const onShow = () => {
      if (doc?.visibilityState === "visible") done();
    };
    const timer = setTimeout(done, ms);
    doc?.addEventListener("visibilitychange", onShow);
  });
}
export const RECAST_FOLLOW_MS = 45 * 60 * 1000;
const MISSES = 12;

export async function pressStudioRecast(deps: RecastDeps, setId: string, p: RecastPress, onUpdate: (u: RecastUpdate) => void): Promise<RecastAnswer> {
  const sleep = deps.sleep ?? wakeableSleep;
  const now = deps.now ?? Date.now;
  const stale = (err: unknown) => {
    if (!isStaleDeployError(err)) return false;
    deps.onStale?.();
    return true;
  };
  let path: string | null = null;
  const letGo = async (): Promise<void> => {
    if (path) await deps.discard(setId, { path }).catch(() => {});
  };
  const stoppedAnswer = async (): Promise<RecastAnswer> => {
    await letGo();
    return { error: "", stopped: true };
  };

  // Up to the start, nothing is charged: a refusal is said, a Stop lets the recording go.
  let inspected: Extract<Inspected, { error: null }>;
  try {
    onUpdate({ phase: "uploading", share: 0 });
    const place = await deps.reserve(setId, { size: p.clip.size, type: p.type });
    if (place.error !== null) return { error: place.error };
    path = place.path;
    if (deps.stopped()) return stoppedAnswer();
    const sent = await deps.upload(place.path, place.contentType, p.clip, (share) => onUpdate({ phase: "uploading", share }));
    if (sent === "aborted" || deps.stopped()) return stoppedAnswer();
    if (sent === "failed") {
      await letGo();
      return { error: deps.unreachable };
    }
    onUpdate({ phase: "reading" });
    const seen = await deps.inspect(setId, { path: place.path });
    // Recast removes a clip it refuses.
    if (seen.error !== null) return { error: seen.error };
    inspected = seen;
    path = seen.path;
  } catch (err) {
    await letGo();
    return { error: stale(err) ? deps.refresh : deps.unreachable };
  }
  if (deps.stopped()) return stoppedAnswer();

  // The window is the whole range. A recording shorter than it, or a price
  // that no longer matches the one pressed, sends nothing.
  if (inspected.seconds < p.seconds - 0.05 || studioRecastCredits(p.engine, p.seconds, p.photoCount) !== p.credits) {
    await letGo();
    return { error: deps.changed };
  }

  const body = {
    sendId: p.sendId,
    path: inspected.path,
    characterId: p.characterId,
    engine: p.engine,
    seconds: p.seconds,
    direction: p.direction,
    read: inspected.read,
    castTag: studioRecastTag(inspected.read, p.figuresX, p.chosen),
  };
  onUpdate({ phase: "starting" });
  const sentAt = now();
  let lost = false;
  try {
    const started = await deps.start(setId, body);
    if (started.error !== null) return { error: started.error };
  } catch (err) {
    // A new deploy refuses at once: nothing started.
    if (now() - sentAt < 20_000 && stale(err)) {
      await letGo();
      return { error: deps.refresh };
    }
    lost = true;
  }

  const id = p.sendId;
  if (lost) {
    // The answer was lost on the way: the take may have started. It is looked for by its id, never pressed again.
    onUpdate({ phase: "checking" });
    const found = await followPress<true>({
      sentAt,
      alive: deps.alive,
      now: deps.now,
      sleep: deps.sleep,
      read: async (): Promise<PressRead<true> | null> => {
        try {
          const r = await deps.read(setId, { id });
          if (r.error !== null) return { state: "error", error: r.error };
          return r.state === "none" ? { state: "none" } : { state: "done", result: true };
        } catch (err) {
          return stale(err) ? { state: "error", error: deps.refresh } : null;
        }
      },
    });
    if (found.kind === "left") return { error: "", left: true };
    if (found.kind === "error") return { error: found.error };
    // Looked for until the request had surely ended, and never found: nothing started, nothing was charged.
    if (found.kind === "never-started") return { error: deps.neverStarted };
    if (found.kind !== "landed") return { error: deps.unchecked, id };
  }

  // THE FOLLOW (2026-09-30, after the first live take: the window sat on
  // "Rendering" for minutes while the take was already in History). It ends
  // only on done, stopped, failed or the Studio closing: a read that errs,
  // throws or hangs is asked again, no read is waited on past
  // RECAST_READ_TIMEOUT_MS, and the wait between reads ends the moment a
  // hidden tab is shown again (wakeableSleep).
  onUpdate({ phase: "rendering", progress: "", id });
  const t0 = now();
  let misses = 0;
  let lastError = deps.unreachable;
  while (now() - t0 < RECAST_FOLLOW_MS) {
    if (!deps.alive()) return { error: "", left: true };
    let r: StudioRecastRead | null;
    let cut: ReturnType<typeof setTimeout> | undefined;
    try {
      r = await Promise.race([deps.read(setId, { id }), new Promise<null>((res) => (cut = setTimeout(() => res(null), deps.readTimeoutMs ?? RECAST_READ_TIMEOUT_MS)))]);
    } catch (err) {
      if (stale(err)) return { error: deps.refresh, id };
      r = null;
    } finally {
      clearTimeout(cut);
    }
    if (r === null || r.error !== null) {
      if (r) lastError = r.error;
      if (++misses >= MISSES) return { error: lastError, id };
      await sleep(RECAST_POLL_MS);
      continue;
    }
    misses = 0;
    if (r.state === "done") return { error: null, id, url: r.url };
    if (r.state === "stopped") return { error: "", stopped: true };
    if (r.state === "failed") return { error: r.reason ?? deps.failed, id, charged: r.charged };
    onUpdate({ phase: "rendering", progress: r.state === "working" ? r.progress : "", id });
    await sleep(RECAST_POLL_MS);
  }
  // Still going after the window's own wait: it lands in History and in Recast on its own.
  return { error: deps.stillGoing, id };
}
