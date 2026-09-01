// Fixed camera-angle presets for multi-angle video generation. Each preset's
// promptHint gets appended to the user's request before it enters the normal
// draft/review/generate/validate pipeline — so every angle still goes
// through the same reliability checks as a single-angle generation, just
// once per angle.

export type AngleId = "front" | "side" | "three-quarter" | "back" | "close-up";

export type AnglePreset = {
  id: AngleId;
  label: string;
  promptHint: string;
};

export const ANGLE_PRESETS: AnglePreset[] = [
  {
    id: "front",
    label: "Front",
    promptHint: "Camera angle: front view, the character facing directly toward the camera.",
  },
  {
    id: "side",
    label: "Side",
    promptHint: "Camera angle: side profile view, the camera positioned at the character's side.",
  },
  {
    id: "three-quarter",
    label: "3/4",
    promptHint:
      "Camera angle: three-quarter view, the camera angled roughly 45 degrees from the character's front.",
  },
  {
    id: "back",
    label: "Back",
    promptHint: "Camera angle: rear view, the camera behind the character looking at their back.",
  },
  {
    id: "close-up",
    label: "Close-up",
    promptHint: "Camera angle: close-up shot, the camera framed tightly on the character.",
  },
];

// Pre-checked when a person turns Multi-angle on — they can add Back and/or
// Close-up, or remove one of these, before confirming.
export const DEFAULT_ANGLE_IDS: AngleId[] = ["front", "side", "three-quarter"];

export function getAnglePreset(id: string): AnglePreset | undefined {
  return ANGLE_PRESETS.find((a) => a.id === id);
}

// Stable display order for anywhere a set of angle rows needs sorting
// (history detail tabs, etc.) — earlier in ANGLE_PRESETS sorts first,
// unrecognized/legacy angle strings sort last but keep their relative order.
export function angleSortIndex(angleId: string | null): number {
  if (!angleId) return ANGLE_PRESETS.length + 1;
  // Cinema Studio scenes key their rows "shot-1".."shot-6" rather than by
  // angle name, and for a shot list the ORDER IS THE CONTENT — shot 3 before
  // shot 2 is not a sorting nit, it is the scene playing wrong.
  //
  // Without this branch every shot in a scene returns the same
  // unrecognised-string index, and the tiebreak is created_at — which is
  // IDENTICAL across the batch, because reserve_generations inserts all N
  // rows in one transaction and Postgres now() is transaction start time. A
  // tied sort over tied keys preserves whatever order the query happened to
  // return, so the shots would play in an arbitrary order that looks like an
  // AI-director quality problem rather than a missing ORDER BY.
  //
  // Offset into a band of their own so a scene's shots sort among themselves
  // and can never interleave with an angle group's five fixed views. Groups
  // are homogeneous in practice; the band makes that explicit rather than
  // relying on it.
  const shot = /^shot-(\d{1,3})$/.exec(angleId);
  if (shot) return 1000 + Number(shot[1]);
  const idx = ANGLE_PRESETS.findIndex((a) => a.id === angleId);
  return idx === -1 ? ANGLE_PRESETS.length : idx;
}

/** The row key for shot N of a scene (1-based). */
export function sceneShotKey(index: number): string {
  return `shot-${index + 1}`;
}
