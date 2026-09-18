// The recast lane's server sentences. English on the wire (the repo's
// standing design — lib/i18n/server-text.ts maps each to the dictionary at
// display time, and truth-contracts pins the two together). The door's
// NAME never appears here: it is a working title, and these strings are
// keys.

import type { RecastClipProblem } from "./recast";

export const RECAST_NOT_OPEN = "Recasting is in private testing.";
export const RECAST_UNAVAILABLE = "Recasting isn't available right now.";
export const RECAST_NEEDS_DATABASE = "Recasting needs a database update first (recast.sql).";
export const RECAST_NEEDS_RIGHTS = "Confirm the clip is yours to use first.";
export const RECAST_TOO_FAST = "You're starting takes quickly — give it a minute and try again.";
export const RECAST_UPLOAD_UNREADABLE = "Couldn't read that upload — try again.";
export const RECAST_NOT_A_VIDEO = "That file doesn't read as an MP4 or MOV video.";
export const RECAST_CLIP_TOO_SHORT = "That clip is under 3 seconds.";
export const RECAST_CLIP_TOO_LONG = "That clip is over 30 seconds.";
export const RECAST_CLIP_TOO_BIG = "That clip is over 50 MB.";
export const RECAST_CLIP_TOO_SMALL = "That clip is under 340 pixels on its short side.";
export const RECAST_CLIP_TOO_LARGE = "That clip is past 3850 pixels on a side.";
export const RECAST_JOB_TOO_LONG = "That clip is longer than this job takes — trim it, or choose another job.";
export const RECAST_WINDOW_INVALID = "That stretch of the clip can't be used — choose it again.";
export const RECAST_TRIM_FAILED = "Couldn't cut that stretch of the clip — nothing was charged. Try again.";
export const RECAST_NEEDS_CAST = "Choose who performs it first.";
export const RECAST_REFUSED_BRIEF = "This clip can't be recast. Nothing was charged.";
export const RECAST_CHARACTER_NEEDS_PHOTO = "That character has no photo yet — add one first.";
export const RECAST_CLIP_UNCHECKED = "That clip couldn't be checked just now — nothing was charged. Try again.";
export const RECAST_COULDNT_START = "Couldn't start this take — nothing was charged. Try again.";
export const RECAST_ALREADY_STARTED = "That take was already started.";

export function recastClipProblemMessage(problem: RecastClipProblem): string {
  switch (problem) {
    case "too-short":
      return RECAST_CLIP_TOO_SHORT;
    case "too-long":
      return RECAST_CLIP_TOO_LONG;
    case "too-big":
      return RECAST_CLIP_TOO_BIG;
    case "too-small":
      return RECAST_CLIP_TOO_SMALL;
    case "too-large":
      return RECAST_CLIP_TOO_LARGE;
  }
}
