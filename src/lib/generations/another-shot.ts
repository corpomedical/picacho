// "Another shot on this set" (2026-08-26, operator-approved after the
// Magnific 3D-scenes review): one tap on a finished image re-opens the
// composer with that image attached as a scene reference and the original
// prompt scaffolded for a new camera angle. The whole feature is a PREFILL
// over the already-shipped neutral reference lane — the attachment rides
// exactly like a manually attached photo (same upload action, same roles
// payload, same per-model receipt honesty), so it adds zero new pipeline
// behavior. This module holds the pure, unit-tested pieces; the composer
// effect and the History button consume them.
//
// Launch-night revision (same day): the first scaffold moved nothing — the
// reference suffix's "match its contents faithfully" beat it — and the
// second moved the camera but re-rolled the wardrobe every render and once
// lost the set, because the base prompt described the outfit vaguely
// ("a stylish designer top") and pixels don't survive reframing. The
// scaffold now carries CONTINUITY NOTES described from the source render
// at tap time (describeSceneForReshoot): set and wardrobe pinned as
// concrete text inside the user's editable prompt. Photos own the person,
// prompt owns the scene — so the scene goes into the prompt, precisely.

// English on purpose, like every prompt suffix the server composes: the
// scaffold is text FOR THE MODEL, not UI copy. It lands in the user's
// textarea so they can see and edit exactly what will be sent.
export const ANOTHER_SHOT_ANGLE_TAIL = "New camera angle: ";

const INTRO = "The attached image is the previous shot of this scene.";
const MOVE_CAMERA =
  "Shoot from a different camera position — do not repeat the previous shot's framing.";

export function buildAnotherShotPrompt(
  originalPrompt: string,
  sceneNotes?: string | null,
): string {
  const base = originalPrompt.trim();
  const notes = sceneNotes?.trim();
  const scaffold = notes
    ? `${INTRO} Rebuild the same set and wardrobe exactly:\n${notes}\n${MOVE_CAMERA} ${ANOTHER_SHOT_ANGLE_TAIL}`
    : `${INTRO} Rebuild the exact same location, set, lighting and wardrobe, but shoot from a different camera position — do not repeat the previous shot's framing. ${ANOTHER_SHOT_ANGLE_TAIL}`;
  return base ? `${base}\n\n${scaffold}` : scaffold;
}

// If the person sends without filling in the angle, only the dangling
// "New camera angle:" phrase is stripped — the rebuild-the-set instruction
// above it is complete and useful on its own (a same-set re-render with a
// free camera), so it stays. Deterministic string surgery, no guessing; a
// filled-in angle no longer ends with the phrase and passes untouched.
export function trimUnfilledAnotherShotScaffold(prompt: string): string {
  const tail = ANOTHER_SHOT_ANGLE_TAIL.trim();
  const trimmed = prompt.trimEnd();
  if (!trimmed.endsWith(tail)) return prompt;
  return trimmed.slice(0, trimmed.length - tail.length).trimEnd();
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
