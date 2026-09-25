// A failed build from words, tried again (Helios Cut 3, step 5, 2026-09-26).
// The Sets home's failed card, and the failed set's own page, offer "Try
// again": the build's words go back in the home's box with "A new place",
// and nothing is spent until the person presses the build button, which
// says what it uses. Pure and relative-import only, so the test runs it
// as the page does.
//
// Only for a build from words that the words can build again:
// - never a photo build (its photo is not kept to send again);
// - never a set with no words of its own (the reserved brief a build from
//   a photo or from the Recce stores, or none);
// - never a refusal: the same words would be refused again.

import { SET_BUILD_REFUSED } from "./messages";
import { SET_RESERVED_BRIEF } from "./set-config";
import type { SetSummary } from "./types";

/** The words to put back in the box for this failed build, or null when it gets no Try again. */
export function tryAgainWords(set: Pick<SetSummary, "status" | "fromPhoto" | "brief" | "failure">): string | null {
  if (set.status !== "failed" || set.fromPhoto) return null;
  const words = set.brief.trim();
  if (!words || words === SET_RESERVED_BRIEF) return null;
  if (set.failure === SET_BUILD_REFUSED) return null;
  return words;
}
