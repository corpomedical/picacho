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
export const RECAST_REFUSED_BRIEF = "This clip can't be recast. Nothing was charged.";
export const RECAST_CHARACTER_NEEDS_PHOTO = "That character has no photo yet — add one first.";
export const RECAST_CLIP_UNCHECKED = "That clip couldn't be checked just now — nothing was charged. Try again.";
export const RECAST_COULDNT_START = "Couldn't start this take — nothing was charged. Try again.";
export const RECAST_ALREADY_STARTED = "That take was already started.";
// The long take (chain.ts): no placement of its parts lets them meet at a
// still enough moment inside the engine's limits.
export const RECAST_CHAIN_NO_PLAN = "This stretch can't be split into parts cleanly — choose 15 seconds of it. Nothing was charged.";
// Not locked to characters (2026-09-19): what a take is short of, and the
// images the person adds.
export const RECAST_NEEDS_WORDS = "Say what should change, or choose a character.";
export const RECAST_NEEDS_PICTURE = "Choose a character or add an image to bring to life.";
export const RECAST_IMAGE_UNUSABLE = "That image can't be used — it needs to be at least 340 pixels on each side, and no more than 2.5 times as long one way as the other.";
export const RECAST_IMAGE_UNCHECKED = "That image couldn't be checked just now — nothing was charged. Try again.";
// Several characters in one take (2026-09-19): one without a person in the
// clip to play, and no words to give them a part.
export const RECAST_NEEDS_ROLES = "Say in your words who each character plays.";
// A whole group changed at once (2026-09-20). Past 15 seconds a take is made
// in parts, and a later part is given the footage again — which is where two
// takes of the operator's own crowd came back as the footage. One part, or
// the crowd comes back.
export const RECAST_GROUP_ONE_PART = "A whole group can only be changed in one part — keep the take to 15 seconds, or cast someone in it instead of all of them.";

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
