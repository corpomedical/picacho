import { CYCLES_GONE, CYCLES_SAVE_FAILED, CYCLES_UNREACHABLE, type CyclesKind } from "@/lib/sets/cycles";
import { isStaleDeployError } from "@/lib/stale-deploy";

// Helios Studio · Blender (Cycles) render, one press (2026-09-29). The
// Studio hands in the scene file and the job; this sends the file to its
// one-time place in storage, asks the door to start (cycles-actions.ts), and
// follows the render by the press's id until it is done or has failed.
// ONE id per press, minted here and never pressed again: an answer lost on
// the way is followed by that id, so a render is never started twice. The
// server calls are handed in, so a test and the no-server harness can stand
// in for them.

export type CyclesUpdate =
  | { phase: "uploading" }
  | { phase: "starting" }
  | { phase: "rendering"; done: number; total: number };

export type CyclesDone = {
  error: null;
  kind: CyclesKind;
  url: string;
  seconds: number;
  renderSeconds: number;
  usd: number;
  device: string;
};
export type CyclesAnswer = CyclesDone | { error: string };

type Read =
  | { error: string }
  | { error: null; state: "working"; done: number; total: number }
  | ({ state: "done"; credits: 0 } & CyclesDone);

export type CyclesDeps = {
  reserve: (setId: string, input: { pressId: string; size: number }) => Promise<{ error: string } | { error: null; path: string; token: string }>;
  upload: (path: string, token: string, file: Blob) => Promise<{ error: unknown }>;
  render: (setId: string, input: { pressId: string; job: unknown }) => Promise<{ error: string } | { error: null; state: "started" }>;
  read: (setId: string, input: { pressId: string }) => Promise<Read>;
  /** False once the Studio has closed: the follow stops quietly. */
  alive: () => boolean;
  unreachable: string;
  refresh: string;
  onStale?: () => void;
  newId?: () => string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/** How often the render is asked about, and how long it is followed at most (the Modal timeout and a margin). */
export const CYCLES_POLL_MS = 3000;
export const CYCLES_FOLLOW_MS = 6000 * 1000 + 10 * 60 * 1000;
/** Reads in a row that may fail before the Studio says it can't reach the render. */
const MISSES = 10;

export async function pressCycles(
  deps: CyclesDeps,
  setId: string,
  input: { glb: Blob; job: unknown },
  onUpdate: (u: CyclesUpdate) => void,
): Promise<CyclesAnswer | { error: ""; left: true }> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const pressId = (deps.newId ?? (() => crypto.randomUUID()))();
  const stale = (err: unknown) => {
    if (!isStaleDeployError(err)) return false;
    deps.onStale?.();
    return true;
  };

  onUpdate({ phase: "uploading" });
  try {
    const place = await deps.reserve(setId, { pressId, size: input.glb.size });
    if (place.error !== null) return { error: place.error };
    const up = await deps.upload(place.path, place.token, input.glb);
    if (up.error) return { error: CYCLES_SAVE_FAILED };
  } catch (err) {
    return { error: stale(err) ? deps.refresh : deps.unreachable };
  }

  onUpdate({ phase: "starting" });
  try {
    const started = await deps.render(setId, { pressId, job: input.job });
    if (started.error !== null) return { error: started.error };
  } catch (err) {
    if (stale(err)) return { error: deps.refresh };
    // The answer was lost on the way: it may have started. Follow the id.
  }

  const t0 = now();
  let misses = 0;
  let seen = false;
  while (now() - t0 < CYCLES_FOLLOW_MS) {
    await sleep(CYCLES_POLL_MS);
    if (!deps.alive()) return { error: "", left: true };
    let r: Read;
    try {
      r = await deps.read(setId, { pressId });
    } catch (err) {
      if (stale(err)) return { error: deps.refresh };
      if (++misses >= MISSES) return { error: deps.unreachable };
      continue;
    }
    misses = 0;
    if (r.error !== null) {
      // A lost start that never reached the server leaves no ticket: nothing was started.
      if (r.error === CYCLES_GONE && !seen) return { error: CYCLES_UNREACHABLE };
      return { error: r.error };
    }
    seen = true;
    if (r.state === "working") onUpdate(r.total > 0 ? { phase: "rendering", done: r.done, total: r.total } : { phase: "starting" });
    else return { error: null, kind: r.kind, url: r.url, seconds: r.seconds, renderSeconds: r.renderSeconds, usd: r.usd, device: r.device };
  }
  return { error: deps.unreachable };
}
