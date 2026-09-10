// What the one automatic retry of a set build says (2026-09-11). Pure, so
// the words Astra receives are tested, not assumed.
//
// A build gets one retry at our cost (set-config.ts). It is spent on the
// first problem the server finds:
//   - the answer ran out of room          → build again, smaller
//   - the answer came back unusable       → build again
//   - the set is OPEN (closure.ts measured
//     a side a camera can see past)       → the same set, closed
// For the last, Astra gets its own set back with the open sides named and
// is asked to close them and keep everything else — a mended set rather
// than a new one, because a new one is as likely to be open somewhere else.
// When a mend cannot fit — the set is too long to re-emit under the output
// cap, or too close to the 400-shape limit for added walls to survive the
// normaliser — the retry is a fresh build told which sides to close.

import { setBuildInput } from "./set-builder-prompt";
import { SET_CLOSE_RETRY_INSTANCE_ROOM, SET_CLOSE_RETRY_MAX_PREVIOUS_CHARS } from "./set-config";
import { SET_LIMITS, specInstanceCount, type SetSpec } from "./set-spec";

export const RETRY_SMALLER =
  "\n\nYour previous answer for this brief was too long. Use at most 80 objects and lean on repeat.";

export function closeRetryInput(brief: string, openSides: string[], previous: SetSpec): string {
  const where = openSides.length > 0 ? openSides.join("; ") : "at least one side";
  const head =
    `\n\nYour previous set was open: from its marks a camera could see past the last wall toward ${where}. ` +
    "There is no fourth wall, walls meet at the corners, and a glass front is still a wall.";
  // The model's own set, as the normaliser left it, in the schema's own
  // shape: our version and ids are not part of it.
  const prev = JSON.stringify({
    title: previous.title,
    description: previous.description,
    bounds: previous.bounds,
    sky: previous.sky,
    ground: previous.ground,
    fog: previous.fog,
    lights: previous.lights,
    objects: previous.objects,
    marks: previous.marks.map((m) => ({ label: m.label, x: m.x, z: m.z, facingDeg: m.facingDeg })),
    cameras: previous.cameras.map((c) => ({ label: c.label, position: c.position, target: c.target, fovDeg: c.fovDeg })),
  });
  const noRoom = specInstanceCount(previous) > SET_LIMITS.maxInstances - SET_CLOSE_RETRY_INSTANCE_ROOM;
  if (prev.length > SET_CLOSE_RETRY_MAX_PREVIOUS_CHARS || noRoom) {
    return `${setBuildInput(brief)}${head} Build the set again with every side closed.`;
  }
  return (
    `${setBuildInput(brief)}${head} Return the same set with those sides closed: add the missing walls, glazing ` +
    `or backdrop, and keep everything else as it was.\n\nPrevious set: ${prev}`
  );
}

export type AfterValidAnswer = { kind: "retry-close" } | { kind: "ready"; use: "answer" | "draft" };

/**
 * A valid, gate-passed answer is in hand. Spend the retry on closing it, or
 * finish? `draftOpen` is the open-bearing count of the set kept from the
 * first attempt, when this answer IS the closing retry (null otherwise).
 */
export function decideAfterValidAnswer(input: {
  open: number;
  attempts: number;
  maxAttempts: number;
  stale: boolean;
  draftOpen: number | null;
}): AfterValidAnswer {
  if (input.draftOpen === null) {
    if (input.open > 0 && input.attempts < input.maxAttempts && !input.stale) return { kind: "retry-close" };
    return { kind: "ready", use: "answer" };
  }
  // The mended set came back. Keep whichever is more closed; a tie goes to
  // the mended one, which was asked for with the open sides named.
  return { kind: "ready", use: input.draftOpen < input.open ? "draft" : "answer" };
}
