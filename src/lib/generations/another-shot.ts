// "Another shot on this set" (2026-08-26, operator-approved after the
// Magnific 3D-scenes review): one tap on a finished image re-opens the
// composer with that image attached as a scene reference and the original
// prompt scaffolded for a new camera angle. The whole feature is a PREFILL
// over the already-shipped neutral reference lane — the attachment rides
// exactly like a manually attached photo (same upload action, same roles
// payload, same per-model receipt honesty), so it adds zero new pipeline
// behavior and zero new AI calls. This module holds the pure, unit-tested
// pieces; the composer effect and the History button consume them.

// English on purpose, like every prompt suffix the server composes: the
// scaffold is text FOR THE MODEL, not UI copy. It lands in the user's
// textarea so they can see and edit exactly what will be sent.
export const ANOTHER_SHOT_SUFFIX =
  "\n\nKeep the exact same location, set and lighting as the attached image — new camera angle: ";

// The suffix without surrounding whitespace — what an untouched scaffold
// ends with after trimming, whether or not the original prompt was empty.
const SUFFIX_CORE = ANOTHER_SHOT_SUFFIX.trim();

export function buildAnotherShotPrompt(originalPrompt: string): string {
  const base = originalPrompt.trim();
  return base ? base + ANOTHER_SHOT_SUFFIX : ANOTHER_SHOT_SUFFIX.trimStart();
}

// If the person sends without filling in the angle, the dangling
// "— new camera angle: " would read to the model as an unanswered question.
// Strip the whole scaffold in that case and send the base prompt alone —
// deterministic string surgery, no guessing. A filled-in scaffold (anything
// typed after the colon) no longer ends with the core and passes untouched.
export function trimUnfilledAnotherShotScaffold(prompt: string): string {
  const trimmed = prompt.trimEnd();
  if (!trimmed.endsWith(SUFFIX_CORE)) return prompt;
  return trimmed.slice(0, trimmed.length - SUFFIX_CORE.length).trimEnd();
}

// Which results get the button. Mirrors the video "Continue this clip"
// gate: finished image results with something renderable to hand back.
// The renderable check matches isRenderableUrl in lib/media/url.ts — that
// module is server-only (it imports crypto), and this one must stay
// importable from client components, so the one-line expression is
// duplicated here and pinned by a parity test.
export function isAnotherShotEligible(row: {
  content_type: string | null;
  status: string | null;
  result_url: string | null;
}): boolean {
  return (
    row.content_type === "image" &&
    row.status === "succeeded" &&
    Boolean(row.result_url && (row.result_url.startsWith("http") || row.result_url.startsWith("/api/media/")))
  );
}
