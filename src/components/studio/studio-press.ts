import { followPress, lateThrow, lostAnswer, newPressId, pressReadOf, stillGoingAnswer, type LostWords, type PressRead } from "@/lib/sets/press-follow";
import { isStaleDeployError } from "@/lib/stale-deploy";
import type { ShootResult } from "@/lib/sets/actions";
import type { SetPressState } from "@/lib/sets/press-actions";

// Helios Studio stage 3 (2026-09-29): "Photo with your character" is one
// press of the set page's Shoot — shootInSet, the one paid path for a still,
// with the ledger's press id. This is the set page's own press (set-view.tsx
// shoot()) without the page around it: ONE id per press, minted here and
// never sent twice; a resend the server is already rendering, or an answer
// lost on the way (a dropped connection, the platform's cut-off), is
// followed by that id (press-follow.ts) and never pressed again, so nothing
// is charged twice. The server calls and the page's liveness are handed in,
// so a test (and the no-server harness) can stand in for them.

export type StudioShootInput = {
  frameDataUri: string;
  characterId: string;
  direction: string;
  layout: unknown;
  lifted?: boolean;
  canvasAspect?: number;
  words?: string;
  rig?: unknown;
  movers?: unknown;
  beat?: boolean;
  /** Taken by the Studio before a clean traced frame is made, so the trace and the send are one press. */
  pressId?: string;
};

/** Where a press is: sent, checking whether a lost answer went through, or following one that did. */
export type StudioPressPhase = "sent" | "checking" | "rendering";

export type StudioPressDeps = {
  shoot: (setId: string, input: StudioShootInput & { pressId: string }) => Promise<ShootResult>;
  read: (setId: string, input: { pressId: string }) => Promise<SetPressState>;
  /** False once the Studio has closed: a follow stops quietly. */
  alive: () => boolean;
  words: LostWords & { refresh: string };
  /** A new deploy answered instead of the server: the page is out of date. */
  onStale?: () => void;
  onPhase?: (phase: StudioPressPhase) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export async function pressStudioStill(deps: StudioPressDeps, setId: string, input: StudioShootInput): Promise<ShootResult> {
  const now = deps.now ?? Date.now;
  const pressId = input.pressId || newPressId();
  const readBack = async (): Promise<PressRead<ShootResult> | null> => {
    try {
      return pressReadOf(await deps.read(setId, { pressId }), "shot") as PressRead<ShootResult> | null;
    } catch (err) {
      return isStaleDeployError(err) ? { state: "error", error: deps.words.refresh } : null;
    }
  };
  const follow = (sentAt: number) =>
    followPress<ShootResult>({ sentAt, read: readBack, alive: deps.alive, onRunning: () => deps.onPhase?.("rendering"), now: deps.now, sleep: deps.sleep });
  deps.onPhase?.("sent");
  const sentAt = now();
  try {
    const result = await deps.shoot(setId, { ...input, pressId });
    // A resend found the first delivery still rendering: that one is followed.
    if (stillGoingAnswer(result.error)) {
      deps.onPhase?.("rendering");
      return lostAnswer(await follow(sentAt), deps.words) as ShootResult;
    }
    return result;
  } catch (err) {
    // A new deploy refuses at once: nothing started. A later throw is a
    // render stopped mid-way, never a deploy (press-follow.ts lateThrow).
    if (!lateThrow(sentAt, now()) && isStaleDeployError(err)) {
      deps.onStale?.();
      return { error: deps.words.refresh };
    }
    deps.onPhase?.("checking");
    return lostAnswer(await follow(sentAt), deps.words) as ShootResult;
  }
}
