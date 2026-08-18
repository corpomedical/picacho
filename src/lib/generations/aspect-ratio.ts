// Real incident, 2026-08-07: a user typed "16:9, no side bars" directly into
// their prompt and still got a 4:3 video with black bars down the sides. Root
// cause: the video model in use (Kling O3) has no aspect_ratio parameter at
// all on its API — it just inherits whatever shape the character's reference
// photo happens to be, so nothing in the request could ever have honored a
// text instruction about framing (see the reframe step in fal.ts for the
// actual fix).
//
// This detector is the other half of the fix the user asked for: an explicit
// ratio mentioned in what someone actually typed should win over whatever
// icon they happen to have clicked in the composer's aspect-ratio picker —
// if you SAY you want it vertical, that should apply even if 16:9 is still
// selected from an earlier generation. See actions.ts for the resolution
// order (prompt > icon pick > 16:9 default).

export type VideoAspectRatio = "16:9" | "9:16";

// "portrait" only counts when it's phrased as an ORIENTATION ("portrait
// mode/orientation/format/aspect/video"), not as a subject — the bare word
// used to match, so "a portrait of the character" (an extremely common way
// to ask for a picture of someone) silently forced every such video into
// 9:16 the person never asked for. "vertical", the explicit ratios, and the
// platform names are unambiguous orientation intent and stay as-is.
const PORTRAIT_PATTERN =
  /\b(9:16|9x16|vertical|portrait[ -](?:mode|orientation|format|aspect|ratio|video)|tiktok|reels?|instagram stor(?:y|ies))\b/i;
const LANDSCAPE_PATTERN = /\b(16:9|16x9|landscape|widescreen|horizontal)\b/i;

// Checked in this order (not "whichever matches first in the string") since
// a real prompt is far more likely to accidentally contain one stray keyword
// than to genuinely ask for both — this just needs a deterministic tie-break,
// not a smarter interpretation of contradictory requests.
export function detectAspectRatioFromPrompt(text: string): VideoAspectRatio | null {
  if (PORTRAIT_PATTERN.test(text)) return "9:16";
  if (LANDSCAPE_PATTERN.test(text)) return "16:9";
  return null;
}
